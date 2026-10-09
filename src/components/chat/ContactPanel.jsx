import React from "react";
import { Link } from "react-router-dom";
import ClientActionsCard from "./ClientActionsCard";
import { Switch } from "@/components/ui/switch";
import { CONTACT_TYPES, STAGES, contactTypeLabel, effectiveStage, hasStage } from "@/lib/chatModel";
import { Avatar, conversationTitle } from "./ChatList";
import { typeColor, stageColor } from "@/lib/chatColors";
import StaffChatSection from "./staff/StaffChatSection";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { isAdmin } from "@/lib/permissions";

const chip = (on, color) =>
  `min-h-[36px] rounded-full px-3 text-sm transition-colors ${
    on
      ? color
        ? "font-semibold text-white"
        : "bg-yellow-400 font-semibold text-gray-900"
      : "border border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-500"
  }`;

const ACTION_TEXT = {
  set_type: (r) => `סוג: ${contactTypeLabel(r.before?.contactType)} ← ${contactTypeLabel(r.after?.contactType)}${r.after?.reason === "signed" ? " (אוטומטי — חתמו)" : ""}`,
  set_stage: (r) => `שלב: ${r.before?.leadStatus || r.before?.leadStage || r.before?.shown || "—"} ← ${r.after?.leadStatus || r.after?.leadStage}${r.before?.leadId ? " (גם בדף הלידים)" : ""}`,
  label_add: () => "נוספה תווית",
  label_remove: () => "הוסרה תווית",
  archive: (r) => (r.after?.archivedAt ? "הועבר לארכיון" : "הוחזר מהארכיון"),
  pin: (r) => (r.after?.pinnedAt ? "ננעץ למעלה" : "בוטלה נעיצה"),
  handled: (r) => (r.after?.handledAt ? 'סומן "טופל"' : 'בוטל "טופל"'),
  followup_flag: (r) => (r.after?.followupFlaggedAt ? "סומן לפולו-אפ" : "הוסר מהפולו-אפ"),
  opt_out: (r) => (r.after?.optedOutAt ? "סומן: לא לשלוח הודעות" : "בוטל סימון ההסרה"),
  opted_out: () => 'הלקוח ביקש לא לקבל הודעות ("הסר")',
  lead_created: () => "נוצר ליד בדף הלידים",
  undo: () => "בוטלה פעולה",
};

