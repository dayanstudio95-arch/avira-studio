import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
const { Automation, StaffMember, Event, Tenant } = base44.entities;
import { useAuth } from "@/lib/SupabaseAuthContext";
import { toast } from "sonner";
import { X, Loader2, Users, CalendarClock, Plus, Trash2, Sparkles, Eye } from "lucide-react";
import { STAFF_JOB_ROLES } from "@/lib/staffRoles";
import TemplateVariablesHelp from "@/components/automations/TemplateVariablesHelp";
import { VARS_BY_AUDIENCE_TYPE } from "@/lib/automationTemplateVariables";

const CONDITION_FIELD_OPTIONS = [
  { value: "client_payment_status", label: "סטטוס תשלום" },
  { value: "album_status", label: "סטטוס אלבום" },
  { value: "event_date_relative", label: "תאריך אירוע (לפני/אחרי היום)" },
];

const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

function buildYearOptions() {
  const current = new Date().getFullYear();
  const years = [];
  for (let y = current - 1; y <= current + 2; y++) years.push(y);
  return years;
}
const YEAR_OPTIONS = buildYearOptions();

// Mirrors the backend's renderTemplate() literal {token} substitution, used
// here only for the client-side "preview before creating" — the real send
// still always goes through automation-engine's own renderTemplate().
function renderTemplateClient(template, vars) {
  let result = template || "";
  Object.entries(vars).forEach(([key, value]) => {
    result = result.split(`{${key}}`).join(value ?? "");
  });
  return result;
}

const PAYMENT_STATUS_OPTIONS = [
  { value: "Paid", label: "שולם" },
  { value: "Partially Paid", label: "שולם חלקית" },
  { value: "Unpaid", label: "לא שולם" },
];

const ALBUM_STATUS_OPTIONS = [
  { value: "pending", label: "לא נשלח" },
  { value: "sent", label: "נשלח" },
];

function defaultConditionForField(field) {
  if (field === "client_payment_status") return { field, op: "eq", value: "Unpaid" };
  if (field === "album_status") return { field, op: "eq", value: "pending" };
  return { field: "event_date_relative", op: "before_today", value: null };
}

