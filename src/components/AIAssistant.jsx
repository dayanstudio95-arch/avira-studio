import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Send, Bot, Loader2, MessageSquare, CheckCircle, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import StructuredAnswer from "./AIAssistantStructuredAnswer";

export default function AIAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const addMessage = (role, content, actionProposal = null, structuredData = null) => {
    setMessages(prev => [...prev, { role, content, actionProposal, structuredData, id: Date.now() }]);
  };

  const handleSend = async () => {
    if (!inputMessage.trim() || isLoading) return;
    const userMsg = inputMessage.trim();
    setInputMessage("");
    addMessage("user", userMsg);
    setIsLoading(true);

    try {
      const history = messages.slice(-6).map(m => ({ role: m.role, content: m.content }));
      const res = await base44.functions.invoke("aiAssistant", { message: userMsg, history });
      const result = res?.data?.result;

      if (!result) {
        addMessage("assistant", "לא קיבלתי תגובה מהעוזר.");
        return;
      }

      if (result.type === "structured_answer") {
        addMessage("assistant", null, null, result);
      } else if (result.type === "action_proposal") {
        addMessage("assistant", result.description || "מצאתי פעולה מתאימה:", result);
      } else {
        addMessage("assistant", result.text || "אין תגובה.");
      }
    } catch (err) {
      addMessage("assistant", "שגיאה: " + (err?.message || "נסה שוב."));
    } finally {
      setIsLoading(false);
    }
  };

  // Whitelist of fields the AI is allowed to update directly (defensive, Phase 1)
  const ALLOWED_UPDATE_FIELDS = [
    'albumStatus',
    'raw_sent_to_editor',
    'raw_done_manual',
    'final_done_manual',
    'photographer1_done',
    'photographer2_done',
    'video1_done',
    'editor_done',
  ];

  const executeAction = async (actionProposal, msgId) => {
    const { action } = actionProposal;
    if (!action) return;

    // Mark as executing
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, executing: true } : m));

    try {
      if (action.name === "send_to_editor") {
        await base44.functions.invoke("sendToEditor", action.params);
        toast.success("נשלח לעורך בהצלחה ✅");
      } else if (action.name === "send_to_couple") {
        await base44.functions.invoke("sendMakeWebhook", {
          action: "send_to_couple",
          ...action.params,
        });
        toast.success("נשלח לזוג בהצלחה ✅");
      } else if (action.name === "update_field" || action.name === "mark_done") {
        const { eventId, field, value } = action.params;
        if (!ALLOWED_UPDATE_FIELDS.includes(field)) {
          toast.error(`⛔ שדה "${field}" אינו מורשה לעדכון על ידי העוזר`);
          setMessages(prev => prev.map(m => m.id === msgId ? { ...m, executing: false } : m));
          return;
        }
        await base44.entities.Event.update(eventId, { [field]: value ?? true });
        toast.success("עודכן בהצלחה ✅");
      }

      // Mark as done
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, executed: true, executing: false } : m
      ));
    } catch (err) {
      toast.error("שגיאה בביצוע הפעולה: " + (err?.message || ""));
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, executing: false } : m));
    }
  };

  return (
    <>
      {!isOpen && (
        <motion.div
          initial={{ x: 100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="fixed bottom-6 right-6 z-50"
        >
          <Button
            onClick={() => setIsOpen(true)}
            className="h-14 w-14 rounded-full bg-gradient-to-r from-yellow-400 to-yellow-500 hover:from-yellow-500 hover:to-yellow-600 shadow-lg"
          >
            <Bot className="w-6 h-6 text-gray-900" />
          </Button>
        </motion.div>
      )}

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            transition={{ type: "spring", damping: 25 }}
            className="fixed top-0 right-0 h-full w-96 bg-gray-900 border-l border-gray-800 shadow-2xl z-50 flex flex-col"
            dir="rtl"
          >
            {/* Header */}
            <div className="p-4 border-b border-gray-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-full flex items-center justify-center">
                  <Bot className="w-5 h-5 text-gray-900" />
                </div>
                <div>
                  <h2 className="text-white font-semibold">עוזר תפעולי AI</h2>
                  <p className="text-xs text-gray-400">שואל ומבצע פעולות במערכת</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="text-center text-gray-500 mt-8">
                  <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm font-medium mb-2">דוגמאות לשאלות ופעולות:</p>
                  <ul className="text-xs space-y-1.5 text-right px-4">
                    <li className="text-gray-400">📋 "אילו אירועים יש השבוע?"</li>
                    <li className="text-gray-400">👥 "מי לא שובץ?"</li>
                    <li className="text-gray-400">💸 "מי עדיין לא שילם?"</li>
                    <li className="text-gray-400">📹 "אירועים בלי עורך?"</li>
                    <li className="text-yellow-400">⚡ "שלח לעורך של דניאל וטלי את הגלם"</li>
                    <li className="text-yellow-400">⚡ "שלח לזוג כהן את הסופי"</li>
                  </ul>
                </div>
              )}

              {messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-start" : "justify-end"}`}>
                  <div className={`max-w-[85%] space-y-2 ${msg.role === "user" ? "" : ""}`}>
                    <div className={`rounded-xl p-3 ${msg.role === "user" ? "bg-yellow-400 text-gray-900" : "bg-gray-800 text-white"}`}>
                      {msg.structuredData
                        ? <StructuredAnswer data={msg.structuredData} />
                        : <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      }
                    </div>

                    {/* Action Proposal Card */}
                    {msg.actionProposal && msg.role === "assistant" && (
                      <div className="bg-gray-800 border border-yellow-500/30 rounded-xl p-3 space-y-2">
                        <div className="flex items-center gap-2 text-yellow-400 text-xs font-semibold">
                          <AlertCircle className="w-3.5 h-3.5" />
                          פעולה הממתינה לאישור
                        </div>
                        {msg.executed ? (
                          <div className="flex items-center gap-2 text-green-400 text-sm">
                            <CheckCircle className="w-4 h-4" />
                            בוצע בהצלחה
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => executeAction(msg.actionProposal, msg.id)}
                              disabled={msg.executing}
                              className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 text-xs font-bold flex-1"
                            >
                              {msg.executing ? <Loader2 className="w-3 h-3 animate-spin" /> : (msg.actionProposal.confirmText || "אשר ובצע")}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, actionProposal: null } : m))}
                              className="border-gray-600 text-gray-400 text-xs"
                            >
                              ביטול
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-end">
                  <div className="bg-gray-800 rounded-xl p-3">
                    <Loader2 className="w-5 h-5 text-yellow-400 animate-spin" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 border-t border-gray-800">
              <div className="flex gap-2">
                <Input
                  value={inputMessage}
                  onChange={e => setInputMessage(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSend()}
                  placeholder="שאל שאלה או בקש פעולה..."
                  disabled={isLoading}
                  className="bg-gray-800 border-gray-700 text-white placeholder-gray-400 text-sm"
                />
                <Button
                  onClick={handleSend}
                  disabled={isLoading || !inputMessage.trim()}
                  className="bg-yellow-400 hover:bg-yellow-500 text-gray-900"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}