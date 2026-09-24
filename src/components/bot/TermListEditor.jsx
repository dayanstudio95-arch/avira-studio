import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, X, RotateCcw } from "lucide-react";
import { normalizeTerm, termWarnings } from "@/lib/botTerms";

// One word list of the intent gate, editable (2026-09-24).
//
// Three kinds of chip:
//   grey     — built in. Click switches it off (it shows struck through, and goes into
//              whatsapp_terms_disabled). Click again to bring it back.
//   yellow   — the studio's own word. X removes it.
//   striked  — a built-in the studio switched off.
// The rule the words feed is not editable here, on purpose; only the words are.
export default function TermListEditor({
  label, hint, builtin, extra, disabled, onChangeExtra, onChangeDisabled, effectiveLists, listKey, canManage,
}) {
  const [draft, setDraft] = useState("");
  const [warnings, setWarnings] = useState([]);

  const disabledSet = new Set((disabled || []).map(normalizeTerm));
  const isDisabled = (t) => disabledSet.has(normalizeTerm(t));

  const toggleBuiltin = (term) => {
    if (!canManage) return;
    const n = normalizeTerm(term);
    if (disabledSet.has(n)) {
      onChangeDisabled((disabled || []).filter((d) => normalizeTerm(d) !== n));
    } else {
      onChangeDisabled([...(disabled || []), term]);
    }
  };

  const add = () => {
    const term = draft.trim();
    if (!term) return;
    const n = normalizeTerm(term);
    if ((builtin || []).some((t) => normalizeTerm(t) === n)) {
      // Already built in — the only thing "adding" it could mean is "switch it back on".
      onChangeDisabled((disabled || []).filter((d) => normalizeTerm(d) !== n));
      setDraft("");
      setWarnings([]);
      return;
    }
    if ((extra || []).some((t) => normalizeTerm(t) === n)) {
      setDraft("");
      return;
    }
    onChangeExtra([...(extra || []), term]);
    setDraft("");
    setWarnings([]);
  };

  const remove = (term) => {
    const n = normalizeTerm(term);
    onChangeExtra((extra || []).filter((t) => normalizeTerm(t) !== n));
  };

  const onDraftChange = (v) => {
    setDraft(v);
    setWarnings(v.trim() ? termWarnings(v, listKey, effectiveLists) : []);
  };

  const disabledCount = (builtin || []).filter(isDisabled).length;

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className="text-gray-200 text-sm font-medium">{label}</p>
        <p className="text-gray-500 text-xs">{hint}</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(builtin || []).map((t) => {
          const off = isDisabled(t);
          return (
            <button
              key={`b-${t}`}
              type="button"
              onClick={() => toggleBuiltin(t)}
              disabled={!canManage}
              title={off ? "כבוי — לחץ להחזרה" : "מובנה — לחץ לכיבוי"}
              className={`rounded-full px-2 py-0.5 text-xs border transition-colors ${
                off
                  ? "border-red-900/60 bg-red-950/30 text-red-300 line-through"
                  : "border-gray-700 bg-gray-800/60 text-gray-300 hover:border-gray-500"
              } disabled:cursor-default`}
            >
              {t}
            </button>
          );
        })}
        {(extra || []).map((t) => (
          <span
            key={`e-${t}`}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border border-yellow-500/50 bg-yellow-500/10 text-yellow-200"
            title="מילה שלך"
          >
            {t}
            {canManage && (
              <button type="button" onClick={() => remove(t)} className="hover:text-white" title="הסר">
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
      </div>

      {disabledCount > 0 && (
        <p className="text-xs text-red-300/90 flex items-center gap-1">
          <RotateCcw className="w-3 h-3" />
          כיבית {disabledCount} מילים מובנות — פניות שמכילות רק אותן לא יזוהו יותר.
        </p>
      )}

      {canManage && (
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="מילה או ביטוי להוספה"
            className="bg-gray-800 border-gray-700 text-white h-8 text-sm"
          />
          <Button type="button" onClick={add} size="sm" variant="outline" className="border-gray-600 text-gray-200 h-8">
            <Plus className="w-3.5 h-3.5 ml-1" />
            הוסף
          </Button>
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="text-xs text-amber-300/90 space-y-0.5 list-disc pr-4">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
