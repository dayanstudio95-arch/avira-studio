import { useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { chaptersText, parseChapters } from "@films-shared/chapters";
import { TAGS, TAG_ORDER, qualityOf, formatBytes } from "@films-shared/dropbox";
import { PROVIDER_NAMES } from "@films-shared/providers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateShort } from "@/lib/dates";

// Editable list of films: title, type, order, remove. Used by galleries and the
// studio page. Ported from the films app's admin (same fields, same order rules).
// withChapters: galleries only, "12:30 חופה" lines the couple can jump to.
export default function FilmsEditor({ films, onChange, titleLabel = "שם הסרט (כפי שהזוג יראה)", withChapters = false }) {
  if (!films?.length) return null;
  const update = (i, patch) => onChange(films.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= films.length) return;
    const next = [...films];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800">
      <table className="w-full text-sm" data-testid="films">
        <thead className="text-gray-400 bg-gray-900/60">
          <tr>
            <th className="w-10 p-2" />
            <th className="p-2 text-right font-medium">{titleLabel}</th>
            <th className="p-2 text-right font-medium w-40">סוג</th>
            <th className="p-2 text-right font-medium w-24">גודל</th>
            <th className="p-2 w-32" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {films.map((f, i) => {
            const q = qualityOf(f.fileName);
            return (
              <tr key={`${f.sourceUrl}-${f.fileId}-${i}`}>
                <td className="p-2 text-gray-500 text-center">{i + 1}</td>
                <td className="p-2">
                  <Input value={f.title} onChange={(e) => update(i, { title: e.target.value })} className="bg-gray-800 border-gray-700 text-white" />
                  <div className="text-xs text-gray-500 mt-1" dir="ltr">
                    {q && <span className="me-2 rounded bg-gray-800 px-1.5 py-0.5 text-gray-300">{q.label}</span>}
                    {PROVIDER_NAMES[f.provider || "dropbox"]} · {f.fileName}
                    {!f.playable && <span className="text-amber-400"> · להורדה בלבד (לא MP4)</span>}
                  </div>
                  {f.linkIssue && (
                    <div className="text-xs text-red-400 mt-1" data-testid="film-link-broken">
                      הקישור נשבר: {f.linkIssue.reason} (נבדק {formatDateShort(f.linkIssue.at)}). הזוג רואה "הסרט כבר לא זמין". החליפו את הקישור או טענו את התיקייה מחדש.
                    </div>
                  )}
                  {expiryNote(f) && (
                    <div className="text-xs text-amber-400 mt-1" data-testid="film-expiry">
                      {expiryNote(f)}
                    </div>
                  )}
                  {withChapters && f.playable && <Chapters film={f} onChange={(chapters) => update(i, { chapters })} />}
                </td>
                <td className="p-2">
                  <select
                    value={f.tag}
                    onChange={(e) => update(i, { tag: e.target.value })}
                    className="w-full rounded-md bg-gray-800 border border-gray-700 text-white px-2 py-2"
                  >
                    {TAG_ORDER.map((t) => (
                      <option key={t} value={t}>
                        {TAGS[t].label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-2 text-gray-300" dir="ltr">
                  {formatBytes(f.sizeBytes)}
                </td>
                <td className="p-2">
                  <div className="flex gap-1 justify-end">
                    <Button type="button" size="icon" variant="ghost" className="text-gray-400 hover:text-white" onClick={() => move(i, -1)} title="למעלה">
                      <ArrowUp className="w-4 h-4" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="text-gray-400 hover:text-white" onClick={() => move(i, 1)} title="למטה">
                      <ArrowDown className="w-4 h-4" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => onChange(films.filter((_, j) => j !== i))} title="הסר">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// A MyAirBridge share ends on its own (fix plan P65): the editor says when, a week ahead in plain words.
function expiryNote(f) {
  const t = Date.parse(f.providerExpiresAt || "");
  if (!Number.isFinite(t)) return "";
  const date = formatDateShort(new Date(t).toISOString());
  if (t <= Date.now()) return `תוקף הקישור ב-MyAirBridge פג ב-${date}: הזוג לא יוכל לצפות בסרט. העלו אותו שוב ושלחו קישור חדש.`;
  return `הקישור ב-MyAirBridge פג ב-${date}. אחרי התאריך הזוג לא יוכל לצפות בסרט.`;
}

/** "12:30 חופה", one per line: the couple can jump to each part of a long film. */
function Chapters({ film, onChange }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => chaptersText(film.chapters));
  const n = film.chapters?.length ?? 0;
  if (!open)
    return (
      <button type="button" className="mt-1 text-xs text-brand-300 underline underline-offset-2" onClick={() => setOpen(true)} data-testid="chapters-open">
        {n ? `פרקים (${n})` : "+ פרקים"}
      </button>
    );
  return (
    <div className="mt-2 space-y-1">
      <textarea
        rows={Math.min(8, Math.max(3, text.split("\n").length + 1))}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const parsed = parseChapters(text);
          onChange(parsed);
          setText(chaptersText(parsed));
        }}
        placeholder={"0:00 התארגנות\n12:30 חופה\n34:10 נאומים\n51:00 ריקודים"}
        className="w-full rounded-md bg-gray-800 border border-gray-700 text-white px-2 py-1.5 text-sm"
        dir="rtl"
        data-testid="chapters"
      />
      <p className="text-xs text-gray-500">שורה לכל פרק: זמן ואז שם. הזוג יוכל לקפוץ ישר לכל חלק בסרט.</p>
    </div>
  );
}
