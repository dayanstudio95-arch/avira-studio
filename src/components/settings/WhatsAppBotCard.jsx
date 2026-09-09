import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { isAdmin } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Bot, Save, AlertTriangle, Upload, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { uploadFile } from "@/api/uploadFile";

// The one screen that can make this system message a stranger on its own.
//
// Everything here is read live by supabase/functions/whatsapp-webhook on every
// incoming message via _shared/whatsappBotSend.ts's loadBotSettings() — flipping the
// switch takes effect on the very next message, with no redeploy. That immediacy is
// the reason the copy below is blunt rather than reassuring: there is no staging step
// between this toggle and a real customer's phone.
//
// The bot is NOT a general assistant and deliberately cannot improvise. It sends one
// fixed greeting to people its gate recognised as asking about photographing their own
// event, and nothing else. Who that is gets decided in
// supabase/functions/_shared/whatsappIntent.ts — a readable word list, not a model —
// which is the specific failure this replaces: the studio's previous paid bot was an
// open-ended AI agent and was switched off for answering couples things that didn't
// apply to them.
//
// Storage: plain app_settings rows (not tenant_secrets — none of these are credentials).
// base44.entities.AppSetting is the same shim IntegrationsTab uses; keys are stored as
// text, so the server parses "true"/"1"/"yes" and treats everything else as off.

const SETTING_KEYS = [
  "whatsapp_bot_enabled",
  "whatsapp_greeting_text",
  "whatsapp_reply_delay_seconds",
  "whatsapp_max_bot_messages_per_hour",
  "whatsapp_pricelist_url",
  "whatsapp_pricelist_text",
];

const DEFAULT_GREETING =
  "שלום! שמחים שפניתם לאווירה סטודיו 📸\n" +
  "נשמח לשמוע כמה פרטים כדי שנוכל לחזור אליכם עם הצעת מחיר מתאימה:\n" +
  "• השמות שלכם\n" +
  "• תאריך האירוע\n" +
  "• איפה האירוע מתקיים\n" +
  "• כמה מוזמנים";

