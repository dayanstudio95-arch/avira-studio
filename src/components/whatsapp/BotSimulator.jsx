import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { botDecisionLabel, CONTACT_TYPE_LABELS } from "./whatsappInboxShared";

// "What would the bot have done with this message?" (2026-09-15).
//
// "Why didn't it answer?" was asked twice in one week and each time took a database
// query. This runs the REAL gate chain server-side (supabase/functions/
// whatsapp-bot-simulate: same contact lookup, same settings, same clock, same gate)
// on a message that was never received, and shows the verdict, the reason and the
// words that fired. Sends nothing, writes nothing.
//
// One component, two homes: the bot settings card, and a dialog on the inbox — which
// is where the question actually gets asked.
export default function BotSimulator() {
  const [simPhone, setSimPhone] = useState("");
  const [simText, setSimText] = useState("");
  const [simFromAd, setSimFromAd] = useState(false);
  const [simResult, setSimResult] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);

  const handleSimulate = async () => {
    if (!simText.trim()) {
      toast.error("כתוב הודעה לבדיקה");
      return;
    }
    setIsSimulating(true);
    setSimResult(null);
    try {
      const res = await base44.functions.invoke("whatsappBotSimulate", {
        phone: simPhone.trim() || undefined,
        text: simText,
        fromAd: simFromAd,
      });
      setSimResult(res?.data || null);
    } catch (e) {
      toast.error(`הבדיקה נכשלה: ${e?.message || "שגיאה לא ידועה"}`);
    }
    setIsSimulating(false);
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-gray-300 flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-blue-400" />
          בדוק מה הבוט היה עונה
        </Label>
        <p className="text-gray-500 text-xs mt-1">
          הקלד הודעה (ומספר, אם יש) ותראה מה הבוט היה עושה — ולמה. שום דבר לא נשלח.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Input
          value={simPhone}
          onChange={(e) => setSimPhone(e.target.value)}
          placeholder="050-1234567 (לא חובה)"
          className="bg-gray-800 border-gray-700 text-white"
          dir="ltr"
        />
        <div className="sm:col-span-2 flex items-center gap-3 text-sm text-gray-300">
          <Switch checked={simFromAd} onCheckedChange={setSimFromAd} />
          הגיע דרך מודעה בפייסבוק
        </div>
      </div>
      <Textarea
        value={simText}
        onChange={(e) => setSimText(e.target.value)}
        rows={3}
        placeholder="היי, כמה עולה צילום חתונה?"
        className="bg-gray-800 border-gray-700 text-white"
      />
      <Button
        onClick={handleSimulate}
        disabled={isSimulating}
        variant="outline"
        className="border-gray-600 text-gray-200"
      >
        {isSimulating ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <FlaskConical className="w-4 h-4 ml-2" />}
        {isSimulating ? "בודק..." : "בדוק"}
      </Button>

      {simResult && (
        <div
          className={`rounded-lg border p-4 space-y-2 text-sm ${
            simResult.wouldSend
              ? "border-emerald-700/60 bg-emerald-950/30"
              : "border-gray-700 bg-gray-800/40"
          }`}
        >
          <p className={`font-medium ${simResult.wouldSend ? "text-emerald-300" : "text-gray-200"}`}>
            {simResult.wouldSend
              ? simResult.reason === "quiet_hours_deferred"
                ? "✅ הבוט היה עונה — בסיום שעות השקט"
                : "✅ הבוט היה עונה"
              : "🔇 הבוט היה שותק"}
          </p>
          <p className="text-gray-300">{botDecisionLabel(simResult.reason)}</p>
          <p className="text-gray-400 text-xs">
            זיהוי המספר: {CONTACT_TYPE_LABELS[simResult.contactType] || simResult.contactType}
            {simResult.inQuietHours ? " · שעות שקט עכשיו" : ""}
            {!simResult.masterEnabled ? " · הבוט כבוי" : ""}
          </p>
          {simResult.intent && (
            <p className="text-gray-400 text-xs">
              מילים שתפסו:{" "}
              {[
                simResult.intent.matchedService && `שירות "${simResult.intent.matchedService}"`,
                simResult.intent.matchedInquiry && `מחיר/זמינות "${simResult.intent.matchedInquiry}"`,
                simResult.intent.matchedSelfEvent && `אירוע עצמי "${simResult.intent.matchedSelfEvent}"`,
                simResult.intent.matchedDate && "תאריך",
                simResult.intent.matchedAd && "הגיע ממודעה",
                simResult.intent.matchedVendor && `⛔ ספק "${simResult.intent.matchedVendor}"`,
              ]
                .filter(Boolean)
                .join(" · ") || "אף מילה"}
            </p>
          )}
          {simResult.wouldSend && simResult.greeting && (
            <div className="bg-gray-900/60 border border-gray-700 rounded p-2 text-gray-200 text-xs whitespace-pre-wrap">
              {simResult.greeting}
            </div>
          )}
          {simResult.notes?.length > 0 && (
            <ul className="list-disc pr-4 text-xs text-amber-300/90 space-y-0.5">
              {simResult.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
