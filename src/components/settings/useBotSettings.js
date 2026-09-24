import { useCallback, useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { parseRequiredFields, parseTermList, serializeTermList, ALL_FIELD_KEYS } from "@/lib/botTerms";
import { DEFAULT_TEMPLATE, FOLLOWUP_TEMPLATE_KEY, FOLLOWUP_AFTER_DAYS_KEY } from "@/components/whatsapp/WhatsAppFollowUpDialog";

// Every bot setting, loaded and saved in one place (2026-09-24).
//
// Until the control centre existed these lived in WhatsAppBotCard.jsx's own state. The
// centre edits the same keys plus ten new ones, and two components each holding a copy
// of "what is saved" is how a screen ends up lying about whether the bot is live. So:
// one hook, one save. The keys are plain app_settings rows; the server reads them on
// every message (whatsappBotSend.ts loadBotSettings), no redeploy.
//
// Values are kept as the strings the inputs edit; lists as arrays. `save()` does the
// serialising and the two refusals (bot on without a greeting / without a price list).

export const DEFAULT_GREETING =
  "שלום! שמחים שפניתם לאווירה סטודיו 📸\n" +
  "נשמח לשמוע כמה פרטים כדי שנוכל לחזור אליכם עם הצעת מחיר מתאימה:\n" +
  "• השמות שלכם\n" +
  "• תאריך האירוע\n" +
  "• איפה האירוע מתקיים\n" +
  "• כמה מוזמנים";

// Must match DEFAULT_FLOW_NUDGE_TEXT in whatsappBotSend.ts.
export const DEFAULT_NUDGE = "היי, עדיין כאן 🙂 אם תשלחו לנו את הפרטים החסרים נחזור אליכם עם הצעת מחיר";

// key → { default, kind }. kind: 'text' | 'bool' | 'list' | 'fields'
const FIELDS = {
  whatsapp_bot_enabled: { def: false, kind: "bool" },
  whatsapp_greeting_text: { def: "", kind: "text" },
  whatsapp_greeting_text_ad: { def: "", kind: "text" },
  whatsapp_pricelist_text: { def: "", kind: "text" },
  whatsapp_pricelist_url: { def: "", kind: "text" },
  whatsapp_reply_delay_seconds: { def: "45", kind: "text" },
  whatsapp_max_bot_messages_per_hour: { def: "10", kind: "text" },
  whatsapp_flow_nudge_text: { def: "", kind: "text" },
  whatsapp_digest_hour: { def: "8", kind: "text" },
  // Control centre (2026-09-24)
  whatsapp_terms_service_extra: { def: [], kind: "list" },
  whatsapp_terms_inquiry_extra: { def: [], kind: "list" },
  whatsapp_terms_self_event_extra: { def: [], kind: "list" },
  whatsapp_terms_vendor_extra: { def: [], kind: "list" },
  whatsapp_terms_disabled: { def: [], kind: "list" },
  whatsapp_required_fields: { def: [...ALL_FIELD_KEYS], kind: "fields" },
  whatsapp_question_text_one: { def: "", kind: "text" },
  whatsapp_question_text_many: { def: "", kind: "text" },
  whatsapp_max_bot_messages: { def: "3", kind: "text" },
  whatsapp_nudge_after_hours: { def: "24", kind: "text" },
  // The follow-up queue's two keys (also edited by WhatsAppFollowUpSettingsDialog).
  [FOLLOWUP_TEMPLATE_KEY]: { def: DEFAULT_TEMPLATE, kind: "text" },
  [FOLLOWUP_AFTER_DAYS_KEY]: { def: "0", kind: "text" },
};

export const BOT_SETTING_KEYS = Object.keys(FIELDS);

const parseValue = (key, raw) => {
  const f = FIELDS[key];
  switch (f.kind) {
    case "bool":
      return ["true", "1", "yes"].includes(String(raw ?? "").trim().toLowerCase());
    case "list":
      return parseTermList(raw);
    case "fields":
      return parseRequiredFields(raw);
    default:
      return raw === null || raw === undefined || raw === "" ? f.def : String(raw);
  }
};

const serializeValue = (key, value) => {
  const f = FIELDS[key];
  switch (f.kind) {
    case "bool":
      return value ? "true" : "false";
    case "list":
      return serializeTermList(value);
    case "fields": {
      const chosen = (value || []).filter((k) => ALL_FIELD_KEYS.includes(k));
      return JSON.stringify(chosen.length > 0 ? chosen : ALL_FIELD_KEYS);
    }
    default:
      return String(value ?? "").trim();
  }
};

const clampInt = (v, def, min, max) => {
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return String(def);
  return String(Math.min(max, Math.max(min, n)));
};

export function useBotSettings() {
  const [values, setValues] = useState(() =>
    Object.fromEntries(BOT_SETTING_KEYS.map((k) => [k, FIELDS[k].def]))
  );
  const [ids, setIds] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await base44.entities.AppSetting.list();
      const nextIds = {};
      const next = Object.fromEntries(BOT_SETTING_KEYS.map((k) => [k, FIELDS[k].def]));
      for (const r of rows || []) {
        if (!FIELDS[r.key]) continue;
        nextIds[r.key] = r.id;
        next[r.key] = parseValue(r.key, r.value);
      }
      setIds(nextIds);
      setValues(next);
      setDirty(false);
    } catch (e) {
      console.error("Error loading WhatsApp bot settings:", e);
      toast.error(`טעינת הגדרות הבוט נכשלה: ${e?.message || "שגיאה לא ידועה"}`);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setValue = useCallback((key, value) => {
    setValues((prev) => ({ ...prev, [key]: typeof value === "function" ? value(prev[key]) : value }));
    setDirty(true);
  }, []);

  // Returns true on success. Refuses the two states that produce silent breakage.
  const save = useCallback(async () => {
    const v = { ...values };
    const enabled = !!v.whatsapp_bot_enabled;
    if (enabled && !String(v.whatsapp_greeting_text || "").trim()) {
      toast.error("אי אפשר להפעיל את הבוט בלי הודעת פתיחה");
      return false;
    }
    if (enabled && !String(v.whatsapp_pricelist_text || "").trim()) {
      toast.error("אי אפשר להפעיל את הבוט בלי נוסח מחירון — זה מה שהוא אמור לשלוח בסוף");
      return false;
    }
    // Numbers: same clamps as the server, so the screen never shows a value the bot
    // will not honour.
    v.whatsapp_reply_delay_seconds = clampInt(v.whatsapp_reply_delay_seconds, 45, 0, 300);
    v.whatsapp_max_bot_messages_per_hour = clampInt(v.whatsapp_max_bot_messages_per_hour, 10, 1, 60);
    v.whatsapp_digest_hour = clampInt(v.whatsapp_digest_hour, 8, 0, 23);
    v.whatsapp_max_bot_messages = clampInt(v.whatsapp_max_bot_messages, 3, 2, 6);
    v.whatsapp_nudge_after_hours = clampInt(v.whatsapp_nudge_after_hours, 24, 1, 168);
    v[FOLLOWUP_AFTER_DAYS_KEY] = clampInt(v[FOLLOWUP_AFTER_DAYS_KEY], 0, 0, 30);
    if (!String(v[FOLLOWUP_TEMPLATE_KEY] || "").trim()) v[FOLLOWUP_TEMPLATE_KEY] = DEFAULT_TEMPLATE;

    setSaving(true);
    try {
      const newIds = { ...ids };
      await Promise.all(
        BOT_SETTING_KEYS.map(async (key) => {
          const value = serializeValue(key, v[key]);
          if (newIds[key]) {
            await base44.entities.AppSetting.update(newIds[key], { value });
          } else {
            const created = await base44.entities.AppSetting.create({ key, value });
            newIds[key] = created.id;
          }
        })
      );
      setIds(newIds);
      setValues(v);
      setDirty(false);
      toast.success(enabled ? "נשמר. הבוט פעיל — הודעות ייצאו אוטומטית" : "נשמר. הבוט כבוי.");
      setSaving(false);
      return true;
    } catch (e) {
      console.error("Error saving WhatsApp bot settings:", e);
      toast.error(`שגיאה בשמירת ההגדרות: ${e?.message || "שגיאה לא ידועה"}`);
      setSaving(false);
      return false;
    }
  }, [values, ids]);

  return { values, setValue, save, reload: load, loading, saving, dirty };
}