export default function WhatsAppBotCard() {
  const { user } = useAuth();
  const canManage = isAdmin(user);

  const [enabled, setEnabled] = useState(false);
  const [greeting, setGreeting] = useState("");
  const [delaySeconds, setDelaySeconds] = useState("45");
  const [maxPerHour, setMaxPerHour] = useState("10");
  const [pricelistUrl, setPricelistUrl] = useState("");
  const [pricelistText, setPricelistText] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [settingIds, setSettingIds] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const rows = await base44.entities.AppSetting.list();
        const ids = {};
        const byKey = {};
        rows.forEach((r) => {
          if (SETTING_KEYS.includes(r.key)) {
            ids[r.key] = r.id;
            byKey[r.key] = r.value || "";
          }
        });
        setSettingIds(ids);
        // Same affirmative-only parsing as the server. If these two ever disagree the
        // screen would lie about whether the bot is live, which is the one thing this
        // card must never do.
        setEnabled(["true", "1", "yes"].includes(String(byKey.whatsapp_bot_enabled || "").toLowerCase()));
        setGreeting(byKey.whatsapp_greeting_text ?? "");
        setDelaySeconds(byKey.whatsapp_reply_delay_seconds || "45");
        setMaxPerHour(byKey.whatsapp_max_bot_messages_per_hour || "10");
        setPricelistUrl(byKey.whatsapp_pricelist_url ?? "");
        setPricelistText(byKey.whatsapp_pricelist_text ?? "");
      } catch (e) {
        console.error("Error loading WhatsApp bot settings:", e);
      }
    })();
  }, []);

  // Uploads straight to the public `media-uploads` bucket via the shared helper, which
  // returns a real public URL. That directness is the point: Green API fetches this URL
  // server-side and needs the image BYTES back, which is why a Google Drive share link
  // cannot work — it returns a viewer page. Removing the need to paste a URL at all is
  // what stops that mistake from being possible.
  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked again after a failure
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("צריך לבחור קובץ תמונה");
      return;
    }
    // WhatsApp accepts far larger, but a price list is a single page — anything above
    // this is a full-resolution export picked by mistake, and it would be slow to load
    // on a phone.
    if (file.size > 5 * 1024 * 1024) {
      toast.error("התמונה גדולה מדי (מעל 5MB). נסה לייצא אותה קטנה יותר.");
      return;
    }

    setIsUploading(true);
    try {
      const { file_url } = await uploadFile({ file });
      setPricelistUrl(file_url);
      toast.success("התמונה הועלתה. עכשיו צריך ללחוץ על שמור.");
    } catch (err) {
      console.error("Error uploading price list image:", err);
      toast.error(`העלאת התמונה נכשלה: ${err?.message || "שגיאה לא ידועה"}`);
    }
    setIsUploading(false);
  };

  const handleSave = async () => {
    const trimmedGreeting = greeting.trim();
    // Refuse the one combination that produces silent breakage: switched on with
    // nothing to say. The server already declines to send in that state, but it does so
    // in a log nobody reads, and the studio would think the bot was working.
    const trimmedPricelist = pricelistText.trim();
    if (enabled && !trimmedGreeting) {
      toast.error("אי אפשר להפעיל את הבוט בלי הודעת פתיחה");
      return;
    }
    // The flow's whole purpose is the price list. A bot that collects every detail and
    // then has nothing to send is the worst possible ending — the server hands those
    // conversations to a human, but the studio would never know why.
    if (enabled && !trimmedPricelist) {
      toast.error("אי אפשר להפעיל את הבוט בלי נוסח מחירון — זה מה שהוא אמור לשלוח בסוף");
      return;
    }

    setIsSaving(true);
    try {
      const toWrite = {
        whatsapp_bot_enabled: enabled ? "true" : "false",
        whatsapp_greeting_text: trimmedGreeting,
        whatsapp_reply_delay_seconds: String(delaySeconds || "45"),
        whatsapp_max_bot_messages_per_hour: String(maxPerHour || "10"),
        whatsapp_pricelist_url: pricelistUrl.trim(),
        whatsapp_pricelist_text: trimmedPricelist,
      };
      await Promise.all(
        SETTING_KEYS.map(async (key) => {
          if (settingIds[key]) {
            await base44.entities.AppSetting.update(settingIds[key], { value: toWrite[key] });
          } else {
            const created = await base44.entities.AppSetting.create({ key, value: toWrite[key] });
            setSettingIds((prev) => ({ ...prev, [key]: created.id }));
          }
        })
      );
      setGreeting(trimmedGreeting);
      setPricelistText(trimmedPricelist);
      toast.success(enabled ? "הבוט פעיל — הודעות ייצאו אוטומטית" : "ההגדרות נשמרו. הבוט כבוי.");
    } catch (e) {
      // Surface the real reason, per the lesson recorded in IntegrationsTab.jsx: a bare
      // "שגיאה" here cost a full debugging session on 2026-09-08.
      console.error("Error saving WhatsApp bot settings:", e);
      toast.error(`שגיאה בשמירת ההגדרות: ${e?.message || "שגיאה לא ידועה"}`);
    }
    setIsSaving(false);
  };

  return (
    <Card className="bg-gray-900/50 border-gray-800">
      <CardHeader className="border-b border-gray-800 pb-4">
        <CardTitle className="text-white flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center">
            <Bot className="w-4 h-4 text-blue-400" />
          </div>
          בוט לידים בוואטסאפ
        </CardTitle>
        <p className="text-gray-400 text-sm">
          מענה אוטומטי לפניות חדשות ממספרים לא מוכרים בלבד
        </p>
      </CardHeader>

      <CardContent className="pt-6 space-y-6">
        {/* The master switch. Given its own bordered block, and coloured by state, so
            "is the bot live right now" is answerable from across the room. */}
        <div
          className={`rounded-lg border p-4 ${
            enabled ? "border-emerald-700/60 bg-emerald-950/30" : "border-gray-700 bg-gray-800/40"
          }`}
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-white text-base">
                {enabled ? "הבוט פעיל ושולח הודעות" : "הבוט כבוי — לא נשלחת אף הודעה"}
              </Label>
              <p className="text-gray-400 text-sm mt-1">
                {enabled
                  ? "פנייה חדשה שתזוהה כלקוח שמתעניין בצילום תקבל את הודעת הפתיחה, בלי אישור שלך."
                  : "כל ההודעות ממשיכות להיכנס למסך השיחות. הבוט רק לא עונה."}
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canManage} />
          </div>
        </div>

        {enabled && (
          <div className="flex gap-3 rounded-lg border border-amber-700/50 bg-amber-950/30 p-4">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-200/90 space-y-1">
              <p className="font-medium">מה שהבוט לעולם לא יעשה:</p>
              <ul className="list-disc pr-4 space-y-0.5 text-amber-200/70">
                <li>לא יענה ללקוח קיים, לליד קיים או לאיש צוות</li>
                <li>לא יענה בקבוצות</li>
                <li>לא יענה בשעות השקט שהגדרת</li>
                <li>אם ענית ידנית — הוא משתתק באותה שיחה לתמיד</li>
                <li>לא יוצר לידים לבד. יצירת ליד היא תמיד לחיצה שלך</li>
              </ul>
            </div>
          </div>
        )}

        <div>
          <Label className="text-gray-300">הודעת הפתיחה</Label>
          <p className="text-gray-500 text-xs mt-1 mb-2">
            זו ההודעה היחידה שהבוט שולח כרגע. כדאי לבקש בה את הפרטים שאתה צריך כדי להכין הצעת מחיר.
          </p>
          <Textarea
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            rows={8}
            disabled={!canManage}
            placeholder={DEFAULT_GREETING}
            className="bg-gray-800 border-gray-700 text-white"
          />
          {!greeting.trim() && (
            <button
              type="button"
              onClick={() => setGreeting(DEFAULT_GREETING)}
              disabled={!canManage}
              className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline disabled:opacity-50"
            >
              השתמש בנוסח מוצע
            </button>
          )}
        </div>

        {/* The end of the flow. Once the bot has collected all four details it sends
            this, and the conversation moves to "נשלח מחירון" in the inbox. */}
        <div className="border-t border-gray-800 pt-6">
          <Label className="text-gray-300">נוסח המחירון</Label>
          <p className="text-gray-500 text-xs mt-1 mb-2">
            מה שנשלח אחרי שהלקוח ענה על כל השאלות. אפשר להעתיק בדיוק את הנוסח שאתה שולח היום ידנית.
          </p>
          <Textarea
            value={pricelistText}
            onChange={(e) => setPricelistText(e.target.value)}
            rows={10}
            disabled={!canManage}
            placeholder={"מחירון 2026 ⭐\nחבילות צילום חתונה\n*המחירים כוללים 18% מע״מ\n..."}
            className="bg-gray-800 border-gray-700 text-white"
          />
        </div>

        <div>
          <Label className="text-gray-300">תמונת המחירון</Label>
          <p className="text-gray-500 text-xs mt-1 mb-2">
            העלה את תמונת המחירון והיא תישלח ללקוח יחד עם הנוסח למעלה.
            נוסח ארוך מ-1024 תווים יישלח כהודעה נפרדת מיד אחרי התמונה, כדי שהקישורים בסוף לא ייחתכו.
          </p>

          {pricelistUrl ? (
            <div className="flex items-center gap-3 rounded-lg border border-gray-700 bg-gray-800/50 p-3">
              <img
                src={pricelistUrl}
                alt="תצוגה מקדימה של המחירון"
                className="h-20 w-20 rounded object-cover border border-gray-700"
              />
              <div className="min-w-0 flex-1">
                <p className="text-emerald-400 text-sm flex items-center gap-1">
                  <ImageIcon className="w-3.5 h-3.5" /> התמונה מוכנה לשליחה
                </p>
                {/* The preview is the real check. It loads the same public URL Green API
                    will fetch, so an image that renders here is one WhatsApp can send —
                    which is exactly what a Google Drive share link fails: it renders in a
                    browser but returns an HTML page to anything that asks for the file. */}
                <p className="text-gray-500 text-xs mt-1 break-all" dir="ltr">{pricelistUrl}</p>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() => setPricelistUrl("")}
                  className="text-xs text-red-400 hover:text-red-300 underline shrink-0"
                >
                  הסר
                </button>
              )}
            </div>
          ) : (
            <label
              className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-700 bg-gray-800/30 p-6 text-center ${
                canManage && !isUploading ? "cursor-pointer hover:border-gray-600" : "opacity-60"
              }`}
            >
              <Upload className="w-5 h-5 text-gray-400" />
              <span className="text-sm text-gray-300">
                {isUploading ? "מעלה..." : "לחץ כדי להעלות את תמונת המחירון"}
              </span>
              <span className="text-xs text-gray-500">JPG או PNG, עד 5MB</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={!canManage || isUploading}
                onChange={handleUpload}
              />
            </label>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-gray-300">השהיה לפני מענה (שניות)</Label>
            <p className="text-gray-500 text-xs mt-1 mb-2">
              כדי שהתשובה לא תגיע באותה שנייה ותישמע כמו מכונה. עד 300.
            </p>
            <Input
              type="number"
              min={0}
              max={300}
              value={delaySeconds}
              onChange={(e) => setDelaySeconds(e.target.value)}
              disabled={!canManage}
              className="bg-gray-800 border-gray-700 text-white"
              dir="ltr"
            />
          </div>
          <div>
            <Label className="text-gray-300">מקסימום הודעות בוט בשעה</Label>
            <p className="text-gray-500 text-xs mt-1 mb-2">
              תקרת ביטחון. אם משהו ישתבש, זה מה שמגביל את הנזק. עד 60.
            </p>
            <Input
              type="number"
              min={1}
              max={60}
              value={maxPerHour}
              onChange={(e) => setMaxPerHour(e.target.value)}
              disabled={!canManage}
              className="bg-gray-800 border-gray-700 text-white"
              dir="ltr"
            />
          </div>
        </div>

        {canManage && (
          <div className="flex justify-end pt-2">
            <Button onClick={handleSave} disabled={isSaving} className="bg-yellow-500 hover:bg-yellow-600 text-black">
              <Save className="w-4 h-4 ml-2" />
              {isSaving ? "שומר..." : "שמור הגדרות בוט"}
            </Button>
          </div>
        )}
        {!canManage && (
          <p className="text-gray-500 text-sm">רק מנהל מערכת יכול לשנות את הגדרות הבוט.</p>
        )}
      </CardContent>
    </Card>
  );
}
