import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { isAdmin } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Bot, Save, SlidersHorizontal, Loader2, Check, X } from "lucide-react";
import { useBotSettings } from "./useBotSettings";
import { TERM_LISTS } from "@/lib/botTerms";

// The bot's card in Settings → חיבורים: the master switch and a one-glance summary.
//
// Until 2026-09-24 every bot setting was edited here. They moved to the control centre
// (src/pages/BotControlCenter.jsx), which shows each one at the step of the chain it
// belongs to — the owner's request was "how does it work, what affects what", and a
// flat form cannot answer that. One place to edit; this card only says what state the
// bot is in and links there. The values are read live by whatsapp-webhook on every
// message (_shared/whatsappBotSend.ts loadBotSettings) — the switch takes effect on the
// next message, no redeploy.

export default function WhatsAppBotCard() {
  const { user } = useAuth();
  const canManage = isAdmin(user);
  const { values, setValue, save, loading, saving, dirty } = useBotSettings();

  const enabled = !!values.whatsapp_bot_enabled;
  const hasGreeting = !!String(values.whatsapp_greeting_text || "").trim();
  const hasPricelist = !!String(values.whatsapp_pricelist_text || "").trim();
  const ownWords = TERM_LISTS.reduce((n, l) => n + (values[l.settingKey]?.length || 0), 0);
  const disabledWords = values.whatsapp_terms_disabled?.length || 0;
  const requiredCount = values.whatsapp_required_fields?.length || 4;

  const Row = ({ ok, children }) => (
    <li className="flex items-center gap-2 text-sm">
      {ok ? <Check className="w-4 h-4 text-emerald-400" /> : <X className="w-4 h-4 text-red-400" />}
      <span className={ok ? "text-gray-200" : "text-red-300"}>{children}</span>
    </li>
  );

  return (
    <Card className="bg-gray-900/50 border-gray-800">
      <CardHeader className="border-b border-gray-800 pb-4">
        <CardTitle className="text-white flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center">
            <Bot className="w-4 h-4 text-blue-400" />
          </div>
          בוט לידים בוואטסאפ
        </CardTitle>
        <p className="text-gray-400 text-sm">מענה אוטומטי לפניות חדשות ממספרים לא מוכרים בלבד</p>
      </CardHeader>

      <CardContent className="pt-6 space-y-5">
        {loading ? (
          <p className="text-gray-400 text-sm flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> טוען...
          </p>
        ) : (
          <>
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
                <Switch checked={enabled} onCheckedChange={(v) => setValue("whatsapp_bot_enabled", v)} disabled={!canManage} />
              </div>
            </div>

            <ul className="space-y-1.5">
              <Row ok={hasGreeting}>{hasGreeting ? "הודעת פתיחה מוגדרת" : "אין הודעת פתיחה — הבוט לא יכול לפעול בלעדיה"}</Row>
              <Row ok={hasPricelist}>{hasPricelist ? "נוסח מחירון מוגדר" : "אין נוסח מחירון — הבוט לא יכול לפעול בלעדיו"}</Row>
              <Row ok>
                {requiredCount} פרטים נדרשים לפני מחירון · {ownWords} מילים שלך
                {disabledWords > 0 ? ` · ${disabledWords} מילים מובנות כבויות` : ""}
              </Row>
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <Button asChild variant="outline" className="border-blue-500/50 text-blue-300 hover:bg-blue-500/10">
                <Link to="/BotControlCenter">
                  <SlidersHorizontal className="w-4 h-4 ml-2" />
                  פתח את מרכז השליטה — כל השלבים וההגדרות
                </Link>
              </Button>
              {canManage && (
                <Button onClick={save} disabled={saving || !dirty} className="bg-yellow-500 hover:bg-yellow-600 text-black">
                  {saving ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Save className="w-4 h-4 ml-2" />}
                  {saving ? "שומר..." : "שמור"}
                </Button>
              )}
            </div>
            {!canManage && <p className="text-gray-500 text-sm">רק מנהל מערכת יכול לשנות את הגדרות הבוט.</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
