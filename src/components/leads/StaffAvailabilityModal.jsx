import React, { useState, useMemo, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Send, Camera, Video, ArrowRight, Star, ListChecks } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { STAFF_JOB_ROLES } from "@/lib/staffRoles";
import { generateRawToken, hashToken } from "@/lib/albumTokens";

// Only these two job roles are relevant for an "is a crew member free on this
// date" check — editors/graphic designers aren't booked per-event-date the
// same way, so the role picker deliberately only shows these two (a subset
// of the full STAFF_JOB_ROLES list, not a separate constant).
const AVAILABILITY_ROLES = STAFF_JOB_ROLES.filter((r) => r.value === "photographer" || r.value === "videographer");
const ROLE_ICON = { photographer: Camera, videographer: Video };

function buildDefaultMessage({ roleLabel, eventDate, venue, coupleNames }) {
  const dateStr = eventDate ? format(new Date(eventDate), "d/M/yyyy") : "";
  const parts = [
    `היי! רציתי לבדוק זמינות שלך בתור ${roleLabel}${dateStr ? ` בתאריך ${dateStr}` : ""}${venue ? ` באולם ${venue}` : ""}${coupleNames ? ` (${coupleNames})` : ""}.`,
    "תוכל/י לאשר האם את/ה פנוי/ה?",
  ];
  return parts.join("\n");
}

// Applies the studio-editable template (Settings → תבניות הודעות → "בדיקת
// זמינות צלם/וידאוגרף") if one was saved, substituting the same {{var}}
// placeholders shown as chips there. Falls back to buildDefaultMessage's
// hardcoded string (mirrors the template's own defaultValue) if no template
// was saved yet or the fetch fails.
async function buildMessage({ roleLabel, eventDate, venue, coupleNames }) {
  const dateStr = eventDate ? format(new Date(eventDate), "d/M/yyyy") : "";
  try {
    const rows = await base44.entities.AppSetting.filter({ key: "template_staff_availability_check" });
    const tpl = rows?.[0]?.value;
    if (tpl) {
      return tpl
        .replace(/\{\{role\}\}/g, roleLabel || "")
        .replace(/\{\{event_date\}\}/g, dateStr)
        .replace(/\{\{venue\}\}/g, venue || "")
        .replace(/\{\{names\}\}/g, coupleNames || "");
    }
  } catch {
    // fall through to the hardcoded default below
  }
  return buildDefaultMessage({ roleLabel, eventDate, venue, coupleNames });
}

const STATUS_BADGE = {
  pending: { label: "⏳ ממתין", className: "text-yellow-400" },
  available: { label: "✅ פנוי", className: "text-green-400" },
  declined: { label: "❌ לא פנוי", className: "text-red-400" },
};