function when(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Tagging and details for one conversation. Desktop: a column. Phone: a bottom sheet.
export default function ContactPanel({
  conversation, lead, labels, convLabelIds, activity, labelsById,
  onSetType, onSetStage, onToggleLabel, onCreateLead, onToggleBot, onToggleOptOut, onArchive, onPin, onScheduleMeeting,
}) {
  const c = conversation;
  const { user } = useAuth();
  const canSeeStaff = isAdmin(user);
  const stage = effectiveStage(c, lead);
  const staged = hasStage(c);
  const linked = !!(c.matchedLeadId && lead);

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-1.5 text-center">
        <Avatar conversation={c} size={64} />
        <span className="text-base font-bold text-white">{conversationTitle(c)}</span>
        <span className="text-xs text-gray-400" dir="ltr">{c.phone || String(c.chatId || "").split("@")[0]}</span>
        <div className="flex gap-2 pt-1 md:hidden">
          <button type="button" onClick={onPin} className="min-h-[36px] rounded-full bg-gray-800 px-4 text-sm text-gray-200">{c.pinnedAt ? "בטל נעיצה" : "נעץ"}</button>
          <button type="button" onClick={onArchive} className="min-h-[36px] rounded-full bg-gray-800 px-4 text-sm text-gray-200">{c.archivedAt ? "החזר מהארכיון" : "ארכיון"}</button>
        </div>
      </div>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-gray-500">מי זה · אחד בלבד</h3>
        <div className="flex flex-wrap gap-1.5">
          {CONTACT_TYPES.filter((t) => !t.fixed || t.key === c.contactType).map((t) => (
            <button
              key={t.key}
              type="button"
              disabled={t.fixed}
              aria-pressed={c.contactType === t.key}
              onClick={() => c.contactType !== t.key && onSetType(t.key)}
              className={c.contactType === t.key ? `min-h-[36px] rounded-full px-3 text-sm font-semibold ring-1 ring-white/30 ${typeColor(t.key)}` : chip(false)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gray-500">כל סוג חוץ מ"לא מוכר" משתיק את הבוט בשיחה.</p>
      </section>

      {/* A crew member: slots, cost, area, availability check and history (2026-10-09). */}
      {/* Staff data is admin-only (RLS) — a lead coordinator would see a wrong "not found". */}
      {c.contactType === "staff" && canSeeStaff && <StaffChatSection conversation={c} />}

      {staged && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500">
            {linked ? "שלב · מסונכרן לליד בדף הלידים" : "שלב · נשמר רק בשיחה (אין ליד ב-CRM)"}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {STAGES.map((s) => (
              <button key={s} type="button" aria-pressed={stage === s} onClick={() => stage !== s && onSetStage(s)} className={stage === s ? `min-h-[36px] rounded-full border-2 bg-gray-900 px-3 text-sm font-semibold ${stageColor(s).chip}` : chip(false)}>
                {s}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-gray-500">תוויות · אפשר כמה</h3>
        <div className="flex flex-wrap gap-1.5">
          {labels.map((l) => {
            const on = convLabelIds.includes(l.id);
            return (
              <button
                key={l.id}
                type="button"
                aria-pressed={on}
                onClick={() => onToggleLabel(l.id, on)}
                className={chip(on, l.color)}
                style={on ? { background: l.color } : undefined}
              >
                {l.name}
              </button>
            );
          })}
          {labels.length === 0 && <span className="text-sm text-gray-500">אין תוויות. יוצרים בסרגל הצד.</span>}
        </div>
      </section>

      {linked ? (
        <section className="space-y-1 rounded-xl border border-gray-800 bg-gray-900 p-3 text-sm">
          <h3 className="text-xs font-semibold text-gray-500">ליד מקושר בדף הלידים</h3>
          <div className="font-semibold text-white">{lead.coupleNames}</div>
          {(lead.eventDate || lead.venueName) && (
            <div className="text-gray-300">
              {lead.eventDate ? new Date(lead.eventDate).toLocaleDateString("he-IL") : ""}
              {lead.venueName ? ` · ${lead.venueName}` : ""}
            </div>
          )}
          <div className="text-gray-400">סטטוס: {lead.status}</div>
          <Link to={`/Leads?openLeadId=${lead.id}`} className="inline-block pt-1 text-yellow-400 underline">פתח בדף הלידים</Link>
        </section>
      ) : (
        ["unknown", "lead"].includes(c.contactType) && (
          <button type="button" onClick={onCreateLead} className="w-full rounded-xl border border-dashed border-yellow-600 py-3 text-sm font-semibold text-yellow-400 hover:bg-yellow-500/10">
            + צור ליד מהשיחה
          </button>
        )
      )}
      {["client", "past_client"].includes(c.contactType) && <ClientActionsCard key={c.id} conversation={c} />}
      {onScheduleMeeting && (
        <button type="button" onClick={onScheduleMeeting} className="w-full rounded-xl border border-gray-700 bg-gray-900 py-3 text-sm font-semibold text-gray-100 hover:border-yellow-500">
          📅 קבע פגישה / שיחה
        </button>
      )}
      {!linked && ["unknown", "lead"].includes(c.contactType) && (
        <p className="-mt-3 text-[11px] text-gray-500">נפתח טופס עם מה שהבוט אסף. נכנס לדף הלידים רק אחרי "שמור".</p>
      )}

      {(c.coupleNames || c.eventDate || c.venue || c.guestCount) && !linked && (
        <section className="space-y-1 text-sm text-gray-300">
          <h3 className="text-xs font-semibold text-gray-500">מה הבוט אסף</h3>
          {c.coupleNames && <div>שמות: {c.coupleNames}</div>}
          {c.eventDate && <div>תאריך: {new Date(c.eventDate).toLocaleDateString("he-IL")}</div>}
          {c.venue && <div>מקום: {c.venue}</div>}
          {c.guestCount && <div>מוזמנים: {c.guestCount}</div>}
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-gray-800 p-3">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            <span className="block text-gray-200">הבוט פעיל בשיחה</span>
            <span className="block text-[11px] text-gray-500">כבה כשאתה מטפל בעצמך</span>
          </span>
          <Switch checked={!!c.botEnabled} onCheckedChange={onToggleBot} aria-label="הבוט פעיל בשיחה" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            <span className="block text-gray-200">לא לשלוח הודעות מרוכזות</span>
            <span className="block text-[11px] text-gray-500">{c.optedOutAt ? `מאז ${when(c.optedOutAt)}${c.optedOutReason ? ` · "${c.optedOutReason}"` : ""}` : 'מסומן אוטומטית כשכותבים "הסר"'}</span>
          </span>
          <Switch checked={!!c.optedOutAt} onCheckedChange={onToggleOptOut} aria-label="לא לשלוח הודעות מרוכזות" />
        </label>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-gray-500">היסטוריית פעולות</h3>
        {activity.length === 0 && <p className="text-xs text-gray-500">אין עדיין</p>}
        {activity.map((r) => {
          const fn = ACTION_TEXT[r.action];
          let textValue = fn ? fn(r) : r.action;
          if (r.action === "label_add" || r.action === "label_remove") {
            const id = r.after?.labelId || r.before?.labelId;
            const name = labelsById[id]?.name;
            if (name) textValue += `: ${name}`;
          }
          return (
            <div key={r.id} className="border-b border-gray-800 pb-1.5 text-xs">
              <div className="text-gray-300">{textValue}</div>
              <div className="text-gray-500">{when(r.createdDate)}{r.batchId ? "" : ""}</div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
