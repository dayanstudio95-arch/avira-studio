import React, { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { CalendarDays, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { sendSummary } from "@/lib/actionOutcome";
import { confirmDialog } from "@/components/ui/confirm-dialog";

// "לוח עבודות לאנשי צוות" (2026-11-02, the owner's request): choose the period (this year and next, or one year — from
// today on either way) and any number of team members; each gets his own message with every date he works, by month
// and year ("24/11/26 טרויה - צלם ראשי"), in parts when it is long. The automation engine builds and sends it
// (runStaffSchedule, _shared/staffSchedule.ts); this window shows its dry run and sends only the members ticked.

const israelYear = () => Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric" }).format(new Date()));

export default function StaffScheduleModal({ automation, onClose, onSent }) {
  const year = israelYear();
  const periods = [
    { key: "both", label: `השנה והשנה הבאה (${year}–${year + 1})`, years: [String(year), String(year + 1)] },
    { key: "this", label: `רק ${year}`, years: [String(year)] },
    { key: "next", label: `רק ${year + 1}`, years: [String(year + 1)] },
  ];
  const [period, setPeriod] = useState("both");
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [active, setActive] = useState(null);
  const [sending, setSending] = useState(false);
  const request = useRef(0);
  const years = periods.find((p) => p.key === period).years;

  useEffect(() => {
    const req = ++request.current;
    setRows(null);
    base44.functions
      .invoke("automationEngine", { automation_id: automation.id, triggered_by: "manual", dry_run: true, schedule_years: years })
      .then((res) => {
        if (req !== request.current) return;
        const list = res.data?.results?.[0]?.previews || [];
        setRows(list);
        // A member without dates in the new period can't stay ticked.
        setSelected((prev) => new Set([...prev].filter((id) => list.some((r) => r.staffId === id && r.eventCount > 0))));
      })
      .catch((e) => {
        if (req === request.current) {
          setRows([]);
          toast.error("שגיאה בטעינת התאריכים: " + e.message);
        }
      });
  }, [period, automation.id]);

  const toggle = (r) => {
    if (!r.eventCount) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(r.staffId) ? next.delete(r.staffId) : next.add(r.staffId);
      return next;
    });
    setActive(r.staffId);
  };
  const withDates = (rows || []).filter((r) => r.eventCount > 0);
  const shown = (rows || []).find((r) => r.staffId === active) || (rows || []).find((r) => selected.has(r.staffId)) || withDates[0];

  const send = async () => {
    const chosen = (rows || []).filter((r) => selected.has(r.staffId));
    if (!chosen.length) return toast.error("סמנו לפחות איש צוות אחד");
    const parts = chosen.reduce((n, r) => n + (r.parts?.length || 1), 0);
    if (
      !(await confirmDialog({
        title: `לשלוח את לוח העבודות ל-${chosen.length} אנשי צוות?`,
        message: `${chosen.map((r) => r.name).join(", ")}\nכל אחד יקבל בוואטסאפ את התאריכים שלו${parts > chosen.length ? ` (${parts} הודעות בסך הכל, כי יש מי שמקבל בכמה חלקים)` : ""}.`,
        confirmText: "שלח",
      }))
    )
      return;
    setSending(true);
    try {
      const res = await base44.functions.invoke("automationEngine", {
        automation_id: automation.id,
        triggered_by: "manual",
        schedule_years: years,
        selectedStaffIds: chosen.map((r) => r.staffId),
      });
      const { text, level } = sendSummary(res.data?.results?.[0]);
      toast[level](text);
      onSent();
      onClose();
    } catch (e) {
      toast.error("שגיאה בשליחה: " + e.message);
    }
    setSending(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl" data-testid="staff-schedule-modal">
        <div className="border-b border-gray-700 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-900/60 border border-indigo-700/50 flex items-center justify-center">
              <CalendarDays className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">לוח עבודות לאנשי צוות</h2>
              <p className="text-gray-400 text-xs">כל התאריכים מהיום והלאה: תאריך, אולם ותפקיד, לפי חודשים. העורך לא נכלל — הוא לא עובד ביום האירוע.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-gray-800" aria-label="סגירה">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pt-4 flex flex-wrap gap-2">
          {periods.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              className={`text-sm px-3 py-1.5 rounded-full border ${period === p.key ? "bg-indigo-900/50 border-indigo-500 text-indigo-200" : "bg-gray-800/40 border-gray-700 text-gray-400 hover:text-white"}`}
              data-testid={`schedule-period-${p.key}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {rows === null ? (
          <div className="flex-1 flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
          </div>
        ) : (
          <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 px-6 py-4 min-h-0">
            <div className="overflow-y-auto border border-gray-700/60 rounded-xl divide-y divide-gray-800/60 max-h-[55vh]">
              <div className="flex gap-2 px-3 py-2 sticky top-0 bg-gray-900">
                <button type="button" onClick={() => setSelected(new Set(withDates.map((r) => r.staffId)))} className="text-xs px-2.5 py-1 bg-indigo-900/40 border border-indigo-700/50 text-indigo-300 rounded">
                  כל מי שיש לו תאריכים
                </button>
                <button type="button" onClick={() => setSelected(new Set())} className="text-xs px-2.5 py-1 bg-gray-700/40 border border-gray-600/50 text-gray-300 rounded">
                  נקה
                </button>
              </div>
              {rows.map((r) => (
                <label
                  key={r.staffId}
                  className={`flex items-center gap-2.5 px-3 py-2.5 ${r.eventCount ? "cursor-pointer" : "opacity-45"} ${shown?.staffId === r.staffId ? "bg-gray-800/70" : ""}`}
                  onMouseEnter={() => r.eventCount && setActive(r.staffId)}
                  data-testid="schedule-staff"
                >
                  <input type="checkbox" checked={selected.has(r.staffId)} disabled={!r.eventCount} onChange={() => toggle(r)} className="w-4 h-4 accent-indigo-500" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-white truncate">{r.name}</span>
                    <span className="block text-[11px] text-gray-500">
                      {r.eventCount === 1 ? "תאריך אחד" : r.eventCount ? `${r.eventCount} תאריכים` : "אין תאריכים בתקופה"}
                      {r.eventCount > 0 && !r.staffPhone ? " · ⚠️ אין טלפון" : ""}
                      {r.parts?.length > 1 ? ` · ${r.parts.length} חלקים` : ""}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <div className="overflow-y-auto max-h-[55vh] space-y-2" data-testid="schedule-preview">
              {shown ? (
                <>
                  <p className="text-xs text-gray-400">
                    כך זה יגיע ל{shown.name} בוואטסאפ{shown.parts?.length > 1 ? ` — ב-${shown.parts.length} הודעות` : ""}:
                  </p>
                  {(shown.parts || []).map((p, i) => (
                    <pre key={i} className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-gray-100 bg-emerald-950/40 border border-emerald-800/40 rounded-xl p-3 max-w-md" dir="rtl">
                      {p}
                    </pre>
                  ))}
                </>
              ) : (
                <p className="text-sm text-gray-500 py-10 text-center">אין לאף איש צוות תאריכים בתקופה הזו.</p>
              )}
            </div>
          </div>
        )}

        <div className="border-t border-gray-700 px-6 py-4 flex items-center justify-between gap-3">
          <span className="text-xs text-gray-500">שום דבר לא נשלח עד הלחיצה על "שלח".</span>
          <Button onClick={send} disabled={sending || selected.size === 0} className="bg-green-600 hover:bg-green-700 text-white font-semibold gap-2" data-testid="schedule-send">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {selected.size ? `שלח ל-${selected.size}` : "שלח"}
          </Button>
        </div>
      </div>
    </div>
  );
}