// Popup opened from the Lead panel's pink "זמינות צלם" button. Two-step flow:
// 1) pick a job role (photographer / videographer)
// 2) pick which staff members with that role get a WhatsApp availability
//    check for this event's date/venue, then send.
//
// Sending now mints a per-staff-member bearer token (same client-side mint+hash
// pattern as the album portal's link generation -- src/lib/albumTokens.js), stores
// only its hash on a new staff_availability_requests row, and appends the raw token
// as a /staff-availability/:token link to the WhatsApp message so the staff member
// can tap available/declined with no login. `existingRequests` (latest row per staff
// member, fetched by the parent) drives the status badges below each name.
export default function StaffAvailabilityModal({
  open,
  onClose,
  onSent,
  staffMembers,
  eventDate,
  venue,
  coupleNames,
  leadId,
  eventId,
  existingRequests,
  onStaffMembersChanged,
}) {
  // 'photographer' | 'videographer' | 'favorites' (send flow, combined roles) |
  // 'manage-favorites' (checklist to mark who's a favorite) | null (role picker)
  const [selectedRole, setSelectedRole] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  // Local optimistic overrides for isFavorite so the manage-favorites checklist and the
  // "צלמים מועדפים" shortlist react instantly to a toggle, without waiting for the parent
  // (Leads.jsx) to refetch staffMembers over the network (onStaffMembersChanged is fired
  // in the background so the parent stays in sync for next time too).
  const [favoriteOverrides, setFavoriteOverrides] = useState(new Map());

  useEffect(() => {
    if (!open) {
      // Reset on close so re-opening always starts fresh from the role picker.
      setSelectedRole(null);
      setSelectedIds(new Set());
      setMessage("");
      setIsSending(false);
      setFavoriteOverrides(new Map());
    }
  }, [open]);

  const staffMembersWithFavorites = useMemo(
    () => (staffMembers || []).map((s) => (favoriteOverrides.has(s.id) ? { ...s, isFavorite: favoriteOverrides.get(s.id) } : s)),
    [staffMembers, favoriteOverrides]
  );

  const manageStaff = useMemo(
    () => staffMembersWithFavorites.filter((s) => AVAILABILITY_ROLES.some((r) => r.value === s.role)),
    [staffMembersWithFavorites]
  );

  const roleStaff = useMemo(() => {
    if (!selectedRole || selectedRole === "manage-favorites") return [];
    if (selectedRole === "favorites") {
      return staffMembersWithFavorites.filter((s) => s.isFavorite && AVAILABILITY_ROLES.some((r) => r.value === s.role));
    }
    return staffMembersWithFavorites.filter((s) => s.role === selectedRole);
  }, [selectedRole, staffMembersWithFavorites]);

  const handlePickRole = async (roleValue) => {
    const roleLabel =
      roleValue === "favorites"
        ? "צלם/צלמת וידאו"
        : AVAILABILITY_ROLES.find((r) => r.value === roleValue)?.label || roleValue;
    setSelectedRole(roleValue);
    setSelectedIds(new Set());
    setMessage(buildDefaultMessage({ roleLabel, eventDate, venue, coupleNames })); // instant fallback while the saved template loads
    const msg = await buildMessage({ roleLabel, eventDate, venue, coupleNames });
    setMessage(msg);
  };

  const toggleFavorite = async (staffMember) => {
    const nextValue = !staffMember.isFavorite;
    setFavoriteOverrides((prev) => new Map(prev).set(staffMember.id, nextValue));
    try {
      await base44.entities.StaffMember.update(staffMember.id, { isFavorite: nextValue });
      onStaffMembersChanged?.();
    } catch {
      setFavoriteOverrides((prev) => new Map(prev).set(staffMember.id, !nextValue));
      toast.error("שגיאה בעדכון מועדפים");
    }
  };

  const toggleStaff = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const withPhone = roleStaff.filter((s) => s.phoneNumber);
    setSelectedIds((prev) => (prev.size === withPhone.length ? new Set() : new Set(withPhone.map((s) => s.id))));
  };

  const latestStatusFor = (staffId) => existingRequests?.find((r) => r.staffMemberId === staffId)?.status;

  // Mints a per-target bearer token, stores only its hash on a new
  // staff_availability_requests row (append-only -- re-asking a staff member creates a
  // fresh row rather than mutating any prior answer), then sends the WhatsApp message
  // with the raw token appended as a link. Token creation happens before the send so a
  // WhatsApp failure never leaves an unreachable row with no way to resend.
  const sendToTarget = async (staffMember) => {
    const rawToken = generateRawToken();
    const tokenHash = await hashToken(rawToken);
    await base44.entities.StaffAvailabilityRequest.create({
      leadId,
      eventId: eventId || null,
      staffMemberId: staffMember.id,
      staffNameSnapshot: staffMember.name,
      role: selectedRole === "favorites" ? staffMember.role : selectedRole,
      eventDateSnapshot: eventDate || null,
      venueSnapshot: venue || null,
      coupleNamesSnapshot: coupleNames || null,
      tokenHash,
    });
    const link = `${window.location.origin}/staff-availability/${rawToken}`;
    return base44.functions.invoke("sendWhatsAppMessage", { to: staffMember.phoneNumber, message: `${message}\n\n${link}` });
  };

  const handleSend = async () => {
    const targets = roleStaff.filter((s) => selectedIds.has(s.id) && s.phoneNumber);
    if (targets.length === 0) {
      toast.error("בחר/י לפחות איש צוות אחד עם מספר טלפון");
      return;
    }
    if (!message.trim()) {
      toast.error("יש להזין תוכן הודעה");
      return;
    }
    setIsSending(true);
    try {
      const results = await Promise.allSettled(targets.map((s) => sendToTarget(s)));
      const failed = results.filter((r) => r.status === "rejected" || r.value?.data?.error);
      if (failed.length === 0) {
        toast.success(`נשלחה בדיקת זמינות ל-${targets.length} אנשי צוות`);
        onSent?.();
      } else if (failed.length < targets.length) {
        toast.error(`נשלח ל-${targets.length - failed.length} מתוך ${targets.length}, חלק נכשלו`);
        onSent?.();
      } else {
        toast.error("השליחה נכשלה");
      }
    } catch (error) {
      toast.error("שגיאה בשליחה");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent dir="rtl" className="bg-gray-900 border-gray-700 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-right flex items-center gap-2">
            {selectedRole && (
              <button
                type="button"
                onClick={() => setSelectedRole(null)}
                className="text-gray-400 hover:text-white"
                title="חזרה"
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
            {selectedRole === "manage-favorites" ? "בחירת מועדפים" : "זמינות צלם"}
          </DialogTitle>
        </DialogHeader>

        {!selectedRole ? (
          <div className="space-y-2 py-2">
            <p className="text-sm text-gray-400 mb-3">בחר/י תפקיד כדי לראות את אנשי הצוות</p>
            {AVAILABILITY_ROLES.map((r) => {
              const Icon = ROLE_ICON[r.value];
              return (
                <Button
                  key={r.value}
                  onClick={() => handlePickRole(r.value)}
                  className="w-full flex items-center justify-center gap-2 bg-pink-600 hover:bg-pink-700 text-white font-semibold py-5 rounded-xl"
                >
                  {Icon && <Icon className="w-4 h-4" />}
                  {r.label}
                </Button>
              );
            })}
            <div className="pt-2 mt-2 border-t border-gray-700/50 space-y-2">
              <Button
                onClick={() => handlePickRole("favorites")}
                className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-gray-900 font-semibold py-5 rounded-xl"
              >
                <Star className="w-4 h-4 fill-gray-900" />
                צלמים מועדפים
              </Button>
              <Button
                onClick={() => setSelectedRole("manage-favorites")}
                variant="outline"
                className="w-full flex items-center justify-center gap-2 border-amber-500/40 bg-transparent text-amber-400 hover:bg-amber-500/10 font-semibold py-5 rounded-xl"
              >
                <ListChecks className="w-4 h-4" />
                בחירת מועדפים
              </Button>
            </div>
          </div>
        ) : selectedRole === "manage-favorites" ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-400">
              סמנו אילו צלמים/וידאוגרפים הם מועדפים (אלו שבשימוש קבוע יותר) -- הבחירה נשמרת אוטומטית ומשמשת את כפתור
              &quot;צלמים מועדפים&quot;.
            </p>
            <div className="max-h-64 overflow-y-auto space-y-1.5 border border-gray-700/50 rounded-xl p-2">
              {manageStaff.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">אין אנשי צוות מוגדרים</p>
              ) : (
                manageStaff.map((s) => {
                  const Icon = ROLE_ICON[s.role];
                  return (
                    <label
                      key={s.id}
                      className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-gray-800 cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!s.isFavorite}
                          onChange={() => toggleFavorite(s)}
                          className="w-4 h-4 accent-amber-500"
                        />
                        {Icon && <Icon className="w-3.5 h-3.5 text-gray-400" />}
                        <span className="text-sm text-white">{s.name}</span>
                      </div>
                      {s.isFavorite && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />}
                    </label>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            {roleStaff.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">
                {selectedRole === "favorites"
                  ? 'אין עדיין צלמים מסומנים כמועדפים -- לחצו על "בחירת מועדפים" כדי לסמן'
                  : "אין אנשי צוות עם תפקיד זה"}
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">
                    {selectedIds.size} מתוך {roleStaff.filter((s) => s.phoneNumber).length} נבחרו
                  </span>
                  <button type="button" onClick={toggleAll} className="text-sm text-pink-400 hover:text-pink-300">
                    {selectedIds.size === roleStaff.filter((s) => s.phoneNumber).length ? "נקה הכל" : "בחר הכל"}
                  </button>
                </div>
                <div className="max-h-52 overflow-y-auto space-y-1.5 border border-gray-700/50 rounded-xl p-2">
                  {roleStaff.map((s) => (
                    <label
                      key={s.id}
                      className={`flex items-center justify-between gap-2 p-2 rounded-lg ${
                        s.phoneNumber ? "hover:bg-gray-800 cursor-pointer" : "opacity-50 cursor-not-allowed"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          disabled={!s.phoneNumber}
                          checked={selectedIds.has(s.id)}
                          onChange={() => toggleStaff(s.id)}
                          className="w-4 h-4 accent-pink-600"
                        />
                        <span className="text-sm text-white">{s.name}</span>
                        {s.isFavorite && <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />}
                      </div>
                      {!s.phoneNumber ? (
                        <span className="text-xs text-gray-500">אין טלפון</span>
                      ) : (
                        latestStatusFor(s.id) && (
                          <span className={`text-xs ${STATUS_BADGE[latestStatusFor(s.id)]?.className || "text-gray-500"}`}>
                            {STATUS_BADGE[latestStatusFor(s.id)]?.label || latestStatusFor(s.id)}
                          </span>
                        )
                      )}
                    </label>
                  ))}
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">תוכן ההודעה שתישלח</label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={4}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-sm text-white resize-none"
                  />
                </div>
              </>
            )}
          </div>
        )}

        {selectedRole && roleStaff.length > 0 && (
          <DialogFooter>
            <Button
              onClick={handleSend}
              disabled={isSending || selectedIds.size === 0}
              className="w-full flex items-center justify-center gap-2 bg-pink-600 hover:bg-pink-700 disabled:bg-pink-800 text-white font-semibold py-3 rounded-xl"
            >
              {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              שלח בדיקת זמינות ל-{selectedIds.size}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