export default function CreateCustomAutomationModal({ onClose, onCreated }) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("✨");
  const [audienceType, setAudienceType] = useState("staff_role");
  const [conditions, setConditions] = useState([]);
  const [messageTemplate, setMessageTemplate] = useState("");
  const [frequency, setFrequency] = useState("manual");
  const [runTime, setRunTime] = useState("09:00");
  const [runDay, setRunDay] = useState(1);
  const [targetMonthMode, setTargetMonthMode] = useState("next_month");
  const [saving, setSaving] = useState(false);

  // Staff-role audience: a real, hand-pickable list of staff members instead
  // of just a role dropdown — user checks exactly who's included.
  const [staffList, setStaffList] = useState([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [selectedStaffIds, setSelectedStaffIds] = useState(new Set());

  // Leads/events audience: "everyone" vs "specific month+year of the event date".
  const nowRef = new Date();
  const [leadsAudienceMode, setLeadsAudienceMode] = useState("all");
  const [leadsMonth, setLeadsMonth] = useState(String(nowRef.getMonth() + 1).padStart(2, "0"));
  const [leadsYear, setLeadsYear] = useState(String(nowRef.getFullYear()));

  // Preview (recipients + rendered message) before actually creating.
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const vars = VARS_BY_AUDIENCE_TYPE[audienceType] || [];

  const insertVar = (v) => setMessageTemplate((t) => t + v);

  useEffect(() => {
    let cancelled = false;
    setStaffLoading(true);
    StaffMember.list()
      .then((list) => {
        if (cancelled) return;
        setStaffList(list || []);
        setSelectedStaffIds(new Set((list || []).map((s) => s.id)));
      })
      .catch(() => { if (!cancelled) toast.error("שגיאה בטעינת רשימת הצוות"); })
      .finally(() => { if (!cancelled) setStaffLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Any change to audience/message invalidates a previously-generated preview.
  useEffect(() => {
    setPreview(null);
  }, [audienceType, selectedStaffIds, conditions, leadsAudienceMode, leadsMonth, leadsYear, messageTemplate]);

  const toggleStaffId = (id) => {
    setSelectedStaffIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const buildLeadsConditions = () => {
    const list = [...conditions];
    if (leadsAudienceMode === "month") {
      list.push({ field: "event_month_year", op: "eq", value: `${leadsYear}-${leadsMonth}` });
    }
    return list;
  };

  const matchesLeadsConditions = (event, cond, todayStr) => {
    for (const c of cond) {
      if (!c || !c.field) continue;
      if (c.field === "client_payment_status") {
        if (c.op === "eq" && event.clientPaymentStatus !== c.value) return false;
        if (c.op === "neq" && event.clientPaymentStatus === c.value) return false;
      } else if (c.field === "album_status") {
        if (c.op === "eq" && event.albumStatus !== c.value) return false;
        if (c.op === "neq" && event.albumStatus === c.value) return false;
      } else if (c.field === "event_date_relative") {
        if (!event.date) return false;
        const isPast = event.date < todayStr;
        if (c.op === "before_today" && !isPast) return false;
        if (c.op === "after_today" && isPast) return false;
      } else if (c.field === "event_month_year") {
        if (!event.date) return false;
        const monthYear = String(event.date).slice(0, 7);
        if (c.op === "eq" && monthYear !== c.value) return false;
        if (c.op === "neq" && monthYear === c.value) return false;
      }
    }
    return true;
  };

  const handlePreview = async () => {
    if (!messageTemplate.trim()) {
      toast.error("יש לכתוב תבנית הודעה לפני תצוגה מקדימה");
      return;
    }
    setPreviewLoading(true);
    try {
      let recipients = [];
      if (audienceType === "staff_role") {
        recipients = staffList
          .filter((s) => selectedStaffIds.has(s.id))
          .map((s) => ({
            id: s.id,
            name: s.name,
            phone: s.phoneNumber || "",
            message: renderTemplateClient(messageTemplate, { staff_name: s.name || "", staffName: s.name || "" }),
          }));
      } else {
        const events = await Event.list();
        const cond = buildLeadsConditions();
        const todayStr = new Date().toISOString().slice(0, 10);
        let studioName = "הסטודיו";
        try {
          if (user?.tenant_id) {
            const tenant = await Tenant.get(user.tenant_id);
            studioName = tenant?.displayNameToClients || tenant?.name || studioName;
          }
        } catch {
          // best-effort only — preview still works without the real studio name
        }
        recipients = (events || [])
          .filter((e) => e.phoneNumber && matchesLeadsConditions(e, cond, todayStr))
          .map((e) => ({
            id: e.id,
            name: e.coupleNames,
            phone: e.phoneNumber || "",
            message: renderTemplateClient(messageTemplate, {
              coupleNames: e.coupleNames || "",
              eventDate: e.date || "",
              venueName: e.venue || "",
              studioName,
            }),
          }));
      }
      setPreview({ recipients });
    } catch (e) {
      toast.error("שגיאה בהפקת תצוגה מקדימה: " + e.message);
    }
    setPreviewLoading(false);
  };

  const addCondition = () => {
    setConditions((prev) => [...prev, defaultConditionForField("client_payment_status")]);
  };
  const updateCondition = (idx, patch) => {
    setConditions((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };
  const removeCondition = (idx) => {
    setConditions((prev) => prev.filter((_, i) => i !== idx));
  };
  const changeConditionField = (idx, field) => {
    setConditions((prev) => prev.map((c, i) => (i === idx ? defaultConditionForField(field) : c)));
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("יש להזין שם לאוטומציה");
      return;
    }
    if (!messageTemplate.trim()) {
      toast.error("יש לכתוב תבנית הודעה");
      return;
    }
    if (audienceType === "staff_role" && selectedStaffIds.size === 0) {
      toast.error("יש לבחור לפחות איש צוות אחד");
      return;
    }

    const audienceConfig =
      audienceType === "staff_role"
        ? { role: "custom", staffIds: Array.from(selectedStaffIds) }
        : { conditions: buildLeadsConditions() };

    setSaving(true);
    try {
      await Automation.create({
        name: name.trim(),
        emoji,
        type: "custom",
        audience_type: audienceType,
        audience_config: audienceConfig,
        frequency,
        run_time: runTime,
        run_day: Number(runDay) || 1,
        target_month_mode: targetMonthMode,
        channel: "whatsapp",
        messageTemplate: messageTemplate.trim(),
        isActive: true,
      });
      toast.success("האוטומציה נוצרה בהצלחה — הריצו אותה ידנית כדי לבדוק לפני שהיא פעילה");
      onCreated();
    } catch (e) {
      toast.error("שגיאה ביצירת האוטומציה: " + e.message);
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="bg-gray-900/95 border-b border-gray-700 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-900/60 border border-purple-700/50 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">אוטומציה חדשה</h2>
              <p className="text-gray-400 text-xs">בחרו קהל יעד, כתבו הודעה וקבעו תזמון</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-gray-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* ── Basic info ── */}
          <section className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
            <h3 className="text-purple-300 font-semibold text-sm">📛 שם ואייקון</h3>
            <div className="flex gap-3">
              <input
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                maxLength={2}
                className="w-16 text-center bg-gray-700/60 border border-gray-600 text-white rounded-lg px-2 py-2 text-lg"
              />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="לדוגמה: תזכורת לצלמי וידאו"
                dir="rtl"
                className="flex-1 bg-gray-700/60 border border-gray-600 text-white placeholder-gray-500 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </section>

          {/* ── Audience type ── */}
          <section className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
            <h3 className="text-purple-300 font-semibold text-sm flex items-center gap-2">
              <Users className="w-4 h-4" /> קהל יעד
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setAudienceType("staff_role")}
                className={`px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                  audienceType === "staff_role"
                    ? "bg-purple-900/50 border-purple-600 text-white"
                    : "bg-gray-700/40 border-gray-600 text-gray-300 hover:bg-gray-700"
                }`}
              >
                👥 אנשי צוות
              </button>
              <button
                onClick={() => setAudienceType("leads_events")}
                className={`px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                  audienceType === "leads_events"
                    ? "bg-purple-900/50 border-purple-600 text-white"
                    : "bg-gray-700/40 border-gray-600 text-gray-300 hover:bg-gray-700"
                }`}
              >
                💍 לקוחות ואירועים
              </button>
            </div>

            {audienceType === "staff_role" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-gray-400 text-xs">
                    {staffLoading
                      ? "טוען רשימת צוות..."
                      : `${selectedStaffIds.size} מתוך ${staffList.length} נבחרו`}
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedStaffIds(new Set(staffList.map((s) => s.id)))}
                      className="text-xs text-purple-300 hover:text-purple-200"
                    >
                      בחר הכל
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedStaffIds(new Set())}
                      className="text-xs text-gray-400 hover:text-gray-300"
                    >
                      נקה הכל
                    </button>
                  </div>
                </div>
                {staffLoading ? (
                  <div className="flex items-center justify-center py-6 text-gray-400">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                ) : staffList.length === 0 ? (
                  <p className="text-gray-500 text-xs">לא נמצאו אנשי צוות במערכת.</p>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-1 bg-gray-900/40 border border-gray-700 rounded-lg p-2">
                    {staffList.map((s) => {
                      const roleLabel = STAFF_JOB_ROLES.find((r) => r.value === s.role)?.label || s.role || "";
                      return (
                        <label
                          key={s.id}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-700/40 cursor-pointer text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={selectedStaffIds.has(s.id)}
                            onChange={() => toggleStaffId(s.id)}
                            className="w-4 h-4 accent-purple-600"
                          />
                          <span className="text-white">{s.name}</span>
                          {roleLabel && <span className="text-gray-500 text-xs">({roleLabel})</span>}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {audienceType === "leads_events" && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setLeadsAudienceMode("all")}
                    className={`px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                      leadsAudienceMode === "all"
                        ? "bg-purple-900/50 border-purple-600 text-white"
                        : "bg-gray-700/40 border-gray-600 text-gray-300 hover:bg-gray-700"
                    }`}
                  >
                    לכל הלקוחות/אירועים
                  </button>
                  <button
                    type="button"
                    onClick={() => setLeadsAudienceMode("month")}
                    className={`px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                      leadsAudienceMode === "month"
                        ? "bg-purple-900/50 border-purple-600 text-white"
                        : "bg-gray-700/40 border-gray-600 text-gray-300 hover:bg-gray-700"
                    }`}
                  >
                    לפי חודש ושנה של האירוע
                  </button>
                </div>

                {leadsAudienceMode === "month" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-gray-400 text-xs block mb-1">חודש</label>
                      <select
                        value={leadsMonth}
                        onChange={(e) => setLeadsMonth(e.target.value)}
                        className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
                      >
                        {HEBREW_MONTHS.map((m, idx) => (
                          <option key={m} value={String(idx + 1).padStart(2, "0")}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-gray-400 text-xs block mb-1">שנה</label>
                      <select
                        value={leadsYear}
                        onChange={(e) => setLeadsYear(e.target.value)}
                        className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
                      >
                        {YEAR_OPTIONS.map((y) => (
                          <option key={y} value={String(y)}>{y}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <div className="pt-2 border-t border-gray-700/60 space-y-2">
                  <p className="text-gray-400 text-xs">סינון נוסף (אופציונלי)</p>
                  {conditions.length === 0 && (
                    <p className="text-gray-500 text-xs">אין תנאי סינון נוסף.</p>
                  )}
                  {conditions.map((c, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-gray-700/40 border border-gray-600 rounded-lg p-2">
                    <select
                      value={c.field}
                      onChange={(e) => changeConditionField(idx, e.target.value)}
                      className="bg-gray-700 border border-gray-600 text-white rounded-lg px-2 py-1.5 text-xs"
                    >
                      {CONDITION_FIELD_OPTIONS.map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>

                    {c.field === "event_date_relative" ? (
                      <select
                        value={c.op}
                        onChange={(e) => updateCondition(idx, { op: e.target.value })}
                        className="bg-gray-700 border border-gray-600 text-white rounded-lg px-2 py-1.5 text-xs flex-1"
                      >
                        <option value="before_today">עבר (לפני היום)</option>
                        <option value="after_today">עתידי (אחרי היום)</option>
                      </select>
                    ) : (
                      <>
                        <select
                          value={c.op}
                          onChange={(e) => updateCondition(idx, { op: e.target.value })}
                          className="bg-gray-700 border border-gray-600 text-white rounded-lg px-2 py-1.5 text-xs"
                        >
                          <option value="eq">שווה ל</option>
                          <option value="neq">שונה מ</option>
                        </select>
                        <select
                          value={c.value || ""}
                          onChange={(e) => updateCondition(idx, { value: e.target.value })}
                          className="bg-gray-700 border border-gray-600 text-white rounded-lg px-2 py-1.5 text-xs flex-1"
                        >
                          {(c.field === "client_payment_status" ? PAYMENT_STATUS_OPTIONS : ALBUM_STATUS_OPTIONS).map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </>
                    )}

                    <button onClick={() => removeCondition(idx)} className="text-gray-400 hover:text-red-400 p-1">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                  <button
                    onClick={addCondition}
                    className="flex items-center gap-1.5 text-xs text-purple-300 hover:text-purple-200 px-2 py-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" /> הוספת תנאי סינון
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* ── Message template ── */}
          <section className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
            <h3 className="text-purple-300 font-semibold text-sm">💬 תבנית הודעה</h3>
            <TemplateVariablesHelp vars={vars} onInsert={insertVar} />
            <textarea
              value={messageTemplate}
              onChange={(e) => setMessageTemplate(e.target.value)}
              rows={6}
              dir="rtl"
              className="w-full bg-gray-700/60 border border-gray-600 text-white placeholder-gray-500 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:border-purple-500"
              placeholder="הכנס תבנית הודעה..."
            />
          </section>

          {/* ── Preview ── */}
          <section className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-purple-300 font-semibold text-sm flex items-center gap-2">
                <Eye className="w-4 h-4" /> תצוגה מקדימה
              </h3>
              <button
                type="button"
                onClick={handlePreview}
                disabled={previewLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-200 text-xs font-medium transition-colors disabled:opacity-60"
              >
                {previewLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                הצג תצוגה מקדימה
              </button>
            </div>
            <p className="text-gray-500 text-xs">
              בדקו כאן למי בדיוק תישלח ההודעה ואיך היא תיראה, לפני יצירת האוטומציה בפועל.
            </p>
            {preview && (
              <div className="space-y-2">
                <p className="text-gray-300 text-xs font-medium">
                  {preview.recipients.length === 0
                    ? "לא נמצאו נמענים התואמים את הבחירה הנוכחית."
                    : `נמצאו ${preview.recipients.length} נמענים:`}
                </p>
                {preview.recipients.length > 0 && (
                  <div className="max-h-56 overflow-y-auto space-y-2">
                    {preview.recipients.map((r) => (
                      <div key={r.id} className="bg-gray-900/50 border border-gray-700 rounded-lg p-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-white text-sm font-medium">{r.name || "—"}</span>
                          <span className="text-gray-500 text-xs">{r.phone || "אין מספר טלפון"}</span>
                        </div>
                        <p className="text-gray-400 text-xs whitespace-pre-wrap">{r.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── Schedule ── */}
          <section className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
            <h3 className="text-purple-300 font-semibold text-sm flex items-center gap-2">
              <CalendarClock className="w-4 h-4" /> תזמון
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-gray-400 text-xs block mb-1">תדירות</label>
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
                >
                  <option value="manual">ידני</option>
                  <option value="daily">יומי</option>
                  <option value="monthly_1st">חודשי (יום קבוע)</option>
                </select>
              </div>
              {frequency !== "manual" && (
                <div>
                  <label className="text-gray-400 text-xs block mb-1">שעת הרצה</label>
                  <input
                    type="time"
                    value={runTime}
                    onChange={(e) => setRunTime(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              )}
              {frequency === "monthly_1st" && (
                <>
                  <div>
                    <label className="text-gray-400 text-xs block mb-1">יום בחודש (1-31)</label>
                    <input
                      type="number" min={1} max={31}
                      value={runDay}
                      onChange={(e) => setRunDay(e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs block mb-1">חודש יעד</label>
                    <select
                      value={targetMonthMode}
                      onChange={(e) => setTargetMonthMode(e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="next_month">חודש הבא</option>
                      <option value="current_month">חודש נוכחי</option>
                    </select>
                  </div>
                </>
              )}
            </div>
            <p className="text-amber-400/80 text-xs bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2">
              ⚠️ בשלב זה, אוטומציות מסוג "חדשות" (מותאמות אישית) פועלות רק בהרצה ידנית — גם אם נקבע תזמון, המערכת לא תשלח אוטומטית עד שתריצו אותה ידנית לפחות פעם אחת ותוודאו שהיא עובדת כמצופה.
            </p>
          </section>
        </div>

        {/* Footer */}
        <div className="bg-gray-900/95 border-t border-gray-700 px-6 py-4 flex gap-3 rounded-b-2xl justify-end items-center">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-lg border border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700 text-sm font-medium transition-colors"
          >
            ביטול
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold transition-colors disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            יצירת אוטומציה
          </button>
        </div>
      </div>
    </div>
  );
}
