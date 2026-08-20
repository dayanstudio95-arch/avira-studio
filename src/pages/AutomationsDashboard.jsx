import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
const { Automation, AutomationRun, StaffMember, Event, Lead } = base44.entities;
import QuestionnaireSendPreviewModal from "@/components/automations/QuestionnaireSendPreviewModal";
import AlbumReminderPreviewModal from "@/components/automations/AlbumReminderPreviewModal";
import CustomStaffMessageModal from "@/components/automations/CustomStaffMessageModal";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Settings, Play, Clock, Calendar, Loader2, X, Send, Eye, RefreshCw, ChevronDown, ChevronUp, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { format } from "date-fns";

// ── Default automations to seed if none exist ──────────────────────────────
const DEFAULTS = [
  {
    name: "סיכום חודשי לצוות",
    type: "monthly_staff_summary",
    emoji: "📊",
    frequency: "monthly_1st",
    run_day: 1,
    run_time: "09:00",
    target_month_mode: "next_month",
    channel: "whatsapp",
    messageTemplate: "שלום {staffName}! הנה סיכום העבודות שלך לחודש {month}:\n{eventsList}\nתודה רבה! 🙏",
    isActive: true,
  },
  {
    name: "תזכורת צלם יום לפני",
    type: "daily_event_brief",
    emoji: "📸",
    frequency: "daily",
    run_time: "20:00",
    channel: "whatsapp",
    messageTemplate: "היי {staffName}! תזכורת לאירוע מחר:\n👫 {coupleNames}\n📍 {venue}\n🕐 {time}\n📋 פרטי הפקה:\n{productionDetails}\nבהצלחה! 🎉",
    isActive: true,
  },
  {
    name: "תזכורת אלבום לזוג",
    type: "album_reminder",
    emoji: "💝",
    frequency: "manual",
    channel: "whatsapp",
    messageTemplate: "שלום {coupleNames}! 💕\nתודה שבחרתם בנו לצלם את היום המיוחד שלכם!\nהאלבום שלכם מוכן 📸✨\nנשמח לשמוע מכם!\n{studioName} 🖤",
    isActive: true,
    mediaFileUrl: "",
  },
  {
    name: "תזכורת תשלום לאחר אירוע",
    type: "payment_reminder",
    emoji: "💰",
    frequency: "daily",
    run_time: "10:00",
    channel: "whatsapp",
    messageTemplate: "שלום {coupleNames} 😊\nתודה שבחרתם בנו לצלם את האירוע המיוחד שלכם!\nלפי הרשומות שלנו, נותר לכם לשלם: {remainingBalance}₪\nנשמח לסגור את התשלום בהקדם 🙏\n{studioName}",
    isActive: true,
  },
  {
    name: "תזכורת שאלון",
    type: "questionnaire_reminder",
    emoji: "📋",
    frequency: "daily",
    run_time: "10:00",
    channel: "whatsapp",
    messageTemplate: "שלום {coupleNames} 😊\nאנחנו מתרגשים לאירוע שלכם ב-{eventDate}!\nכדי שנוכל להיכנס בצורה הטובה ביקשנו למלא את השאלון המצורף:\n{questionnaireLink}\nתודה! 🙏\n{studioName}",
    isActive: true,
  },
  {
    name: "שליחת שאלון הכנה לזוגות",
    type: "questionnaire_send",
    emoji: "📝",
    frequency: "monthly_1st",
    run_day: 1,
    months_ahead: 1,
    channel: "whatsapp",
    messageTemplate: "היי {coupleNames}, ההתרגשות בשיאה! 🥂\nלקראת האירוע שלכם, אנחנו רוצים לוודא שכל הפרטים מסונכרנים אצלנו במערכת. 📋\nנשמח אם תוכלו למלא את השאלון הקצר בקישור הבא כדי שנוכל לתת לכם את השירות הטוב ביותר ❤️\n{questionnaireUrl}\nתודה! {studioName} 📸",
    isActive: false,
  },
  {
    name: "הודעה מותאמת אישית לצוות",
    type: "custom_staff_message",
    emoji: "✍️",
    frequency: "manual",
    channel: "whatsapp",
    // Placeholder only — the compose modal always sends fresh text on every run,
    // so this saved value is never actually used to send anything.
    messageTemplate: "כתבו כאן הודעה חופשית שתישלח לצוות שתבחרו (למשל לכל צלמי הווידאו).",
    isActive: true,
  },
];

// ── Variable chips per automation type ─────────────────────────────────────
const VARS_BY_TYPE = {
  monthly_staff_summary: ["{staffName}", "{month}", "{eventsList}", "{eventCount}", "{totalDays}"],
  daily_event_brief: ["{staffName}", "{coupleNames}", "{venue}", "{date}", "{time}", "{productionDetails}", "{photographer}", "{videographer}"],
  album_reminder: ["{coupleNames}", "{albumLink}", "{date}", "{venue}", "{studioName}"],
  payment_reminder: ["{coupleNames}", "{remainingBalance}", "{eventDate}", "{venueName}", "{studioName}"],
  questionnaire_reminder: ["{coupleNames}", "{eventDate}", "{venue}", "{questionnaireLink}", "{studioName}"],
  // Added (2026-08-18) — this type was missing from the map entirely (pre-existing gap,
  // unrelated to the studioName fix), so its merge-field chips were never shown in the
  // template editor even though the handler (automation-engine's runQuestionnaireSend)
  // supports all of these.
  questionnaire_send: ["{coupleNames}", "{venue}", "{date}", "{questionnaireUrl}", "{studioName}"],
};

const FREQ_LABELS = {
  monthly_1st: "ראשון לחודש",
  daily: "יומי",
  manual: "ידני",
};

const FREQ_COLORS = {
  monthly_1st: "bg-indigo-900/60 text-indigo-300 border-indigo-700",
  daily: "bg-purple-900/60 text-purple-300 border-purple-700",
  manual: "bg-gray-800/60 text-gray-400 border-gray-600",
};

function formatPhone(raw) {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0")) return "972" + digits.slice(1);
  return digits;
}

function buildPreview(template, type) {
  const samples = {
    staffName: "דניאל",
    month: "אפריל 2026",
    eventsList: "• 5/4 - שרה ודוד, גן אירועים הנסיכה\n• 12/4 - רונית ויוסי, אולמי הזהב",
    eventCount: "5",
    totalDays: "8",
    coupleNames: "שרה ודוד",
    venue: "גן אירועים הנסיכה",
    date: "05/04/2026",
    time: "18:00",
    productionDetails: "צילום סטילס + וידאו + עריכה",
    photographer: "דניאל",
    videographer: "אלון",
    albumLink: "https://album.link/example",
    remainingBalance: "2,500",
    venueName: "גן אירועים הנסיכה",
    eventDate: "05/04/2026",
  };
  let preview = template || "";
  Object.entries(samples).forEach(([k, v]) => {
    preview = preview.replaceAll(`{${k}}`, v);
  });
  return preview;
}

