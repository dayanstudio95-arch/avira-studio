import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquare, Send, Loader2 } from "lucide-react";
import StructuredAnswer from "@/components/AIAssistantStructuredAnswer";

// READ ONLY — שולח read_only: true ל-aiAssistant. לא מאפשר action_proposal.

const QUICK_QUESTIONS = [
  "מי חייב כסף?",
  "אירועים בלי צוות?",
  "מה הכי דחוף היום?",
  "למה אוטומציה נכשלה?",
];

export default function AskSystemPanelV2() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return;
    const userMsg = text.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMsg, id: Date.now() }]);
    setLoading(true);

    try {
      // Include pendingIntent in history for ambiguous clarification followup
      const history = messages.slice(-6).map(m => ({
        role: m.role,
        content: m.content,
        pendingIntent: m.pendingIntent || undefined,
      }));
      const res = await base44.functions.invoke("aiAssistant", {
        message: userMsg,
        history,
        readOnly: true,
      });
      const result = res?.data?.result;

      if (!result) {
        setMessages(prev => [...prev, { role: "assistant", content: "לא התקבלה תגובה.", id: Date.now() }]);
        return;
      }

      // Guard: ignore action_proposal in read-only mode
      if (result.type === "action_proposal") {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: "הפעולה הזו אינה זמינה במצב תצוגה בלבד.",
          id: Date.now()
        }]);
        return;
      }

      if (result.type === "structured_answer") {
        setMessages(prev => [...prev, { role: "assistant", structuredData: result, id: Date.now() }]);
      } else if (result.type === "clarification_needed") {
        // Store the pending intent so the next message can resolve it
        setMessages(prev => [...prev, {
          role: "assistant",
          content: result.text,
          pendingIntent: result.pendingIntent,
          id: Date.now(),
        }]);
      } else {
        setMessages(prev => [...prev, { role: "assistant", content: result.text || "אין תגובה.", id: Date.now() }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: "שגיאה: " + (err?.message || "נסה שוב."), id: Date.now() }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-white text-base flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-blue-400" />
          שאל את יועץ המערכת
          <span className="text-xs text-gray-500 font-normal mr-1">— תצוגה בלבד</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Quick questions */}
        <div className="flex flex-wrap gap-2">
          {QUICK_QUESTIONS.map(q => (
            <button
              key={q}
              onClick={() => sendMessage(q)}
              disabled={loading}
              className="px-3 py-1.5 text-xs rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-300 hover:bg-blue-600/40 hover:text-blue-200 transition-colors disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Chat history */}
        <div className="min-h-[100px] max-h-72 overflow-y-auto space-y-2 pr-1">
          {messages.length === 0 && (
            <p className="text-gray-600 text-xs py-2">לחץ על שאלה מהירה או הקלד שאלה חופשית…</p>
          )}
          {messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[85%] rounded-xl p-3 text-sm ${
                msg.role === "user"
                  ? "bg-blue-600/20 text-blue-100 border border-blue-500/20"
                  : "bg-gray-800 text-gray-200 border border-gray-700"
              }`}>
                {msg.structuredData
                  ? <StructuredAnswer data={msg.structuredData} />
                  : <p className="whitespace-pre-wrap">{msg.content}</p>
                }
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-end">
              <div className="bg-gray-800 rounded-xl p-3 border border-gray-700">
                <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Input */}
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage(input)}
            placeholder="שאל שאלה חופשית…"
            disabled={loading}
            className="bg-gray-800 border-gray-700 text-white placeholder-gray-500 text-sm"
          />
          <Button
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
            size="icon"
            className="bg-blue-600 hover:bg-blue-700 shrink-0"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}