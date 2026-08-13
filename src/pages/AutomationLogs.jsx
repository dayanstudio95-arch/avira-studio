import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp, Play } from "lucide-react";
import { toast } from "sonner";

const statusColor = { completed: "bg-green-900/50 text-green-300 border-green-700", running: "bg-blue-900/50 text-blue-300 border-blue-700", error: "bg-red-900/50 text-red-300 border-red-700" };
const msgStatusColor = { sent: "text-green-400", failed: "text-red-400", skipped: "text-gray-400" };

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function AutomationLogs() {
  const [runs, setRuns] = useState([]);
  const [messages, setMessages] = useState([]);
  const [automations, setAutomations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedRun, setExpandedRun] = useState(null);
  const [selectedAutomation, setSelectedAutomation] = useState("all");
  const [runningNow, setRunningNow] = useState(null);

  const load = async () => {
    setLoading(true);
    const [r, m, a] = await Promise.all([
      base44.entities.AutomationRun.list("-created_date", 100),
      base44.entities.AutomationMessageLog.list("-created_date", 500),
      base44.entities.Automation.list()
    ]);
    setRuns(r);
    setMessages(m);
    setAutomations(a);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleRunNow = async (automationId, automationName) => {
    setRunningNow(automationId);
    const toastId = toast.loading(`מריץ: ${automationName}...`);
    try {
      const res = await base44.functions.invoke("automationEngine", { automation_id: automationId, triggered_by: "manual" });
      if (res.data?.success) {
        const r = res.data.results?.[0];
        toast.success(`הושלם — נשלחו: ${r?.sent || 0}, נכשלו: ${r?.failed || 0}`, { id: toastId });
        load();
      } else {
        toast.error(res.data?.error || "שגיאה", { id: toastId });
      }
    } catch (err) {
      toast.error(err.message, { id: toastId });
    }
    setRunningNow(null);
  };

  const filteredRuns = selectedAutomation === "all" ? runs : runs.filter(r => r.automationId === selectedAutomation);

  const getRunMessages = (runId) => messages.filter(m => m.automationRunId === runId);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6" dir="rtl">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">📋 לוגים של אוטומציות</h1>
            <p className="text-gray-400 text-sm mt-1">היסטוריית ריצות והודעות שנשלחו</p>
          </div>
          <Button onClick={load} variant="outline" className="border-gray-700 text-gray-300 gap-2">
            <RefreshCw className="w-4 h-4" /> רענן
          </Button>
        </div>

        {/* Automation quick-run buttons */}
        {automations.length > 0 && (
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 mb-6">
            <p className="text-sm text-gray-400 mb-3">הפעלה ידנית מיידית:</p>
            <div className="flex flex-wrap gap-2">
              {automations.filter(a => a.isActive).map(a => (
                <Button
                  key={a.id}
                  size="sm"
                  disabled={runningNow === a.id}
                  onClick={() => handleRunNow(a.id, a.name)}
                  className="bg-blue-700 hover:bg-blue-600 text-white gap-1"
                >
                  <Play className="w-3 h-3" />
                  {runningNow === a.id ? "מריץ..." : a.name}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Filter */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <button
            onClick={() => setSelectedAutomation("all")}
            className={`px-3 py-1 rounded text-sm ${selectedAutomation === "all" ? "bg-yellow-500 text-gray-900 font-semibold" : "bg-gray-800 text-gray-300"}`}
          >הכל</button>
          {automations.map(a => (
            <button
              key={a.id}
              onClick={() => setSelectedAutomation(a.id)}
              className={`px-3 py-1 rounded text-sm ${selectedAutomation === a.id ? "bg-yellow-500 text-gray-900 font-semibold" : "bg-gray-800 text-gray-300"}`}
            >{a.name}</button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-gray-500 border-t-white rounded-full animate-spin" />
          </div>
        ) : filteredRuns.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>אין ריצות עדיין</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRuns.map(run => {
              const runMsgs = getRunMessages(run.id);
              const isExpanded = expandedRun === run.id;
              return (
                <div key={run.id} className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
                  <div
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-800/50"
                    onClick={() => setExpandedRun(isExpanded ? null : run.id)}
                  >
                    <div className="flex items-center gap-3">
                      {run.status === "completed" ? <CheckCircle className="w-5 h-5 text-green-400" /> :
                        run.status === "error" ? <XCircle className="w-5 h-5 text-red-400" /> :
                        <Clock className="w-5 h-5 text-blue-400 animate-spin" />}
                      <div>
                        <p className="font-medium text-white">{run.automationName}</p>
                        <p className="text-xs text-gray-500">{formatDate(run.startedAt)} · {run.triggeredBy === "manual" ? "ידני" : "אוטומטי"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {run.status === "completed" && (
                        <div className="flex gap-2 text-sm">
                          <span className="text-green-400">✓ {run.messagesSent}</span>
                          {run.messagesFailed > 0 && <span className="text-red-400">✗ {run.messagesFailed}</span>}
                        </div>
                      )}
                      <span className={`text-xs px-2 py-1 rounded border ${statusColor[run.status] || ""}`}>
                        {run.status === "completed" ? "הושלם" : run.status === "error" ? "שגיאה" : "רץ..."}
                      </span>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-gray-700 bg-gray-950/50">
                      {run.errorMessage && (
                        <div className="p-3 bg-red-900/20 border-b border-red-900/30">
                          <p className="text-red-400 text-sm">⚠️ {run.errorMessage}</p>
                        </div>
                      )}
                      {runMsgs.length === 0 ? (
                        <p className="text-gray-500 text-sm p-4">אין הודעות לוג לריצה זו</p>
                      ) : (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-800/50 text-gray-400">
                              <th className="text-right px-4 py-2">נמען</th>
                              <th className="text-right px-4 py-2">איש קשר</th>
                              <th className="text-right px-4 py-2">ערוץ</th>
                              <th className="text-right px-4 py-2">סטטוס</th>
                              <th className="text-right px-4 py-2">תוכן</th>
                            </tr>
                          </thead>
                          <tbody>
                            {runMsgs.map(msg => (
                              <tr key={msg.id} className="border-t border-gray-800 hover:bg-gray-800/30">
                                <td className="px-4 py-2 text-gray-200">{msg.recipientName}</td>
                                <td className="px-4 py-2 text-gray-400 text-xs">{msg.recipientContact}</td>
                                <td className="px-4 py-2 text-gray-400">{msg.channel}</td>
                                <td className={`px-4 py-2 font-medium ${msgStatusColor[msg.status]}`}>
                                  {msg.status === "sent" ? "✓ נשלח" : msg.status === "failed" ? `✗ נכשל${msg.error ? ": " + msg.error : ""}` : "דולג"}
                                </td>
                                <td className="px-4 py-2 text-gray-500 text-xs max-w-xs truncate">{msg.messageContent?.substring(0, 80)}...</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}