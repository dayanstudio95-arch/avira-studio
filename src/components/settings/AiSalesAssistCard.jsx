import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

// "עוזר מכירות AI" (2026-10-09): the rules the chat's ✨ button drafts by. The style
// rules and the price table go to the model as-is; the price table also decides which
// numbers a suggestion is ALLOWED to name (_shared/aiSalesRules.ts allowedOffers).
// Empty = the built-in defaults, which the server sends (whatsapp-ai-assist "settings").
const KEYS = ["ai_assist_enabled", "ai_style_rules", "ai_price_rules", "ai_monthly_cap_ils"];
const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

const num = (v) => {
  const n = Number(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export default function AiSalesAssistCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ids, setIds] = useState({});
  const [enabled, setEnabled] = useState(true);
  const [style, setStyle] = useState("");
  const [rules, setRules] = useState(null); // { packages, winterMonths, henna }
  const [cap, setCap] = useState("");
  const [info, setInfo] = useState(null); // { defaults, spentIls, callsByKind, hasKey }

  useEffect(() => {
    (async () => {
      try {
        const [rows, res] = await Promise.all([
          base44.entities.AppSetting.filter({ key: { $in: KEYS } }),
          base44.functions.invoke("whatsappAiAssist", { action: "settings" }).catch((e) => ({ error: e })),
        ]);
        const byKey = Object.fromEntries((rows || []).map((r) => [r.key, r]));
        setIds(Object.fromEntries((rows || []).map((r) => [r.key, r.id])));
        const d = res?.data?.defaults;
        setInfo(res?.data || null);
        setEnabled(byKey.ai_assist_enabled?.value !== "false");
        setStyle(byKey.ai_style_rules?.value || d?.styleRules || "");
        let saved = null;
        try { saved = byKey.ai_price_rules?.value ? JSON.parse(byKey.ai_price_rules.value) : null; } catch { saved = null; }
        setRules(saved?.packages ? saved : d?.priceRules || { packages: [], winterMonths: [1, 2], henna: "" });
        setCap(byKey.ai_monthly_cap_ils?.value || String(d?.monthlyCap || 50));
      } catch (e) {
        toast.error("טעינת הגדרות העוזר נכשלה", { description: e?.message });
      }
      setLoading(false);
    })();
  }, []);

  const setPkg = (i, patch) => setRules((r) => ({ ...r, packages: r.packages.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));

  const save = async () => {
    const packages = (rules?.packages || [])
      .filter((p) => String(p.name || "").trim() && num(p.list))
      .map((p) => ({
        name: String(p.name).trim(),
        list: num(p.list),
        steps: String(Array.isArray(p.steps) ? p.steps.join(",") : p.steps || "").split(/[,\s←]+/).map(num).filter(Boolean),
        thuFri: num(p.thuFri),
        winter: num(p.winter),
        none: !!p.none,
      }));
    const bad = packages.find((p) => p.steps.some((n) => n >= p.list) || (p.winter && p.winter >= p.list) || (p.thuFri && p.thuFri >= p.list));
    if (bad) {
      toast.error(`ב"${bad.name}" יש מחיר הנחה שאינו נמוך מהמחירון`);
      return;
    }
    const values = {
      ai_assist_enabled: enabled ? "true" : "false",
      ai_style_rules: style.trim(),
      // An empty table is saved as "" — the server then uses its built-in table, never "no
      // prices allowed".
      ai_price_rules: packages.length ? JSON.stringify({ packages, winterMonths: rules?.winterMonths || [1, 2], henna: rules?.henna || "" }) : "",
      ai_monthly_cap_ils: String(num(cap) || 50),
    };
    setSaving(true);
    try {
      const next = { ...ids };
      for (const key of KEYS) {
        if (next[key]) await base44.entities.AppSetting.update(next[key], { value: values[key] });
        else next[key] = (await base44.entities.AppSetting.create({ key, value: values[key] })).id;
      }
      setIds(next);
      setRules((r) => ({ ...r, packages }));
      toast.success("נשמר");
    } catch (e) {
      toast.error("השמירה נכשלה", { description: e?.message });
    }
    setSaving(false);
  };

  if (loading) {
    return <Card className="border-gray-700 bg-gray-800"><CardContent className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></CardContent></Card>;
  }

  const spent = info?.spentIls ?? null;
  const calls = info?.callsByKind || {};

  return (
    <Card className="border-gray-700 bg-gray-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white"><Sparkles className="h-5 w-5 text-violet-300" /> עוזר מכירות בשיחות</CardTitle>
        <p className="text-sm text-gray-400">
          הכפתור ✨ בשיחת וואטסאפ מציע תשובה או משפר את מה שכתבתם, לפי הכללים והמחירים כאן. הוא רק מציע — שום דבר לא נשלח בלי לחיצה שלכם.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {!info && (
          <div className="rounded-lg border border-amber-800 bg-amber-950/40 p-3 text-sm text-amber-200">
            לא הצלחנו לטעון את ברירות המחדל מהשרת. שדה ריק = העוזר משתמש בכללים ובמחירים המובנים.
          </div>
        )}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-700 bg-gray-900/50 p-3">
          <div className="min-w-0">
            <div className="font-semibold text-white">העוזר פעיל</div>
            <div className="text-xs text-gray-400">כבוי = הכפתורים בשיחה מחזירים הודעה במקום הצעה. התיוג האוטומטי של ההודעות ממשיך.</div>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} className="shrink-0" />
        </div>

        <div className="grid gap-3 rounded-lg border border-gray-700 bg-gray-900/50 p-3 sm:grid-cols-3">
          <div>
            <Label className="text-gray-300">תקרה חודשית (₪)</Label>
            <Input value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" className="mt-1 border-gray-600 bg-gray-800 text-white" />
          </div>
          <div className="sm:col-span-2">
            <div className="text-sm text-gray-300">החודש עד עכשיו</div>
            <div className="mt-1 text-2xl font-bold text-white">{spent === null ? "—" : `${spent.toFixed(2)} ₪`}</div>
            <div className="text-xs text-gray-500">
              הצעות {calls.suggest || 0} · שיפורים {calls.improve || 0} · סיכומים {calls.summary || 0} · תיוגים {calls.tag || 0} · הערכה לפי מחירון Anthropic
            </div>
            {info && !info.hasKey && <div className="mt-1 text-xs text-amber-300">לא מוגדר מפתח Anthropic — הגדרות ← חיבורים.</div>}
          </div>
        </div>

        <div>
          <Label className="text-gray-300">כללי סגנון</Label>
          <p className="mb-1 text-xs text-gray-500">איך אתם כותבים. העוזר לומד גם מההודעות האחרונות ששלחתם בעצמכם.</p>
          <Textarea value={style} onChange={(e) => setStyle(e.target.value)} rows={12} className="border-gray-600 bg-gray-900 text-sm leading-relaxed text-white" />
          {info?.defaults?.styleRules && style.trim() !== info.defaults.styleRules.trim() && (
            <button type="button" onClick={() => setStyle(info.defaults.styleRules)} className="mt-1 text-xs text-violet-300 hover:underline">החזר לברירת המחדל</button>
          )}
        </div>

        <div>
          <Label className="text-gray-300">טבלת מחירים להצעות</Label>
          <p className="mb-2 text-xs text-gray-500">
            "מותר להציע" = המחירים לפי הסדר (קודם הגבוה, ורק אם הזוג עדיין מבקש — הבא). חמישי/שישי וחורף = הכי נמוך שמותר באותם ימים. העוזר לעולם לא מציע פחות מזה.
          </p>
          <div className="space-y-2">
            <div className="hidden grid-cols-[1.3fr_0.8fr_1.3fr_0.8fr_0.8fr_auto_auto] gap-2 px-2 text-xs text-gray-400 sm:grid">
              <span>חבילה</span><span>מחירון</span><span>מותר להציע (לפי הסדר)</span><span>חמישי/שישי</span><span>חורף</span><span className="w-20" /><span className="w-4" />
            </div>
            {(rules?.packages || []).map((p, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-gray-700 bg-gray-900/50 p-2 sm:grid-cols-[1.3fr_0.8fr_1.3fr_0.8fr_0.8fr_auto_auto]">
                <Input aria-label="חבילה" value={p.name} onChange={(e) => setPkg(i, { name: e.target.value })} placeholder="שם החבילה" className="border-gray-600 bg-gray-800 text-white" />
                <Input aria-label="מחירון" value={p.list ?? ""} onChange={(e) => setPkg(i, { list: e.target.value })} placeholder="מחירון" inputMode="numeric" className="border-gray-600 bg-gray-800 text-white" />
                <Input aria-label="מותר להציע" dir="ltr" disabled={p.none} value={Array.isArray(p.steps) ? p.steps.join(", ") : p.steps || ""} onChange={(e) => setPkg(i, { steps: e.target.value })} placeholder="מותר להציע: 13000, 12500" className="border-gray-600 bg-gray-800 text-white" />
                <Input aria-label="חמישי/שישי" disabled={p.none} value={p.thuFri ?? ""} onChange={(e) => setPkg(i, { thuFri: e.target.value })} placeholder="חמישי/שישי" inputMode="numeric" className="border-gray-600 bg-gray-800 text-white" />
                <Input aria-label="חורף" disabled={p.none} value={p.winter ?? ""} onChange={(e) => setPkg(i, { winter: e.target.value })} placeholder="חורף" inputMode="numeric" className="border-gray-600 bg-gray-800 text-white" />
                <button
                  type="button"
                  aria-pressed={!!p.none}
                  onClick={() => setPkg(i, { none: !p.none })}
                  className={`w-20 rounded-full border px-2 py-1 text-xs ${p.none ? "border-rose-700 bg-rose-950/60 text-rose-200" : "border-gray-600 text-gray-400 hover:text-white"}`}
                >
                  {p.none ? "✕ בלי הנחה" : "בלי הנחה"}
                </button>
                <button type="button" aria-label="מחק חבילה" onClick={() => setRules((r) => ({ ...r, packages: r.packages.filter((_, j) => j !== i) }))} className="justify-self-end text-gray-500 hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setRules((r) => ({ ...r, packages: [...(r?.packages || []), { name: "", list: "", steps: "", thuFri: "", winter: "", none: false }] }))} className="border-gray-600 bg-transparent text-gray-300">
              <Plus className="ml-1 h-4 w-4" /> חבילה
            </Button>
          </div>
          <div className="mt-3">
            <Label className="text-gray-300">חודשי חורף</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {MONTHS.map((m, idx) => {
                const on = (rules?.winterMonths || []).includes(idx + 1);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setRules((r) => ({ ...r, winterMonths: on ? r.winterMonths.filter((x) => x !== idx + 1) : [...(r.winterMonths || []), idx + 1].sort((a, b) => a - b) }))}
                    className={`rounded-full px-2.5 py-1 text-xs ${on ? "bg-sky-700 text-white" : "bg-gray-900 text-gray-400"}`}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-3">
            <Label className="text-gray-300">אם שואלים על חינה</Label>
            <Textarea value={rules?.henna || ""} onChange={(e) => setRules((r) => ({ ...r, henna: e.target.value }))} rows={2} className="mt-1 border-gray-600 bg-gray-900 text-sm text-white" />
          </div>
        </div>

        <Button onClick={save} disabled={saving} className="bg-yellow-400 text-gray-900 hover:bg-yellow-500">
          {saving ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Save className="ml-2 h-4 w-4" />} שמור
        </Button>
      </CardContent>
    </Card>
  );
}
