import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Send, History, MapPin } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { normalizeIsraeliPhone } from "@/lib/whatsappLeadParser";
import { getStaffRateForRole } from "@/lib/staffRates";
import { SLOT_OPTIONS } from "@/lib/staffAvailabilityBatch";
import StaffBatchAvailabilityDialog from "./StaffBatchAvailabilityDialog";
import StaffAvailabilityHistoryDialog from "./StaffAvailabilityHistoryDialog";

export const CHAT_STAFF_KEY = ["chatStaffMembers"];

// The crew member behind a "צוות" chat (2026-10-09, the owner's design): found by phone in
// staff_members. Slots (one or more), the cost per slot (rates_by_role), the area, and two
// doors: send an availability check for the events missing his slot, and the history of
// what he was asked / answered — to assign from.
export default function StaffChatSection({ conversation }) {
  const qc = useQueryClient();
  const staffQ = useQuery({ queryKey: CHAT_STAFF_KEY, queryFn: () => base44.entities.StaffMember.list(), staleTime: 60000 });
  const phone = normalizeIsraeliPhone(conversation?.phone || String(conversation?.chatId || "").split("@")[0]);
  const staff = useMemo(
    () => (staffQ.data || []).find((s) => phone && normalizeIsraeliPhone(s.phoneNumber) === phone) || null,
    [staffQ.data, phone]
  );
  const [area, setArea] = useState("");
  const [asking, setAsking] = useState(false);
  const [history, setHistory] = useState(false);
  useEffect(() => setArea(staff?.area || ""), [staff?.id, staff?.area]);

  const pendingQ = useQuery({
    queryKey: ["chatStaffAvailable", staff?.id],
    enabled: !!staff,
    queryFn: async () => {
      const rows = await base44.entities.StaffAvailabilityRequest.filter({ staffMemberId: staff.id, status: "available" }, "-requestedAt", 200);
      const today = new Date().toISOString().slice(0, 10);
      return rows.filter((r) => !r.revokedAt && !r.assignedAt && String(r.eventDateSnapshot || "") >= today).length;
    },
  });

  if (staffQ.isLoading) return null;
  if (!staff) {
    return (
      <section className="space-y-1 rounded-xl border border-gray-800 bg-gray-900 p-3 text-xs text-gray-400">
        <h3 className="font-semibold text-gray-300">איש צוות</h3>
        לא נמצא איש צוות עם המספר הזה. כדי לראות כאן תפקידים, עלות ובדיקת זמינות — הוסף את המספר לאיש הצוות בהגדרות ← צוות.
      </section>
    );
  }

  const save = async (values, done) => {
    try {
      await base44.entities.StaffMember.update(staff.id, values);
      qc.invalidateQueries({ queryKey: CHAT_STAFF_KEY });
      if (done) toast.success(done);
    } catch (e) {
      toast.error("השמירה נכשלה", { description: e?.message });
    }
  };
  const slots = staff.teamSlots || [];
  const eligible = SLOT_OPTIONS.filter((o) => o.jobRole === staff.role);
  const toggleSlot = (v) => save({ teamSlots: slots.includes(v) ? slots.filter((x) => x !== v) : [...slots, v] });
  const shownCosts = (slots.length ? SLOT_OPTIONS.filter((o) => slots.includes(o.value)) : eligible);

  return (
    <section className="space-y-3 rounded-xl border border-gray-800 bg-gray-900 p-3">
      <h3 className="text-xs font-semibold text-gray-500">איש צוות · {staff.name}</h3>
      <div>
        <div className="mb-1.5 text-xs text-gray-400">תפקידים · אפשר כמה</div>
        <div className="flex flex-wrap gap-1.5">
          {SLOT_OPTIONS.map((o) => {
            const on = slots.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggleSlot(o.value)}
                className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-sky-400 bg-sky-500/20 text-sky-200" : "border-gray-700 text-gray-300 hover:border-gray-500"}`}
              >
                {on ? "✓ " : ""}{o.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="space-y-1 text-xs">
        <div className="text-gray-400">עלות{slots.length ? "" : " (לפי התפקיד הכללי)"}</div>
        {shownCosts.length ? shownCosts.map((o) => (
          <div key={o.value} className="flex justify-between text-gray-200"><span>{o.label}</span><span className="font-semibold">₪{Number(getStaffRateForRole(staff, o.value) || 0).toLocaleString()}</span></div>
        )) : <div className="text-gray-500">בחר תפקיד</div>}
        <div className="text-[11px] text-gray-500">המחירים נערכים בהגדרות ← צוות.</div>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <MapPin className="h-3.5 w-3.5 text-gray-400" />
        <span className="text-gray-400">אזור</span>
        <input
          value={area}
          onChange={(e) => setArea(e.target.value)}
          onBlur={() => area.trim() !== (staff.area || "") && save({ area: area.trim() || null }, "האזור נשמר")}
          placeholder="למשל נתיבות"
          className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-950 px-2 py-1 text-sm text-white"
        />
      </label>
      <div className="grid gap-2">
        <button type="button" onClick={() => setAsking(true)} className="flex items-center justify-center gap-1.5 rounded-xl bg-pink-600 py-2.5 text-sm font-semibold text-white hover:bg-pink-700">
          <Send className="h-4 w-4" /> בדיקת זמינות
        </button>
        <button type="button" onClick={() => setHistory(true)} className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-700 py-2.5 text-sm text-gray-100 hover:border-yellow-500">
          <History className="h-4 w-4" /> היסטוריית זמינות{pendingQ.data ? ` · ${pendingQ.data} פנוי לשיבוץ` : ""}
        </button>
      </div>
      {asking && <StaffBatchAvailabilityDialog staff={staff} onClose={() => { setAsking(false); pendingQ.refetch(); }} />}
      {history && <StaffAvailabilityHistoryDialog staff={staff} onClose={() => { setHistory(false); pendingQ.refetch(); }} />}
    </section>
  );
}
