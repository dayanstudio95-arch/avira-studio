import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Camera } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { defaultUploadRoles, teamPhotographers } from "@/lib/driveUploadPlan";
import { notMarkedYet, peopleText } from "@/lib/photoProcessingPlan";

/**
 * Photos loaded from a link the owner put in Drive himself (2026-11-09, the owner's request): whose materials they were,
 * so work status marks them — the photographers of the event not marked yet, the first one chosen (as an upload does).
 * Nothing when every photographer is marked already. "לא עכשיו" closes it.
 */
export default function LoadedWhoseMaterials({ eventId, count, onClose }) {
  const [left, setLeft] = useState(null);
  const [roles, setRoles] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    supabase
      .from("events")
      .select("team, photographer1_done, photographer2_done")
      .eq("id", eventId)
      .maybeSingle()
      .then(({ data }) => {
        if (!live) return;
        const team = notMarkedYet(teamPhotographers(data?.team), data);
        setLeft(team);
        setRoles(defaultUploadRoles(team, data));
        if (!team.length) onClose();
      });
    return () => {
      live = false;
    };
  }, [eventId]);
  if (!left?.length) return null;
  const mark = async () => {
    const chosen = left.filter((p) => roles.includes(p.role));
    if (!chosen.length) return onClose();
    setSaving(true);
    const { error } = await supabase.from("events").update(Object.fromEntries(chosen.map((p) => [p.field, true]))).eq("id", eventId);
    setSaving(false);
    if (error) return toast.error("הסימון בסטטוס עבודה לא נשמר");
    toast.success(`${peopleText(chosen)} ${chosen.length > 1 ? "סומנו" : "סומן"} בסטטוס עבודה`);
    onClose();
  };
  return (
    <div className="space-y-2 rounded-lg border border-brand-400/50 bg-brand-400/5 p-3" data-testid="loaded-whose">
      <p className="text-sm text-white">נטענו {count.toLocaleString("he-IL")} תמונות. של מי החומרים בתיקייה?</p>
      <div className="flex flex-wrap gap-2">
        {left.map((p) => {
          const on = roles.includes(p.role);
          return (
            <button
              key={p.role}
              type="button"
              onClick={() => setRoles((r) => (on ? r.filter((x) => x !== p.role) : [...r, p.role]))}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${on ? "border-brand-400 bg-brand-400/15 text-white ring-1 ring-brand-400" : "border-gray-600 text-gray-300 hover:border-gray-400"}`}
              aria-pressed={on}
              data-testid={`loaded-role-${p.role}`}
            >
              <Camera className="h-3.5 w-3.5" /> {on ? "✓ " : ""}
              {p.label}
              {p.name ? ` · ${p.name}` : ""}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-500">מי שמסומן כאן נצבע בירוק בסטטוס עבודה: העלה את כל החומרים שלו.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={saving || !roles.length} onClick={mark} className="rounded-md bg-brand-400 px-3 py-1.5 text-sm font-semibold text-brand-fg hover:bg-brand-500 disabled:opacity-50" data-testid="loaded-mark">
          לסמן בסטטוס עבודה
        </button>
        <button type="button" onClick={onClose} className="rounded-md border border-gray-600 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800" data-testid="loaded-skip">
          לא עכשיו
        </button>
      </div>
    </div>
  );
}
