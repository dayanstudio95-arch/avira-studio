import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowDown, ArrowUp, ClipboardList, Eye, Loader2, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import QuestionnaireFields from "@/components/questionnaire/QuestionnaireFields";
import {
  QUESTIONNAIRE_CONFIG_KEY, QUESTION_TYPES, MAX_CUSTOM_QUESTIONS,
  parseQuestionnaireConfig, questionnaireSections, newQuestionId,
} from "@/lib/questionnaireConfig";

// Settings → שאלון הפקה (2026-10-24, the owner's request): the wording of every question,
// required / shown, and the studio's own questions. Built-in questions can be renamed or hidden
// but not deleted (their answers live in their own lead columns and stay); the studio's own can
// be deleted — their answers already given stay on the lead too. Saved to
// app_settings.questionnaire_config (admin roles only, like every setting).
const typeLabel = (t) => QUESTION_TYPES.find((x) => x.value === t)?.label || t;

export default function QuestionnaireSettingsTab() {
  const [config, setConfig] = useState({ builtins: {}, custom: [] });
  const [settingId, setSettingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(null); // key / id of the open row
  const [draft, setDraft] = useState(null);
  const [preview, setPreview] = useState(false);
  const [pForm, setPForm] = useState({});
  const [pExtra, setPExtra] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const rows = await base44.entities.AppSetting.filter({ key: QUESTIONNAIRE_CONFIG_KEY });
        const row = rows?.[0];
        if (row) setSettingId(row.id);
        setConfig(parseQuestionnaireConfig(row?.value));
      } catch (e) {
        toast.error("טעינת השאלון נכשלה", { description: e?.message });
      }
      setLoading(false);
    })();
  }, []);

  const sections = useMemo(() => questionnaireSections(config, { includeHidden: true }), [config]);
  const change = (fn) => { setConfig((c) => fn(c)); setDirty(true); };

  const setBuiltin = (key, patch) => change((c) => {
    const next = { ...(c.builtins[key] || {}), ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    const builtins = { ...c.builtins, [key]: next };
    if (!Object.keys(next).length) delete builtins[key];
    return { ...c, builtins };
  });
  const setCustom = (id, patch) => change((c) => ({ ...c, custom: c.custom.map((q) => (q.id === id ? { ...q, ...patch } : q)) }));

  const openEdit = (q) => {
    setEditing(q.key);
    setDraft({ label: q.label, placeholder: q.placeholder || "", required: !!q.required, type: q.type || "short" });
  };
  const closeEdit = () => { setEditing(null); setDraft(null); };
  // "ביטול" on a question just added takes it away again
  const cancelEdit = (q) => {
    if (draft?.fresh && !q.builtin) change((c) => ({ ...c, custom: c.custom.filter((x) => x.id !== q.id) }));
    closeEdit();
  };

  const saveRow = (q) => {
    const label = draft.label.trim();
    if (!label) { toast.error("כתבו את השאלה"); return; }
    if (q.builtin) {
      setBuiltin(q.key, {
        label: label === q.defaultLabel ? undefined : label,
        placeholder: draft.placeholder.trim() === q.defaultPlaceholder ? undefined : draft.placeholder.trim(),
        required: q.kind === "group" || draft.required === q.defaultRequired ? undefined : draft.required,
      });
    } else {
      setCustom(q.id, { label, placeholder: draft.placeholder.trim(), required: draft.required, type: draft.type });
    }
    closeEdit();
  };

  const addQuestion = (sectionId) => {
    if (config.custom.length >= MAX_CUSTOM_QUESTIONS) { toast.error(`אפשר עד ${MAX_CUSTOM_QUESTIONS} שאלות משלכם`); return; }
    const id = newQuestionId(config.custom);
    // a placeholder label so the row exists; the editor opens on it right away
    change((c) => ({ ...c, custom: [...c.custom, { id, section: sectionId, type: "short", label: "שאלה חדשה", placeholder: "", required: false, hidden: false }] }));
    setEditing(id);
    setDraft({ label: "", placeholder: "", required: false, type: "short", fresh: true });
  };

  const removeQuestion = async (q) => {
    const ok = await confirmDialog({
      title: `למחוק את השאלה "${q.label}"?`,
      message: "היא תרד מהשאלון. תשובות שזוגות כבר נתנו לה נשמרות ומופיעות אצל הליד.",
      confirmText: "מחק שאלה",
    });
    if (!ok) return;
    change((c) => ({ ...c, custom: c.custom.filter((x) => x.id !== q.id) }));
    if (editing === q.id) closeEdit();
  };

  // up / down among the studio's own questions of the same section
  const move = (q, dir) => change((c) => {
    const list = [...c.custom];
    const same = list.map((x, i) => [x, i]).filter(([x]) => x.section === q.section);
    const pos = same.findIndex(([x]) => x.id === q.id);
    const other = same[pos + dir];
    if (!other) return c;
    const a = same[pos][1];
    const b = other[1];
    [list[a], list[b]] = [list[b], list[a]];
    return { ...c, custom: list };
  });

  const save = async () => {
    setSaving(true);
    try {
      const value = JSON.stringify(parseQuestionnaireConfig(config));
      if (settingId) {
        await base44.entities.AppSetting.update(settingId, { value });
      } else {
        const created = await base44.entities.AppSetting.create({ key: QUESTIONNAIRE_CONFIG_KEY, value });
        setSettingId(created.id);
      }
      setDirty(false);
      toast.success("השאלון נשמר — הזוגות יראו את השינויים מיד");
    } catch (e) {
      toast.error("השמירה נכשלה", { description: e?.message });
    }
    setSaving(false);
  };

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>;

  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-white"><ClipboardList className="h-5 w-5 text-yellow-400" /> שאלון הפקה — מה הזוג ממלא</CardTitle>
            <p className="mt-1 text-sm text-gray-400">שינויים מופיעים בשאלון מיד אחרי שמירה. תשובות שכבר התקבלו לא נמחקות.</p>
          </div>
          <Button type="button" variant="outline" onClick={() => { setPForm({}); setPExtra({}); setPreview(true); }} className="gap-2 border-sky-700 bg-gray-800 text-sky-200 hover:bg-gray-700">
            <Eye className="h-4 w-4" /> הצג כמו שהזוג רואה
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4" dir="rtl">
        {sections.map((section) => {
          const customIds = section.items.filter((q) => !q.builtin).map((q) => q.id);
          return (
            <div key={section.id} className="rounded-xl border border-gray-700 bg-gray-800/40 p-3">
              <div className="mb-2 font-semibold text-white">{section.title}</div>
              <div className="space-y-2">
                {section.items.map((q) => {
                  const open = editing === q.key;
                  return (
                    <div key={q.key} className={`rounded-lg border p-2.5 ${q.builtin ? "border-gray-700 bg-gray-900/60" : "border-violet-700/60 bg-violet-950/20"} ${q.hidden ? "opacity-60" : ""}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        {/* on a phone the text takes the line, the buttons go under it */}
                        <div className="min-w-0 w-full sm:w-auto sm:flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-sm text-gray-100">
                            <span>{q.label}</span>
                            {q.required && <span className="rounded-full bg-red-900/60 px-2 py-0.5 text-[11px] text-red-100">חובה</span>}
                            {q.builtin
                              ? <span className="rounded-full border border-gray-600 px-2 py-0.5 text-[11px] text-gray-400">שאלה קבועה</span>
                              : <span className="rounded-full bg-violet-900/60 px-2 py-0.5 text-[11px] text-violet-100">שאלה שלי · {typeLabel(q.type)}</span>}
                          </div>
                          {q.hidden
                            ? <div className="text-[11px] text-amber-300">מוסתרת מהשאלון · התשובות הקודמות נשמרות</div>
                            : q.placeholder && q.kind !== "group" && <div className="text-[11px] text-gray-500">דוגמה בשדה: {q.placeholder}</div>}
                        </div>
                        <div className="ms-auto flex items-center gap-1">
                        {!q.builtin && (
                          <>
                            <button type="button" onClick={() => move(q, -1)} disabled={customIds[0] === q.id} aria-label="למעלה" className="rounded p-1.5 text-gray-400 hover:bg-gray-700 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                            <button type="button" onClick={() => move(q, 1)} disabled={customIds[customIds.length - 1] === q.id} aria-label="למטה" className="rounded p-1.5 text-gray-400 hover:bg-gray-700 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                          </>
                        )}
                        <button type="button" onClick={() => (open ? cancelEdit(q) : openEdit(q))} aria-label="עריכה" className="rounded p-1.5 text-gray-300 hover:bg-gray-700"><Pencil className="h-4 w-4" /></button>
                        {!q.builtin && (
                          <button type="button" onClick={() => removeQuestion(q)} aria-label="מחיקה" className="rounded p-1.5 text-red-400 hover:bg-red-950/40"><Trash2 className="h-4 w-4" /></button>
                        )}
                        <Switch
                          checked={!q.hidden}
                          onCheckedChange={(on) => (q.builtin ? setBuiltin(q.key, { hidden: on ? undefined : true }) : setCustom(q.id, { hidden: !on }))}
                          aria-label={q.hidden ? "מוסתרת — לחצו להציג" : "מוצגת — לחצו להסתיר"}
                          className="data-[state=checked]:bg-green-600 data-[state=unchecked]:bg-gray-600"
                        />
                        </div>
                      </div>

                      {open && draft && (
                        <div className="mt-2 space-y-2 border-t border-gray-700 pt-2 text-sm">
                          <label className="block">
                            <span className="mb-1 block text-xs text-gray-400">השאלה</span>
                            <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} autoFocus className="bg-gray-800 border-gray-700 text-white" />
                          </label>
                          {!q.builtin && (
                            <label className="block">
                              <span className="mb-1 block text-xs text-gray-400">סוג תשובה</span>
                              <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} className="h-10 w-full rounded-md border border-gray-700 bg-gray-800 px-2 text-white">
                                {QUESTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                              </select>
                            </label>
                          )}
                          {q.kind !== "group" && (q.builtin || draft.type !== "yesno") && (
                            <label className="block">
                              <span className="mb-1 block text-xs text-gray-400">דוגמה בתוך השדה (לא חובה)</span>
                              <Input value={draft.placeholder} onChange={(e) => setDraft({ ...draft, placeholder: e.target.value })} className="bg-gray-800 border-gray-700 text-white" />
                            </label>
                          )}
                          {q.kind !== "group" && (
                            <label className="flex items-center gap-2 text-gray-200">
                              <input type="checkbox" checked={draft.required} onChange={(e) => setDraft({ ...draft, required: e.target.checked })} className="h-4 w-4 accent-yellow-400" />
                              חובה למלא
                            </label>
                          )}
                          {q.builtin && (
                            <div className="text-[11px] text-gray-500">הנוסח המקורי: "{q.defaultLabel}"{q.defaultPlaceholder ? ` · דוגמה: "${q.defaultPlaceholder}"` : ""}{q.defaultRequired ? " · חובה" : ""}</div>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" onClick={() => saveRow(q)} className="bg-yellow-400 text-gray-900 hover:bg-yellow-300">אישור</Button>
                            <Button type="button" variant="outline" onClick={() => cancelEdit(q)} className="border-gray-600 bg-gray-800 text-gray-200">ביטול</Button>
                            {q.builtin && (
                              <Button type="button" variant="ghost" onClick={() => { setBuiltin(q.key, { label: undefined, placeholder: undefined, required: undefined }); closeEdit(); }} className="gap-1 text-gray-300">
                                <RotateCcw className="h-4 w-4" /> חזרה לנוסח המקורי
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <button type="button" onClick={() => addQuestion(section.id)} className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-violet-600/70 py-2 text-sm text-violet-200 hover:bg-violet-950/30">
                <Plus className="h-4 w-4" /> הוסף שאלה לפרק הזה
              </button>
            </div>
          );
        })}

        <div className="sticky bottom-2 flex items-center gap-3 rounded-xl border border-gray-700 bg-gray-900/95 p-3">
          <Button type="button" onClick={save} disabled={saving || !dirty} className="bg-yellow-400 text-gray-900 hover:bg-yellow-300">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "שמור שינויים"}
          </Button>
          <span className="text-xs text-gray-400">{dirty ? "יש שינויים שלא נשמרו" : "הכל שמור"}</span>
        </div>
      </CardContent>

      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-gray-800 bg-gray-950 text-white" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right">השאלון כמו שהזוג רואה{dirty ? " (כולל שינויים שלא נשמרו)" : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 rounded-2xl border border-gray-800 bg-gray-900 p-5">
            <QuestionnaireFields sections={questionnaireSections(config)} form={pForm} setForm={setPForm} extra={pExtra} setExtra={setPExtra} />
          </div>
          <p className="text-center text-xs text-gray-500">תצוגה בלבד — שום דבר לא נשמר מכאן</p>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
