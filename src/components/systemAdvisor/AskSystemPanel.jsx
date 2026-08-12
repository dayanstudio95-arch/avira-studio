import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquare, Send, Loader2 } from "lucide-react";
import StructuredAnswer from "@/components/AIAssistantStructuredAnswer";

// READ ONLY — שולח read_only: true ל-aiAssistant
// לא מאפשר action_proposal — נאכף גם ב-backend
export default function AskSystemPanel() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMsg, id: Date.now() }]);
    setLoading(true);

    try {
      const history = messages.slice(-6).map(m => ({ role: m.role, content: m.content }));
      // read_only: true — מונע action_proposal בצד ה-backend
      const res = await base44.functions.invoke("aiAssistant", {
        message: userMsg,
        history,
        read_only: true,
      });
      const result = res?.data?.result;

      if (!result) {
        setMessages(prev => [...prev, { role: "assistant", content: "לא התקבלה תגובה.", id: Date.now() }]);
        return;
      }

      // Guard: even if backend returns action_proposal, ignore it here
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
          שאל את המערכת
          <span className="text-xs text-gray-500 font-normal mr-1">— תצוגה בלבד</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="min-h-[120px] max-h-64 overflow-y-auto space-y-2 pr-1">
          {messages.length === 0 && (
            <div className="text-gray-500 text-xs space-y-1">
              <p>דוגמאות לשאלות:</p>
              <p className="text-gray-600">• "כמה אירועים יש החודש?"</p>
              <p className="text-gray-600">• "מי השתבץ הכי הרבה החודש?"</p>
              <p className="text-gray-600">• "כמה לידים חתומים יש?"</p>
              <p className="text-gray-600">• "מה הסטטוס של האוטומציות?"</p>
            </div>
          )}
          {messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[85%] rounded-xl p-2.5 text-sm ${msg.role === "user" ? "bg-blue-600/20 text-blue-100" : "bg-gray-800 text-gray-200"}`}>
                {msg.structuredData
                  ? <StructuredAnswer data={msg.structuredData} />
                  : <p className="whitespace-pre-wrap">{msg.content}</p>
                }
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-end">
              <div className="bg-gray-800 rounded-xl p-2.5">
                <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="flex gap-2 pt-1">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="שאל שאלה על נתוני המערכת..."
            disabled={loading}
            className="bg-gray-800 border-gray-700 text-white placeholder-gray-500 text-sm"
          />
          <Button
            onClick={handleSend}
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