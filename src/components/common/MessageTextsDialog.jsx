import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { confirmDialog } from "@/components/ui/confirm-dialog";

// "המלל לזוג" (2026-11-06, the owner's request — first on "עריכת וידאו", then on the galleries): the message that goes
// to the couple with a link, edited where it is sent from. The same app_settings rows as Settings ← תבניות הודעה.
//   texts: [{ key, label, fallback, render(value, sample) → string, resetLabel? }] — one tab each when more than one
//   vars:  [["{{link}}", "הקישור לסרט"], …] — the explanation line
//   sample: the variables of the preview's sample couple
// onSaved(key, { id, value }) after a save, so the page sends the new words right away.
export default function MessageTextsDialog({ title, texts, vars, sample, note = "", onClose, onSaved }) {
  const [tab, setTab] = useState(texts[0].key);
  const [rows, setRows] = useState(null); // { key: { id, value } }
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const t = texts.find((x) => x.key === tab);
  const value = drafts[tab] ?? "";

  useEffect(() => {
    let alive = true;
    base44.entities.AppSetting.filter({ key: { $in: texts.map((x) => x.key) } })
      .catch(() => [])
      .then((found) => {
        if (!alive) return;
        const byKey = Object.fromEntries((found || []).map((r) => [r.key, { id: r.id, value: r.value || "" }]));
        setRows(byKey);
        setDrafts(Object.fromEntries(texts.map((x) => [x.key, byKey[x.key]?.value || x.fallback])));
      });
    return () => {
      alive = false;
    };
    // the texts of a dialog never change while it is open
  }, []);

  const save = async () => {
    if (!value.trim()) return toast.error("ההודעה ריקה");
    if (!value.includes("{{link}}") && !(await confirmDialog({ title: "אין {{link}} בהודעה", message: "הזוג יקבל את ההודעה בלי הקישור. לשמור בכל זאת?", confirmText: "לשמור" }))) return;
    setBusy(true);
    try {
      const id = rows?.[tab]?.id;
      const row = id ? await base44.entities.AppSetting.update(id, { value }) : await base44.entities.AppSetting.create({ key: tab, value });
      const saved = { id: row?.id || id, value };
      setRows((prev) => ({ ...prev, [tab]: saved }));
      onSaved?.(tab, saved);
      toast.success(`הנוסח של "${t.label}" נשמר`);
    } catch (e) {
      toast.error("השמירה נכשלה: " + (e?.message || ""));
    }
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-3xl" dir="rtl" data-testid="message-texts">
        <DialogHeader>
          <DialogTitle className="text-right">{title}</DialogTitle>
        </DialogHeader>
        {texts.length > 1 && (
          <div className="flex gap-2">
            {texts.map((x) => (
              <button
                key={x.key}
                type="button"
                onClick={() => setTab(x.key)}
                className={`rounded-full border px-3 py-1 text-xs ${tab === x.key ? "border-amber-400/60 bg-amber-400/15 text-amber-100" : "border-white/15 text-gray-300 hover:border-white/30"}`}
              >
                {x.label}
              </button>
            ))}
          </div>
        )}
        <p className="text-xs leading-relaxed text-gray-400">
          {vars.map(([v, what], i) => (
            <React.Fragment key={v}>
              {i > 0 && " · "}
              <span className="font-mono text-amber-300" dir="ltr">{v}</span> {what}
            </React.Fragment>
          ))}
          {note && <span className="block text-gray-500">{note}</span>}
        </p>
        {rows === null ? (
          <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-500" /></div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <textarea
              value={value}
              onChange={(e) => setDrafts((d) => ({ ...d, [tab]: e.target.value }))}
              rows={14}
              className="w-full rounded-lg border border-gray-700 bg-gray-950 p-3 text-sm leading-relaxed text-white"
              data-testid="message-texts-input"
            />
            <div>
              <p className="mb-1 text-xs text-gray-500">כך זה ייראה (זוג לדוגמה):</p>
              <div className="max-h-[22rem] overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/30 p-3 text-sm leading-relaxed text-gray-100" data-testid="message-texts-preview">
                {t.render(value, sample)}
              </div>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-2 sm:justify-between">
          <button type="button" onClick={() => setDrafts((d) => ({ ...d, [tab]: t.fallback }))} className="text-xs text-gray-400 hover:text-white">
            {t.resetLabel || "חזרה לנוסח ההתחלתי"}
          </button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy} className="border-gray-700 bg-gray-800 text-gray-300">סגירה</Button>
            <Button onClick={save} disabled={busy || rows === null} className="bg-amber-400 hover:bg-amber-300 text-gray-900" data-testid="message-texts-save">
              {busy ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Check className="w-4 h-4 ml-1" />}
              שמירה
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