// ── Settings Modal ──────────────────────────────────────────────────────────
function SettingsModal({ automation, onClose, onSaved }) {
  const [form, setForm] = useState({
    frequency: automation.frequency || "manual",
    run_day: automation.runDay || 1,
    run_time: automation.runTime || "09:00",
    target_month_mode: automation.targetMonthMode || "next_month",
    messageTemplate: automation.messageTemplate || "",
    mediaFileUrl: automation.mediaFileUrl || "",
    test_phone: "",
    test_mode: automation.testMode || false,
    selectedStaffIds: automation.selectedStaffIds || [],
  });
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [staffList, setStaffList] = useState([]);

  const now = new Date();
  const [previewMonth, setPreviewMonth] = useState(now.getMonth() + 1);
  const [previewYear, setPreviewYear] = useState(now.getFullYear());
  const [realPreviews, setRealPreviews] = useState([]);
  const [loadingReal, setLoadingReal] = useState(false);
  const [previewSelected, setPreviewSelected] = useState(new Set()); // for questionnaire_send checkboxes

  const vars = VARS_BY_TYPE[automation.type] || [];
  const showStaffFilter = ["monthly_staff_summary", "daily_event_brief"].includes(automation.type);
  const HEBREW_MONTHS = ["","ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

  React.useEffect(() => {
    if (showStaffFilter) {
      StaffMember.list().then(setStaffList).catch(() => {});
    }
  }, [showStaffFilter]);

  const loadRealPreview = async () => {
    setLoadingReal(true);
    setRealPreviews([]);
    try {
      const allEvents = await Event.list();
      const allStaff = staffList.length > 0 ? staffList : await StaffMember.list();

      if (automation.type === "album_reminder") {
        const pending = allEvents.filter(e =>
          e.albumStatus === "pending" && e.album_reminder_sent !== true && e.coupleNames
        );
        const previews = pending.map(e => ({
          name: e.coupleNames,
          phone: e.phoneNumber || "",
          message: form.messageTemplate
            .replaceAll("{coupleNames}", e.coupleNames || "")
            .replaceAll("{date}", e.date ? format(new Date(e.date), "dd/MM/yyyy") : "")
            .replaceAll("{venue}", e.venue || "")
            .replaceAll("{albumLink}", e.final_link || ""),
        }));
        setRealPreviews(previews);
      } else if (automation.type === "monthly_staff_summary") {
        const monthEvents = allEvents.filter(e => {
          if (!e.date) return false;
          const d = new Date(e.date);
          return d.getMonth() + 1 === previewMonth && d.getFullYear() === previewYear;
        });
        const monthLabel = `${HEBREW_MONTHS[previewMonth]} ${previewYear}`;
        const staffToShow = form.selectedStaffIds.length > 0
          ? allStaff.filter(s => form.selectedStaffIds.includes(s.id))
          : allStaff;
        const previews = staffToShow.map(staff => {
          const myEvents = monthEvents.filter(e =>
            (e.team || []).some(m => m.staffMemberName === staff.name)
          );
          if (myEvents.length === 0) return null;
          const eventsList = myEvents
            .sort((a, b) => new Date(a.date) - new Date(b.date))
            .map(e => `• ${format(new Date(e.date), "d/M")} - ${e.coupleNames || ""}, ${e.venue || ""}`.trim())
            .join("\n");
          const message = form.messageTemplate
            .replaceAll("{staffName}", staff.name)
            .replaceAll("{month}", monthLabel)
            .replaceAll("{eventsList}", eventsList)
            .replaceAll("{eventCount}", String(myEvents.length))
            .replaceAll("{totalDays}", String(myEvents.length));
          return { name: staff.name, phone: staff.phoneNumber || "", message, count: myEvents.length };
        }).filter(Boolean);
        setRealPreviews(previews);
      } else if (automation.type === "daily_event_brief") {
        const monthEvents = allEvents.filter(e => {
          if (!e.date) return false;
          const d = new Date(e.date);
          return d.getMonth() + 1 === previewMonth && d.getFullYear() === previewYear;
        }).sort((a, b) => new Date(a.date) - new Date(b.date));
        // Filter: only photographers and videographers (no editors)
        const staffToShow = (form.selectedStaffIds.length > 0
          ? allStaff.filter(s => form.selectedStaffIds.includes(s.id))
          : allStaff).filter(s => s.role !== 'editor');
        // Pull real production-questionnaire answers from the linked lead —
        // matches the exact field list/labels used server-side in
        // automation-engine/index.ts's runDailyEventBrief and in
        // _shared/googleCalendarSync.ts's buildEventPayload, so this
        // "preview with real data" panel shows the same content the real
        // send would produce (previously used e.notes as a stand-in, which
        // is a different field entirely and is usually empty).
        const allLeads = await Lead.list();
        const buildProductionDetails = (event) => {
          const lead = allLeads.find(l => l.id === event.sourceLeadId)
            || allLeads.find(l => l.coupleNames === event.coupleNames);
          if (!lead) return "";
          const lines = [
            lead.productionBridePhone && `📱 נייד כלה: ${lead.productionBridePhone}`,
            lead.productionGroomPhone && `📱 נייד חתן: ${lead.productionGroomPhone}`,
            lead.productionCompanionName && `🧑‍🤝‍🧑 שם מלווה: ${lead.productionCompanionName}`,
            lead.productionCompanionPhone && `📱 נייד מלווה: ${lead.productionCompanionPhone}`,
            lead.productionBridePrepLocation && `📍 מקום התארגנות הכלה: ${lead.productionBridePrepLocation}`,
            lead.productionCheckinTime && `🕐 שעת הגעה / קבלת פנים: ${lead.productionCheckinTime}`,
            lead.productionChuppahTime && `💍 שעת חופה משוערת: ${lead.productionChuppahTime}`,
            lead.productionBrideInstagram && `📸 אינסטגרם כלה: ${lead.productionBrideInstagram}`,
            lead.productionGroomInstagram && `📸 אינסטגרם חתן: ${lead.productionGroomInstagram}`,
            lead.productionHasSocialCreator &&
              `📷 סושיאל קריאייטור באירוע: ${[lead.productionSocialCreatorName, lead.productionSocialCreatorPhone].filter(Boolean).join(' — ') || '—'}`,
            lead.productionHasExternalPlanner &&
              `🗂️ יש מנהל/ת אירוע חיצוני/ת: ${[lead.productionExternalPlannerName, lead.productionExternalPlannerPhone].filter(Boolean).join(' — ') || '—'}`,
            lead.productionFamilyBride && `👪 משפחת הכלה: ${lead.productionFamilyBride}`,
            lead.productionFamilyGroom && `👪 משפחת החתן: ${lead.productionFamilyGroom}`,
            lead.productionImportantPeople && `⭐ אנשים חשובים במיוחד לצלם: ${lead.productionImportantPeople}`,
            lead.productionFamilySensitivities && `⚠️ רגישויות משפחתיות: ${lead.productionFamilySensitivities}`,
            lead.productionPlannedSurprises && `🎁 הפתעות מתוכננות באירוע: ${lead.productionPlannedSurprises}`,
            lead.productionSpecialRequests && `💬 בקשות מיוחדות: ${lead.productionSpecialRequests}`,
          ].filter(Boolean);
          return lines.join("\n") || lead.finalTechnicalSummary || "";
        };
        const previews = [];
        for (const e of monthEvents) {
          const team = e.team || [];
          const productionDetails = buildProductionDetails(e) || "הזוג טרם מילא שאלון הפקה";
          const lead = allLeads.find(l => l.id === e.sourceLeadId) || allLeads.find(l => l.coupleNames === e.coupleNames);
          const eventTime = lead?.productionCheckinTime || lead?.productionChuppahTime || "18:00";
          for (const member of team) {
            const staff = staffToShow.find(s => s.name === member.staffMemberName);
            if (!staff) continue;
            const message = form.messageTemplate
              .replaceAll("{staffName}", staff.name)
              .replaceAll("{coupleNames}", e.coupleNames || "")
              .replaceAll("{venue}", e.venue || "")
              .replaceAll("{date}", e.date ? format(new Date(e.date), "dd/MM/yyyy") : "")
              .replaceAll("{time}", eventTime)
              .replaceAll("{productionDetails}", productionDetails)
              .replaceAll("{photographer}", team.find(m => m.role==="photographer1")?.staffMemberName || "")
              .replaceAll("{videographer}", team.find(m => m.role==="videographer")?.staffMemberName || "");
            previews.push({ name: staff.name, phone: staff.phoneNumber || "", event: e.coupleNames, date: e.date, message });
          }
        }
        setRealPreviews(previews);
      } else if (automation.type === "questionnaire_send") {
        const mm = String(previewMonth).padStart(2, '0');
        const targetYYYYMM = `${previewYear}-${mm}`;
        const res = await base44.functions.invoke("automationEngine", {
          automation_id: automation.id,
          triggered_by: "manual",
          dry_run: true,
          targetYYYYMM,
        });
        const groups = res.data?.results?.[0]?.groups || {};
        const allItems = [
          ...(groups.readyToSend || []),
          ...(groups.sentNoReply || []),
          ...(groups.completed || []),
        ];
        const previews = allItems.map(item => ({
          eventId: item.eventId || item.staffId || null,
          name: item.name || '',
          phone: item.staffPhone || '',
          date: item.eventDate || '',
          message: item.message || '',
          questionnaireSentAt: item.questionnaireSentAt || null,
          productionFormFilledAt: item.productionFormFilledAt || null,
        }));
        setRealPreviews(previews);
        // Default selection: checked only if NOT filled
        if (automation.type === 'questionnaire_send') {
          const defaultSelected = new Set(
            previews.filter(p => !p.productionFormFilledAt).map(p => p.eventId).filter(Boolean)
          );
          setPreviewSelected(defaultSelected);
        }
      } else if (automation.type === "payment_reminder") {
        const monthEvents = allEvents.filter(e => {
          if (!e.date) return false;
          const d = new Date(e.date);
          return d.getMonth() + 1 === previewMonth && d.getFullYear() === previewYear;
        });
        const eligible = monthEvents.filter(e =>
          e.clientPaymentStatus !== "Paid" && e.phoneNumber
        );
        const previews = eligible.map(e => ({
          name: e.coupleNames,
          phone: (e.phoneNumber || "").replace(/[^0-9]/g, ""),
          date: e.date,
          venue: e.venue,
          remainingBalance: e.remainingBalance,
          message: form.messageTemplate
            .replaceAll("{coupleNames}", e.coupleNames || "")
            .replaceAll("{remainingBalance}", e.remainingBalance != null ? String(e.remainingBalance) : "")
            .replaceAll("{eventDate}", e.date || "")
            .replaceAll("{venueName}", e.venue || ""),
        }));
        setRealPreviews(previews);
      } else if (automation.type === "album_reminder") {
        const now = new Date();
        const eligible = allEvents.filter(e => {
          if (!e.date || new Date(e.date) >= now) return false;
          if (e.albumStatus === 'sent') return false;
          if (!e.phoneNumber) return false;
          return true;
        });
        const daysSinceEventHelper = (iso) => Math.floor((now - new Date(iso)) / (1000 * 60 * 60 * 24));
        const previews = eligible.map(e => ({
          eventId: e.id,
          staffId: e.id,
          name: e.coupleNames,
          phone: (e.phoneNumber || "").replace(/[^0-9]/g, ""),
          date: e.date,
          venue: e.venue,
          daysSinceEvent: daysSinceEventHelper(e.date),
          albumStatus: e.albumStatus,
          album_reminder_sent: e.album_reminder_sent || false,
          album_reminder_sent_at: e.album_reminder_sent_at,
          message: form.messageTemplate
            .replaceAll("{coupleNames}", e.coupleNames || "")
            .replaceAll("{eventDate}", e.date || "")
            .replaceAll("{venueName}", e.venue || ""),
        }));
        setRealPreviews(previews);
      }
    } catch {
      toast.error("שגיאה בטעינת נתונים אמיתיים");
    }
    setLoadingReal(false);
  };

  const toggleStaff = (id) => {
    setForm(f => ({
      ...f,
      selectedStaffIds: f.selectedStaffIds.includes(id)
        ? f.selectedStaffIds.filter(s => s !== id)
        : [...f.selectedStaffIds, id],
    }));
  };

  const insertVar = (v) => {
    setForm((f) => ({ ...f, messageTemplate: f.messageTemplate + v }));
  };

  const preview = buildPreview(form.messageTemplate, automation.type);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await Automation.update(automation.id, {
        frequency: form.frequency,
        run_day: Number(form.run_day),
        run_time: form.run_time,
        target_month_mode: form.target_month_mode,
        messageTemplate: form.messageTemplate,
        mediaFileUrl: form.mediaFileUrl || undefined,
        test_mode: form.test_mode,
        selectedStaffIds: form.selectedStaffIds,
      });
      // Saving frequency/run_day/run_time alone never recomputes next_run_at —
      // that's only done by the scheduler after an actual run, or by the
      // separate "סנכרן תזמון" button (handleSyncSchedule). Without this,
      // an edited run_time silently never takes effect until the automation
      // happens to run again for some other reason, which can be days away —
      // so re-sync the schedule automatically right after a successful save,
      // for any active, non-manual automation, matching what "סנכרן תזמון"
      // already does today.
      const isSchedulable = (updated?.isActive ?? automation.isActive) && form.frequency !== 'manual';
      if (isSchedulable) {
        try {
          await base44.functions.invoke('automationEngine', {
            sync_schedule: true,
            automation_id: automation.id,
          });
        } catch {
          // Best-effort — the save itself already succeeded; the schedule
          // will still self-correct on the next real run either way.
        }
      }
      toast.success("ההגדרות נשמרו בהצלחה");
      onSaved();
      onClose();
    } catch {
      toast.error("שגיאה בשמירה");
    }
    setSaving(false);
  };

  const handleTest = async () => {
    if (!form.test_phone.trim()) { toast.error("הכנס מספר טלפון לטסט"); return; }
    setSending(true);
    try {
      const res = await base44.functions.invoke("automationEngine", {
        automation_id: automation.id,
        triggered_by: "manual",
        test_phone: form.test_phone.trim(),
      });
      const sent = res.data?.results?.[0]?.sent || 0;
      if (sent > 0) {
        toast.success(`הודעת טסט נשלחה בהצלחה (${sent} הודעות)`);
      } else {
        toast.info("הריצה הושלמה — לא נמצאו הודעות לשליחה (בדוק שיש אירועים בחודש)");
      }
    } catch (e) {
      toast.error("שגיאה בשליחת הטסט: " + e.message);
    }
    setSending(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur border-b border-gray-700 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{automation.emoji}</span>
            <div>
              <h2 className="text-lg font-bold text-white">{automation.name}</h2>
              <p className="text-gray-400 text-xs">הגדרות אוטומציה</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-gray-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* ── Schedule ── */}
          <section className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
            <h3 className="text-purple-300 font-semibold text-sm flex items-center gap-2"><Calendar className="w-4 h-4" /> תזמון</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-gray-400 text-xs block mb-1">תדירות</label>
                <select
                  value={form.frequency}
                  onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
                >
                  <option value="monthly_1st">ראשון לחודש</option>
                  <option value="daily">יומי</option>
                  <option value="manual">ידני</option>
                </select>
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">שעת הרצה</label>
                <input
                  type="time"
                  value={form.run_time}
                  onChange={e => setForm(f => ({ ...f, run_time: e.target.value }))}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
                />
              </div>
              {form.frequency === "monthly_1st" && (
                <>
                  <div>
                    <label className="text-gray-400 text-xs block mb-1">יום בחודש (1-31)</label>
                    <input
                      type="number" min={1} max={31}
                      value={form.run_day}
                      onChange={e => setForm(f => ({ ...f, run_day: e.target.value }))}
                      className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs block mb-1">חודש יעד</label>
                    <select
                      value={form.target_month_mode}
                      onChange={e => setForm(f => ({ ...f, target_month_mode: e.target.value }))}
                      className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="next_month">חודש הבא</option>
                      <option value="current_month">חודש נוכחי</option>
                    </select>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* ── Message Template ── */}
          <section className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
            <h3 className="text-purple-300 font-semibold text-sm">💬 תבנית הודעה</h3>
            {vars.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {vars.map(v => (
                  <button
                    key={v}
                    onClick={() => insertVar(v)}
                    className="text-xs px-2 py-1 bg-indigo-900/40 border border-indigo-700/50 text-indigo-300 rounded-lg hover:bg-indigo-800/60 transition-colors"
                  >
                    {v}
                  </button>
                ))}
              </div>
            )}
            <textarea
              value={form.messageTemplate}
              onChange={e => setForm(f => ({ ...f, messageTemplate: e.target.value }))}
              rows={6}
              dir="rtl"
              className="w-full bg-gray-700/60 border border-gray-600 text-white placeholder-gray-500 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:border-indigo-500"
              placeholder="הכנס תבנית הודעה..."
            />
          </section>

          {/* ── Months Ahead (questionnaire_send only) ── */}
          {automation.type === 'questionnaire_send' && (
            <section className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
              <h3 className="text-purple-300 font-semibold text-sm">⏳ חודשים קדימה</h3>
              <input
                type="number"
                min={1}
                value={form.months_ahead || 1}
                onChange={e => setForm(f => ({ ...f, months_ahead: Number(e.target.value) || 1 }))}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
              />
            </section>
          )}

          {/* ── Run Day for questionnaire_send ── */}
          {automation.type === 'questionnaire_send' && (
            <section className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
              <h3 className="text-purple-300 font-semibold text-sm">📅 יום בחודש</h3>
              <input
                type="number"
                min={1}
                max={31}
                value={form.run_day || 1}
                onChange={e => setForm(f => ({ ...f, run_day: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
              />
            </section>
          )}

          {/* ── Staff Filter ── */}
          {showStaffFilter && (
            <section className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-purple-300 font-semibold text-sm">👥 בחירת אנשי צוות</h3>
                <span className="text-xs text-gray-400">
                  {form.selectedStaffIds.length === 0
                    ? "כל הצוות"
                    : `${form.selectedStaffIds.length} נבחרו`}
                </span>
              </div>
              {staffList.length === 0 ? (
                <p className="text-gray-500 text-xs">טוען...</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                  {staffList.map(staff => (
                    <label key={staff.id} className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={form.selectedStaffIds.includes(staff.id)}
                        onChange={() => toggleStaff(staff.id)}
                        className="w-4 h-4 rounded accent-indigo-500 cursor-pointer"
                      />
                      <span className="text-sm text-gray-300 group-hover:text-white transition-colors truncate">{staff.name}</span>
                      <span className="text-[10px] text-gray-600">{staff.role}</span>
                    </label>
                  ))}
                </div>
              )}
              {form.selectedStaffIds.length > 0 && (
                <button onClick={() => setForm(f => ({ ...f, selectedStaffIds: [] }))} className="text-xs text-gray-500 hover:text-gray-300 underline">
                  נקה בחירה (שלח לכולם)
                </button>
              )}
            </section>
          )}

          {/* ── Questionnaire Reminder Info ── */}
          {automation.type === "questionnaire_reminder" && (
            <section className="bg-blue-950/30 border border-blue-700/40 rounded-xl p-4 space-y-2">
              <h3 className="text-blue-300 font-semibold text-sm">💡 לוגיקת סינון</h3>
              <p className="text-blue-200/80 text-xs leading-relaxed">
                המערכת שולחת תזכורת לזוגות שהאירוע שלהם הוא <span className="text-blue-300 font-semibold">בין יום אחד ל-35 יום קדימה</span>, שטרם מילאו שאלון, ושלא קיבלו תזכורת ב-<span className="text-blue-300 font-semibold">3 הימים האחרונים</span>.
              </p>
            </section>
          )}

          {/* ── Payment Reminder Info ── */}
          {automation.type === "payment_reminder" && (
            <section className="bg-yellow-950/30 border border-yellow-700/40 rounded-xl p-4 space-y-2">
              <h3 className="text-yellow-300 font-semibold text-sm">💡 לוגיקת סינון</h3>
              <p className="text-yellow-200/80 text-xs leading-relaxed">
                המערכת שולחת תזכורת תשלום באופן אוטומטי לכל הזוגות שאירוע שלהם התקיים לפני מספר הימים שהוגדר, ושסטטוס התשלום שלהם אינו 'שולם'. מסננת לפי אירועים שיש להם יתרה לתשלום גדול מ-0.
              </p>
            </section>
          )}

          {/* ── Album Reminder Info ── */}
          {automation.type === "album_reminder" && (
            <section className="bg-pink-950/30 border border-pink-700/40 rounded-xl p-4 space-y-2">
              <h3 className="text-pink-300 font-semibold text-sm">💡 לוגיקת סינון</h3>
              <p className="text-pink-200/80 text-xs leading-relaxed">
                המערכת שולחת תזכורת רק לזוגות שעדיין לא הזמינו אלבום <span className="text-pink-300 font-semibold">(סטטוס וורוד)</span>. זוגות שכבר הזמינו <span className="text-green-400 font-semibold">(סטטוס ירוק)</span> לא יקבלו הודעה. בנוסף, זוגות שכבר נשלחה להם תזכורת (album_reminder_sent) לא יקבלו שוב.
              </p>
              <div className="flex gap-4 mt-1">
                <span className="text-xs text-pink-300">🟣 albumStatus: pending → יקבלו</span>
                <span className="text-xs text-green-400">🟢 albumStatus: sent → לא יקבלו</span>
              </div>
            </section>
          )}

          {/* ── Media (album_reminder only) ── */}
          {automation.type === "album_reminder" && (
            <section className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-2">
              <h3 className="text-purple-300 font-semibold text-sm">🖼️ מדיה (URL לתמונה)</h3>
              <input
                type="url"
                value={form.mediaFileUrl}
                onChange={e => setForm(f => ({ ...f, mediaFileUrl: e.target.value }))}
                placeholder="https://..."
                className="w-full bg-gray-700 border border-gray-600 text-white placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              />
            </section>
          )}

          {/* ── Preview ── */}
          <section className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-2">
            <h3 className="text-purple-300 font-semibold text-sm">👁️ תצוגה מקדימה</h3>
            <pre className="text-gray-300 text-xs whitespace-pre-wrap leading-relaxed bg-gray-900/60 rounded-lg p-3 border border-gray-700 min-h-[60px]">{preview || "—"}</pre>
          </section>

          {/* ── Real Data Preview ── */}
          <section className="bg-gray-800/50 border border-indigo-800/40 rounded-xl p-4 space-y-3">
            <h3 className="text-indigo-300 font-semibold text-sm">📊 תצוגה עם נתונים אמיתיים</h3>
            <div className="flex items-center gap-3 flex-wrap">
              {automation.type !== "album_reminder" && (
                <>
                  <div>
                    <label className="text-gray-400 text-xs block mb-1">חודש</label>
                    <select
                      value={previewMonth}
                      onChange={e => setPreviewMonth(Number(e.target.value))}
                      className="bg-gray-700 border border-gray-600 text-white rounded-lg px-2 py-1.5 text-sm"
                    >
                      {HEBREW_MONTHS.slice(1).map((m, i) => (
                        <option key={i+1} value={i+1}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs block mb-1">שנה</label>
                    <select
                      value={previewYear}
                      onChange={e => setPreviewYear(Number(e.target.value))}
                      className="bg-gray-700 border border-gray-600 text-white rounded-lg px-2 py-1.5 text-sm"
                    >
                      {Array.from({length: 16}, (_, i) => now.getFullYear() + i).map(y => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <div className={automation.type !== "album_reminder" ? "mt-4" : ""} style={{display: "flex", gap: "8px"}}>
                <Button
                  size="sm"
                  onClick={loadRealPreview}
                  disabled={loadingReal || sending}
                  className="bg-indigo-700 hover:bg-indigo-600 text-white text-xs"
                >
                  {loadingReal ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "טען נתונים אמיתיים"}
                </Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    // questionnaire_send: send only to checked items
                    if (automation.type === 'questionnaire_send') {
                      if (previewSelected.size === 0) {
                        toast.error("לא נבחרו נמענים לשליחה");
                        return;
                      }
                      setSending(true);
                      try {
                        const mm = String(previewMonth).padStart(2, '0');
                        const targetYYYYMM = `${previewYear}-${mm}`;
                        const res = await base44.functions.invoke("automationEngine", {
                          automation_id: automation.id,
                          triggered_by: "manual",
                          targetYYYYMM,
                          selectedEventIds: Array.from(previewSelected),
                        });
                        const sent = res.data?.results?.[0]?.sent || 0;
                        toast.success(`נשלחו ${sent} הודעות בהצלחה!`);
                        setRealPreviews([]);
                        setPreviewSelected(new Set());
                      } catch (e) {
                        toast.error("שגיאה בשליחה: " + e.message);
                      }
                      setSending(false);
                      return;
                    }
                    // Other automation types — unchanged behavior
                    setSending(true);
                    try {
                      const res = await base44.functions.invoke("automationEngine", {
                        automation_id: automation.id,
                        triggered_by: "manual",
                      });
                      const sent = res.data?.results?.[0]?.sent || 0;
                      const pending = res.data?.results?.[0]?.pending || 0;
                      if (pending > 0) toast.success(`נשלחו בהצלחה — ${pending} הודעות ממתינות`);
                      else if (sent > 0) toast.success(`נשלחו ${sent} הודעות בהצלחה!`);
                      else toast.info("אין אנשי צוות עם אירועים בחודש זה");
                    } catch (e) {
                      toast.error("שגיאה בשליחה: " + e.message);
                    }
                    setSending(false);
                  }}
                  disabled={sending || loadingReal}
                  className="bg-purple-700 hover:bg-purple-600 text-white text-xs"
                >
                  {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (
                    automation.type === 'questionnaire_send' && realPreviews.length > 0
                      ? `שלח לנבחרים (${previewSelected.size})`
                      : "שלח לכל הנבחרים"
                  )}
                </Button>
              </div>
            </div>

            {realPreviews.length > 0 && (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {automation.type === 'questionnaire_send' ? (
                  <p className="text-xs text-gray-500">
                    נבחרו <span className="text-indigo-300 font-semibold">{previewSelected.size}</span> מתוך {realPreviews.length}
                  </p>
                ) : (
                  <p className="text-xs text-gray-500">{realPreviews.length} הודעות</p>
                )}
                {realPreviews.map((p, i) => (
                  <div key={i} className={`bg-gray-900/60 border rounded-lg p-3 transition-colors ${automation.type === 'questionnaire_send' && previewSelected.has(p.eventId) ? 'border-indigo-700/60' : 'border-gray-700'}`}>
                    <div className="flex items-start gap-2 mb-1.5">
                      {automation.type === 'questionnaire_send' && (
                        <input
                          type="checkbox"
                          checked={previewSelected.has(p.eventId)}
                          onChange={e => {
                            setPreviewSelected(prev => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(p.eventId);
                              else next.delete(p.eventId);
                              return next;
                            });
                          }}
                          className="mt-0.5 w-4 h-4 rounded accent-indigo-500 cursor-pointer shrink-0"
                        />
                      )}
                      <div className="flex items-center justify-between flex-1 flex-wrap gap-1">
                        <span className="text-indigo-300 font-semibold text-xs">{p.name}</span>
                        <div className="flex items-center gap-2">
                          {p.phone && <span className="text-gray-500 text-[10px]">{p.phone}</span>}
                          {p.date && <span className="text-gray-500 text-[10px]">{format(new Date(p.date), "dd/MM")}</span>}
                        </div>
                      </div>
                    </div>
                    {automation.type === 'questionnaire_send' && (
                      <div className="flex gap-3 mb-2 mr-6">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${p.questionnaireSentAt ? 'bg-yellow-900/40 border-yellow-700 text-yellow-300' : 'bg-gray-800 border-gray-600 text-gray-400'}`}>
                          {p.questionnaireSentAt ? `נשלח ${format(new Date(p.questionnaireSentAt), "dd/MM/yy")}` : 'לא נשלח'}
                        </span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${p.productionFormFilledAt ? 'bg-green-900/40 border-green-700 text-green-300' : 'bg-gray-800 border-gray-600 text-gray-400'}`}>
                          {p.productionFormFilledAt ? '✓ מילא שאלון' : 'טרם מילא'}
                        </span>
                      </div>
                    )}
                    <pre className={`text-gray-300 text-[11px] whitespace-pre-wrap leading-relaxed ${automation.type === 'questionnaire_send' ? 'mr-6' : ''}`}>{p.message}</pre>
                  </div>
                ))}
              </div>
            )}
            {realPreviews.length === 0 && !loadingReal && (
              <p className="text-gray-600 text-xs">לחץ על "טען נתונים אמיתיים" לצפייה בהודעות האמיתיות</p>
            )}
          </section>

          {/* ── Test ── */}
          <section className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
            <h3 className="text-purple-300 font-semibold text-sm">🧪 שליחת טסט</h3>
            <div className="flex gap-2">
              <input
                type="tel"
                value={form.test_phone}
                onChange={e => setForm(f => ({ ...f, test_phone: e.target.value }))}
                placeholder="050-0000000"
                dir="ltr"
                className="flex-1 bg-gray-700 border border-gray-600 text-white placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              />
              <Button
                onClick={handleTest}
                disabled={sending}
                className="bg-green-700 hover:bg-green-600 text-white px-4"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : "שלח טסט"}
              </Button>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-900/95 backdrop-blur border-t border-gray-700 px-5 py-4 flex gap-3 rounded-b-2xl">
          <Button variant="outline" onClick={onClose} className="flex-1 border-gray-600 bg-gray-800 text-gray-300">ביטול</Button>
          <Button onClick={handleSave} disabled={saving} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">
            {saving ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : null}
            שמור הגדרות
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Format next_run_at in Israel time ──────────────────────────────────────
function formatIsraelTime(isoString) {
  if (!isoString) return null;
  return new Date(isoString).toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Automation Card ─────────────────────────────────────────────────────────
function AutomationCard({ automation, onToggle, onSettings, onManualRun, onSyncSchedule, running, syncing }) {
  const freqCls = FREQ_COLORS[automation.frequency] || FREQ_COLORS.manual;
  const freqLabel = FREQ_LABELS[automation.frequency] || automation.frequency;
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState(null); // null = not loaded yet

  const loadLogs = async () => {
    if (logs !== null) { setLogsOpen(o => !o); return; }
    try {
      const runs = await AutomationRun.filter(
        { automation_id: automation.id },
        '-started_at',
        3
      );
      setLogs(runs);
    } catch {
      setLogs([]);
    }
    setLogsOpen(true);
  };

  const runStatusIcon = (status) => {
    if (status === 'completed') return <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />;
    if (status === 'error') return <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
    return <AlertCircle className="w-3.5 h-3.5 text-yellow-400 shrink-0" />;
  };

  return (
    <div className={`bg-gray-900 border rounded-2xl p-5 shadow-lg transition-all duration-200 flex flex-col gap-3 ${automation.isActive ? "border-indigo-700/50 shadow-indigo-900/20" : "border-red-900/40"}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-900/60 to-purple-900/60 border border-indigo-700/40 flex items-center justify-center text-2xl shadow-inner">
            {automation.emoji}
          </div>
          <div>
            <h3 className="text-white font-bold text-base leading-tight">{automation.name}</h3>
            <Badge variant="outline" className={`text-[10px] mt-1 border ${freqCls}`}>{freqLabel}</Badge>
          </div>
        </div>
        {/* Toggle — explicit green/red button */}
        <button
          onClick={() => onToggle(automation)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
            automation.isActive
              ? 'bg-green-900/40 border-green-600 text-green-400 hover:bg-green-900/60'
              : 'bg-red-900/40 border-red-700 text-red-400 hover:bg-red-900/60'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${automation.isActive ? 'bg-green-400' : 'bg-red-500'}`} />
          {automation.isActive ? 'פעיל' : 'כבוי'}
        </button>
      </div>

      {/* Audit panel */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 space-y-1.5">
        {/* Configured time */}
        {automation.runTime && automation.frequency !== 'manual' && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">שעה מוגדרת</span>
            <span className="text-white font-mono font-semibold">{automation.runTime}</span>
          </div>
        )}
        {/* Next run */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">ריצה הבאה (ישראל)</span>
          <div className="flex items-center gap-1.5">
            {automation.frequency === 'manual' ? (
              <span className="text-blue-400 font-semibold">ידני</span>
            ) : !automation.isActive ? (
              <span className="text-red-400 font-semibold">כבויה</span>
            ) : (
              <>
                <span className={`font-mono ${automation.nextRunAt ? 'text-indigo-300' : 'text-gray-500'}`}>
                  {automation.nextRunAt ? formatIsraelTime(automation.nextRunAt) : '—'}
                </span>
                <button
                  onClick={() => onSyncSchedule(automation)}
                  disabled={syncing === automation.id}
                  title="סנכרן תזמון"
                  className="text-gray-500 hover:text-indigo-400 transition-colors"
                >
                  {syncing === automation.id
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <RefreshCw className="w-3 h-3" />}
                </button>
              </>
            )}
          </div>
        </div>
        {/* Last run */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">הרצה אחרונה</span>
          <span className="text-gray-400 font-mono">
            {automation.lastRunAt ? formatIsraelTime(automation.lastRunAt) : 'טרם הורץ'}
          </span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSettings(automation)}
          className="flex-1 border-indigo-700/50 bg-indigo-950/40 text-indigo-300 hover:bg-indigo-900/30 hover:border-indigo-600 text-xs h-8"
        >
          <Settings className="w-3.5 h-3.5 ml-1" />
          הגדרות
        </Button>
        <Button
          size="sm"
          onClick={() => onManualRun(automation)}
          disabled={!!running}
          className="flex-1 bg-purple-700 hover:bg-purple-600 text-white text-xs h-8"
        >
          {running === automation.id
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <><Play className="w-3.5 h-3.5 ml-1" />הרצה ידנית</>
          }
        </Button>
      </div>

      {/* Logs toggle */}
      <button
        onClick={loadLogs}
        className="flex items-center justify-between w-full text-xs text-gray-500 hover:text-gray-300 transition-colors pt-1 border-t border-gray-800"
      >
        <span>3 ריצות אחרונות</span>
        {logsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {logsOpen && (
        <div className="space-y-1.5">
          {logs === null ? (
            <div className="flex justify-center py-2"><Loader2 className="w-4 h-4 animate-spin text-gray-600" /></div>
          ) : logs.length === 0 ? (
            <p className="text-gray-600 text-xs text-center py-1">אין ריצות מתועדות</p>
          ) : (
            logs.map((run, i) => (
              <div key={run.id || i} className={`rounded-lg p-2.5 border text-xs flex flex-col gap-1 ${
                run.status === 'completed' ? 'bg-green-950/30 border-green-800/40' :
                run.status === 'error'     ? 'bg-red-950/30 border-red-800/40' :
                                             'bg-yellow-950/30 border-yellow-800/40'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {runStatusIcon(run.status)}
                    <span className="text-gray-300 font-mono">
                      {run.startedAt ? formatIsraelTime(run.startedAt) : '—'}
                    </span>
                  </div>
                  <span className={`font-semibold ${
                    run.status === 'completed' ? 'text-green-400' :
                    run.status === 'error'     ? 'text-red-400' : 'text-yellow-400'
                  }`}>
                    {run.status === 'completed' ? `✓ נשלחו ${run.messagesSent ?? 0}` :
                     run.status === 'error'     ? '✗ כישלון' : '⏳ רץ'}
                  </span>
                </div>
                {run.errorMessage && (
                  <p className="text-red-300 text-[10px] mt-0.5 leading-relaxed">{run.errorMessage}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}



// ── Main Page ───────────────────────────────────────────────────────────────
export default function AutomationsDashboard() {
  const [automations, setAutomations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedAutomation, setSelectedAutomation] = useState(null);
  const [runningId, setRunningId] = useState(null);
  const [syncingId, setSyncingId] = useState(null);
  const [previewModal, setPreviewModal] = useState(null); // { automation, previews }
  const [albumReminderModal, setAlbumReminderModal] = useState(null); // { automation, previews }
  const [questionnaireSendModal, setQuestionnaireSendModal] = useState(null); // automation
  const [customStaffMessageModal, setCustomStaffMessageModal] = useState(null); // automation
  const [sendingAll, setSendingAll] = useState(false);
  const [selectedRecipients, setSelectedRecipients] = useState(new Set()); // indices of selected previews

  const loadAutomations = async () => {
    setIsLoading(true);
    try {
      let data = await Automation.list();
      if (!data || data.length === 0) {
        // seed defaults
        const created = await Promise.all(DEFAULTS.map(d => Automation.create(d)));
        data = created;
        toast.success("נוצרו 3 אוטומציות ברירת מחדל");
      } else {
        const existingTypes = new Set(data.map(a => a.type));
        const missingDefaults = DEFAULTS.filter(d => !existingTypes.has(d.type));
        if (missingDefaults.length > 0) {
          const created = await Promise.all(missingDefaults.map(d => Automation.create(d)));
          data = [...data, ...created];
          toast.success(`נוצרו ${created.length} אוטומציות חדשות`);
        }
      }
      setAutomations(data);
    } catch (e) {
      toast.error("שגיאה בטעינת אוטומציות");
    }
    setIsLoading(false);
  };

  useEffect(() => { loadAutomations(); }, []);

  const handleToggle = async (automation) => {
    try {
      const turningOn = !automation.isActive;
      await Automation.update(automation.id, { isActive: turningOn });
      setAutomations(prev => prev.map(a => a.id === automation.id ? { ...a, isActive: turningOn } : a));
      // Turning an automation back on can leave a stale/past next_run_at from
      // before it was switched off — recompute it fresh so it's scheduled
      // relative to "now", same fix as handleSave applies for a run_time edit.
      if (turningOn && automation.frequency !== 'manual') {
        try {
          await base44.functions.invoke('automationEngine', {
            sync_schedule: true,
            automation_id: automation.id,
          });
        } catch {
          // Best-effort — toggling itself already succeeded.
        }
      }
    } catch {
      toast.error("שגיאה בעדכון");
    }
  };

  // Sync schedule — calls backend calculateNextRun, writes ONLY next_run_at
  // Only available for active automations with a schedule (not manual)
  const handleSyncSchedule = async (automation) => {
    if (!automation.isActive || automation.frequency === 'manual') return;
    setSyncingId(automation.id);
    try {
      const res = await base44.functions.invoke('automationEngine', {
        sync_schedule: true,
        automation_id: automation.id,
      });
      const { next_run_at, israel_time } = res.data;
      setAutomations(prev => prev.map(a => a.id === automation.id ? { ...a, nextRunAt: next_run_at } : a));
      toast.success(`תזמון עודכן → ${israel_time} (ישראל)`);
    } catch (e) {
      toast.error("שגיאה בסנכרון תזמון: " + e.message);
    }
    setSyncingId(null);
  };

  const handleManualRun = async (automation) => {
    // questionnaire_send has its own dedicated modal
    if (automation.type === 'questionnaire_send') {
      setQuestionnaireSendModal(automation);
      return;
    }
    // custom_staff_message: compose free text + pick role first, THEN preview —
    // unlike the other types there's no saved template/target to dry-run immediately.
    if (automation.type === 'custom_staff_message') {
      setCustomStaffMessageModal(automation);
      return;
    }
    // album_reminder has its own dedicated modal
    if (automation.type === 'album_reminder') {
      setRunningId(automation.id);
      try {
        const res = await base44.functions.invoke("automationEngine", {
          automation_id: automation.id,
          triggered_by: "manual",
          dry_run: true,
        });
        const previews = res.data?.results?.[0]?.previews || [];
        if (previews.length === 0) {
          toast.info(`אין הודעות לשליחה עבור '${automation.name}'`);
        } else {
          setAlbumReminderModal({ automation, previews });
        }
      } catch (e) {
        toast.error("שגיאה בטעינת preview: " + e.message);
      }
      setRunningId(null);
      return;
    }
    setRunningId(automation.id);
    try {
      const DRY_RUN_TYPES = ['monthly_staff_summary', 'daily_event_brief', 'payment_reminder', 'questionnaire_reminder'];
      if (DRY_RUN_TYPES.includes(automation.type)) {
        // First do a dry run to show preview
        const res = await base44.functions.invoke("automationEngine", {
          automation_id: automation.id,
          triggered_by: "manual",
          dry_run: true,
        });
        const previews = res.data?.results?.[0]?.previews || [];
        if (previews.length === 0) {
          toast.info(`אין הודעות לשליחה עבור '${automation.name}'`);
        } else {
          // Initialize all recipients as selected by default (using staffId, not index)
          // Use staffId as the unique key; filter out any undefined to avoid Set pollution
          setSelectedRecipients(new Set(previews.map(p => p.staffId).filter(Boolean)));
          setPreviewModal({ automation, previews });
        }
      } else {
        const res = await base44.functions.invoke("automationEngine", { automation_id: automation.id, triggered_by: "manual" });
        const sentCount = res.data?.results?.[0]?.sent || 0;
        const pendingCount = res.data?.results?.[0]?.pending || 0;
        if (pendingCount > 0) {
          toast.success(`האוטומציה '${automation.name}' הורצה — ${pendingCount} הודעות ממתינות לאישור שלך`);
        } else if (sentCount > 0) {
          toast.success(`האוטומציה '${automation.name}' הורצה — נשלחו ${sentCount} הודעות`);
        } else {
          toast.info(`האוטומציה '${automation.name}' הורצה — אין הודעות לשליחה`);
        }
        await Automation.update(automation.id, { last_run_at: new Date().toISOString() });
        loadAutomations();
      }
    } catch (e) {
      toast.error("שגיאה בהרצה: " + e.message);
    }
    setRunningId(null);
  };

  const handleConfirmSend = async () => {
    if (!previewModal) return;
    
    if (selectedRecipients.size === 0) {
      toast.error("בחר לפחות איש צוות אחד לשליחה");
      return;
    }

    setSendingAll(true);
    try {
      // For album_reminder, pass selectedEventIds; for others, pass selectedStaffIds
      const isAlbumReminder = previewModal.automation.type === 'album_reminder';
      const selectedIds = Array.from(selectedRecipients);
      
      const res = await base44.functions.invoke("automationEngine", {
        automation_id: previewModal.automation.id,
        triggered_by: "manual",
        [isAlbumReminder ? "selectedEventIds" : "selectedStaffIds"]: selectedIds,
      });
      const sentCount = res.data?.results?.[0]?.sent || 0;
      toast.success(`נשלחו ${sentCount} הודעות בהצלחה!`);
      await Automation.update(previewModal.automation.id, { last_run_at: new Date().toISOString() });
      setPreviewModal(null);
      setSelectedRecipients(new Set());
      loadAutomations();
    } catch (e) {
      toast.error("שגיאה בשליחה: " + e.message);
    }
    setSendingAll(false);
  };

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8" dir="rtl">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-white">⚡ אוטומציות לעסק</h1>
          <p className="text-gray-400 mt-1 text-sm">ניהול שליחות אוטומטיות בוואטסאפ לצוות וללקוחות</p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
          </div>
        ) : (
          <div className="grid md:grid-cols-3 gap-5">
            {automations.map(automation => (
              <AutomationCard
                key={automation.id}
                automation={automation}
                onToggle={handleToggle}
                onSettings={setSelectedAutomation}
                onManualRun={handleManualRun}
                onSyncSchedule={handleSyncSchedule}
                running={runningId}
                syncing={syncingId}
              />
            ))}
          </div>
        )}
      </div>

      {selectedAutomation && (
        <SettingsModal
          automation={selectedAutomation}
          onClose={() => setSelectedAutomation(null)}
          onSaved={loadAutomations}
        />
      )}

      {questionnaireSendModal && (
        <QuestionnaireSendPreviewModal
          automation={questionnaireSendModal}
          onClose={() => setQuestionnaireSendModal(null)}
          onSent={loadAutomations}
        />
      )}

      {albumReminderModal && (
        <AlbumReminderPreviewModal
          automation={albumReminderModal.automation}
          previews={albumReminderModal.previews}
          onClose={() => setAlbumReminderModal(null)}
          onSent={loadAutomations}
        />
      )}

      {customStaffMessageModal && (
        <CustomStaffMessageModal
          automation={customStaffMessageModal}
          onClose={() => setCustomStaffMessageModal(null)}
          onSent={loadAutomations}
        />
      )}

      {previewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={() => setPreviewModal(null)} />
          <div className="relative bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="bg-gray-900/95 border-b border-gray-700 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-900/60 border border-indigo-700/50 flex items-center justify-center">
                  <Eye className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">תצוגה מקדימה לפני שליחה</h2>
                  <p className="text-gray-400 text-xs">{previewModal.previews.length} הודעות מוכנות לשליחה — אשר כדי להמשיך</p>
                </div>
              </div>
              <button onClick={() => setPreviewModal(null)} className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-gray-800 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Table */}
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-800/95 backdrop-blur z-10">
                  <tr>
                    <th className="text-center text-gray-400 font-semibold py-3 px-4 text-xs border-b border-gray-700 w-8">✓</th>
                    <th className="text-right text-gray-400 font-semibold py-3 px-4 text-xs border-b border-gray-700">שם / זוג</th>
                    <th className="text-right text-gray-400 font-semibold py-3 px-4 text-xs border-b border-gray-700">טלפון</th>
                    <th className="text-right text-gray-400 font-semibold py-3 px-4 text-xs border-b border-gray-700">תאריך אירוע</th>
                    {previewModal.automation.type === 'album_reminder' && (
                      <>
                        <th className="text-right text-gray-400 font-semibold py-3 px-4 text-xs border-b border-gray-700">ימים</th>
                        <th className="text-right text-gray-400 font-semibold py-3 px-4 text-xs border-b border-gray-700">סטטוס תזכורת</th>
                      </>
                    )}
                    <th className="text-right text-gray-400 font-semibold py-3 px-4 text-xs border-b border-gray-700">הודעה לשליחה</th>
                  </tr>
                </thead>
                <tbody>
                  {previewModal.previews.map((p) => {
                    const isAlbumReminder = previewModal.automation.type === 'album_reminder';
                    const reminderStatus = isAlbumReminder ? (
                      p.album_reminder_sent ? 
                        `נשלח ב-${new Date(p.album_reminder_sent_at).toLocaleDateString('he-IL')}` 
                        : 'לא נשלח'
                    ) : null;
                    
                    return (
                      <tr key={p.staffId} className={`border-b border-gray-800/80 transition-colors align-top ${selectedRecipients.has(p.staffId) ? 'bg-indigo-900/20' : 'hover:bg-gray-800/30'}`}>
                        <td className="py-4 px-4 text-center">
                          <input
                            type="checkbox"
                            checked={selectedRecipients.has(p.staffId)}
                            onChange={(e) => {
                              setSelectedRecipients(prev => {
                                const next = new Set(prev);
                                if (e.target.checked) {
                                  next.add(p.staffId);
                                } else {
                                  next.delete(p.staffId);
                                }
                                return next;
                              });
                            }}
                            className="w-4 h-4 rounded accent-indigo-500 cursor-pointer"
                          />
                        </td>
                        <td className="py-4 px-4">
                          <span className="text-white font-semibold text-sm">{p.name || p.staffName}</span>
                        </td>
                        <td className="py-4 px-4">
                          <span className="text-gray-400 text-xs font-mono" dir="ltr">{p.staffPhone || '—'}</span>
                        </td>
                        <td className="py-4 px-4">
                          <span className="text-gray-300 text-xs font-mono">
                            {(() => {
                              if (!p.eventDate) return '—';
                              const d = new Date(p.eventDate);
                              if (isNaN(d.getTime())) return p.eventDate;
                              return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
                            })()}
                          </span>
                        </td>
                        {isAlbumReminder && (
                          <>
                            <td className="py-4 px-4">
                              <span className="text-gray-300 text-xs">{p.daysSinceEvent} ימים</span>
                            </td>
                            <td className="py-4 px-4">
                              <span className={`text-xs font-semibold ${p.album_reminder_sent ? 'text-yellow-400' : 'text-green-400'}`}>
                                {reminderStatus}
                              </span>
                            </td>
                          </>
                        )}
                        <td className="py-4 px-4 max-w-xs">
                          <pre className="text-gray-200 text-xs whitespace-pre-wrap leading-relaxed bg-gray-950/60 rounded-xl p-3 border border-gray-700/40 max-h-36 overflow-y-auto font-sans" dir="rtl">{p.message}</pre>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="bg-gray-900/95 border-t border-gray-700 px-6 py-4 flex gap-3 rounded-b-2xl justify-between items-center">
              <span className="text-xs text-gray-400">
                {selectedRecipients.size === 0 ? '⚠️ לא נבחר אף אחד' : `✓ ${selectedRecipients.size} מ-${previewModal.previews.length} נבחרו`}
              </span>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setPreviewModal(null)} className="border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700">ביטול</Button>
                <Button onClick={handleConfirmSend} disabled={sendingAll || selectedRecipients.size === 0} className="bg-green-600 hover:bg-green-700 text-white font-semibold gap-2">
                  {sendingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  אשר ושלח {selectedRecipients.size} הודעות
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}