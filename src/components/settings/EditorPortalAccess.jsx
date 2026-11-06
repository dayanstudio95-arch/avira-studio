import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { dayMonth } from "@/lib/videoEditing";

// "כניסה לדף העורך" in an editor's card (2026-11-06, the owner's request: "אני יגדיר לו את הסיסמה"). He signs in at
// /editor with his phone above and this password; a new password signs out every device he was signed in on.
// The password is hashed by the editor-portal Edge Function and never read back.
export default function EditorPortalAccess({ staff }) {
  const [status, setStatus] = useState(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const link = `${window.location.origin}/editor`;

  const run = async (action, extra = {}) => {
    const res = await base44.functions.invoke("editorPortal", { action, staffMemberId: staff.id, ...extra });
    if (res?.data?.error) throw new Error(res.data.error);
    setStatus(res.data);
    return res.data;
  };

  useEffect(() => {
    if (staff?.id) run("admin_status").catch(() => setStatus({ hasAccess: false }));
  }, [staff?.id]);

  if (!staff?.id) return null;

  const setPw = async () => {
    setBusy(true);
    try {
      await run("admin_set_password", { password });
      setPassword("");
      toast.success(`הסיסמה של ${staff.name} נשמרה — הוא נכנס עם הטלפון שלו והסיסמה הזו`);
    } catch (e) {
      toast.error(e?.message || "השמירה נכשלה");
    }
    setBusy(false);
  };

  const remove = async () => {
    if (!(await confirmDialog({ title: `לבטל את הכניסה של ${staff.name}?`, message: "הוא יתנתק מכל המכשירים ולא יוכל להיכנס עד שתקבע סיסמה חדשה.", confirmText: "ביטול הכניסה", danger: true }))) return;
    setBusy(true);
    try {
      await run("admin_remove");
      toast.success("הכניסה בוטלה");
    } catch (e) {
      toast.error(e?.message || "הפעולה נכשלה");
    }
    setBusy(false);
  };

  return (
    <div className="space-y-2 border-t border-gray-800 pt-4" data-testid="editor-portal-access">
      <Label className="flex items-center gap-1.5">
        <KeyRound className="w-4 h-4 text-amber-400" />
        כניסה לדף העורך
      </Label>
      <p className="text-xs text-gray-500">
        {staff.name} נכנס ל-
        <a href={link} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline" dir="ltr">{link.replace(/^https?:\/\//, "")}</a>
        <button type="button" onClick={() => navigator.clipboard?.writeText(link).then(() => toast.success("הקישור הועתק"), () => {})} className="mx-1 inline-flex rounded p-0.5 align-middle hover:bg-white/10" aria-label="העתקת הקישור">
          <Copy className="w-3 h-3" />
        </button>
        עם מספר הטלפון שבכרטיס וסיסמה שאתה קובע. הוא רואה רק את האירועים שלו, ומדביק את הלינק של הסרט.
      </p>
      {status === null ? (
        <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
      ) : (
        <p className={`text-xs ${status.hasAccess ? "text-green-300" : "text-gray-400"}`} data-testid="editor-portal-status">
          {status.hasAccess
            ? `יש לו כניסה${status.lastLoginAt ? ` · נכנס לאחרונה ${dayMonth(status.lastLoginAt)}` : " · עוד לא נכנס"}${status.devices ? ` · מחובר ב-${status.devices} מכשירים` : ""}`
            : "עוד לא נקבעה סיסמה"}
          {status.lockedUntil && new Date(status.lockedUntil) > new Date() ? " · נחסם זמנית אחרי ניסיונות שגויים" : ""}
        </p>
      )}
      <div className="flex gap-2">
        <Input
          type="text"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={status?.hasAccess ? "סיסמה חדשה" : "סיסמה (6 תווים לפחות)"}
          dir="ltr"
          className="bg-gray-800 border-gray-700 text-white"
          data-testid="editor-portal-password"
        />
        <Button type="button" onClick={setPw} disabled={busy || password.length < 6} className="shrink-0 bg-amber-400 text-gray-900 hover:bg-amber-300" data-testid="editor-portal-set">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : status?.hasAccess ? "החלפת סיסמה" : "קביעת סיסמה"}
        </Button>
      </div>
      {status?.hasAccess && (
        <button type="button" onClick={remove} disabled={busy} className="text-xs text-rose-300 hover:underline">
          ביטול הכניסה וניתוק מכל המכשירים
        </button>
      )}
    </div>
  );
}
