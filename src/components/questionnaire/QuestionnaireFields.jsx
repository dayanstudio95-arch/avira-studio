import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { questionLabel } from "@/lib/questionnaireConfig";

// The questionnaire's questions, section by section, as the studio set them up (2026-10-24):
// the couple's page (EventQuestionnaire) and the preview in Settings → שאלון הפקה draw the
// same thing. `sections` from questionnaireSections(); `form` holds the built-in answers by
// key, `extra` the studio's own questions by id.
const inputCls = "bg-gray-800 border-gray-700 text-white placeholder-gray-500";
const boxCls = "border-gray-500 data-[state=checked]:bg-yellow-400 data-[state=checked]:border-yellow-400 data-[state=checked]:text-gray-900";

export default function QuestionnaireFields({ sections, form, setForm, extra, setExtra }) {
  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  const setChecked = (field) => (checked) => setForm((prev) => ({ ...prev, [field]: !!checked }));
  const setExtraValue = (id, value) => setExtra((prev) => ({ ...prev, [id]: value }));

  const shown = sections.filter((s) => s.items.length > 0);
  return shown.map((section, i) => (
    <div key={section.id} className={i === 0 ? "space-y-4" : "space-y-4 pt-2 border-t border-gray-800"}>
      <h3 className={`text-white font-semibold text-sm ${i === 0 ? "" : "pt-2"}`}>{section.title}</h3>
      {section.items.map((q) => {
        if (q.builtin && q.kind === "group") {
          return (
            <div key={q.key} className="space-y-3 pt-1">
              <div className="flex items-center gap-2">
                <Checkbox id={q.key} checked={!!form[q.key]} onCheckedChange={setChecked(q.key)} className={boxCls} />
                <Label htmlFor={q.key} className="text-gray-300 cursor-pointer">{q.label}</Label>
              </div>
              {form[q.key] && (
                <div className="grid grid-cols-1 gap-3 pr-6">
                  <div>
                    <Label className="text-gray-300 mb-1.5 block">{q.nameLabel}</Label>
                    <Input type="text" value={form[q.nameKey] || ""} onChange={set(q.nameKey)} className={inputCls} />
                  </div>
                  <div>
                    <Label className="text-gray-300 mb-1.5 block">{q.phoneLabel}</Label>
                    <Input type="tel" value={form[q.phoneKey] || ""} onChange={set(q.phoneKey)} placeholder="050-0000000" className={inputCls} dir="ltr" />
                  </div>
                </div>
              )}
            </div>
          );
        }

        if (!q.builtin && q.type === "yesno") {
          const v = extra[q.id];
          const pill = (value, text) => (
            <button
              type="button"
              aria-pressed={v === value}
              onClick={() => setExtraValue(q.id, v === value ? undefined : value)}
              className={`min-h-[40px] min-w-[64px] rounded-xl border px-4 text-sm ${v === value ? "border-yellow-400 bg-yellow-400 font-semibold text-gray-900" : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
            >
              {text}
            </button>
          );
          return (
            <div key={q.id}>
              <Label className="text-gray-300 mb-1.5 block">{questionLabel(q)}</Label>
              <div className="flex gap-2">{pill(true, "כן")}{pill(false, "לא")}</div>
            </div>
          );
        }

        const value = q.builtin ? form[q.key] || "" : extra[q.id] ?? "";
        const onChange = q.builtin ? set(q.key) : (e) => setExtraValue(q.id, e.target.value);
        const long = q.kind === "long";
        return (
          <div key={q.key}>
            <Label className="text-gray-300 mb-1.5 block">{questionLabel(q)}</Label>
            {long ? (
              <Textarea value={value} onChange={onChange} placeholder={q.placeholder || undefined} rows={q.rows || 3} required={q.required} className={`${inputCls} resize-none`} />
            ) : (
              <Input
                type={q.kind === "tel" ? "tel" : "text"}
                value={value}
                onChange={onChange}
                placeholder={q.placeholder || undefined}
                required={q.required}
                className={inputCls}
                dir={q.kind === "tel" || q.kind === "ltr" ? "ltr" : undefined}
              />
            )}
          </div>
        );
      })}
    </div>
  ));
}
