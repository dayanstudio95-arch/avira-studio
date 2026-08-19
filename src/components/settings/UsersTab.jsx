import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { isAdmin, isOwner } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Users, Plus, Mail, MessageCircle, Copy, RefreshCw, Eye, EyeOff, Wand2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import CreateStudioDialog from "./CreateStudioDialog";

function generateRandomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const ROLE_LABELS = {
  owner: "בעלים",
  admin: "מנהל",
  studio_manager: "מנהל סטודיו",
  photographer: "צלם",
  editor: "עורך",
  album_manager: "מנהל אלבומים",
  lead_coordinator: "רכז לידים",
};

// Sentinel used by the staff-link <Select> below since Radix Select doesn't accept an
// empty-string item value — mapped back to `null` (unlink) before calling the API.
const NO_STAFF_LINK = "__none__";

const ROLE_OPTIONS = Object.entries(ROLE_LABELS);

export default function UsersTab() {
  const { user } = useAuth();
  // ADMIN_ROLES (owner/admin/studio_manager) — studio_manager was previously excluded
  // here, inconsistent with the admin-panel gate itself (src/App.jsx), per the
  // 2026-08-17 security audit's explicit product decision.
  const canManage = isAdmin(user);

  const [users, setUsers] = useState([]);
  const [staffMembers, setStaffMembers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);
  const [inviteForm, setInviteForm] = useState({ email: "", fullName: "", phone: "", role: "photographer" });
  const [useManualPassword, setUseManualPassword] = useState(false);
  const [manualPassword, setManualPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState(null); // { email, password, phone }
  const [isSendingCreds, setIsSendingCreds] = useState(false);
  const [credsPhoneInput, setCredsPhoneInput] = useState("");

  // Resend-invite (for teammates who never confirmed) / reset-access mini dialog.
  const [resendTarget, setResendTarget] = useState(null); // the user row, or null when closed
  const [resendPhone, setResendPhone] = useState("");
  const [isResending, setIsResending] = useState(false);

  useEffect(() => {
    loadUsers();
    // Powers the photographer↔staff_members link picker below — only admins can
    // manage links, so only fetch this list when the caller can actually use it.
    if (canManage) {
      base44.entities.StaffMember.list()
        .then((list) => setStaffMembers(list || []))
        .catch(() => {});
    }
  }, []);

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      const res = await base44.functions.invoke("listTenantUsers", {});
      setUsers(res.data?.users || []);
    } catch (error) {
      toast.error("שגיאה בטעינת רשימת המשתמשים", { description: error.message });
    }
    setIsLoading(false);
  };

  const handleInvite = async () => {
    if (!inviteForm.email) {
      toast.error("יש להזין כתובת אימייל");
      return;
    }
    if (useManualPassword && manualPassword.length < 6) {
      toast.error("הסיסמה חייבת להכיל לפחות 6 תווים");
      return;
    }
    setIsInviting(true);
    try {
      const res = await base44.functions.invoke("inviteUser", {
        email: inviteForm.email,
        fullName: inviteForm.fullName,
        phone: inviteForm.phone,
        role: inviteForm.role,
        ...(useManualPassword ? { password: manualPassword } : {}),
        origin: window.location.origin,
      });
      if (useManualPassword) {
        // Keep the dialog open so the admin can copy/send the credentials — nothing else
        // shows this password again after this point.
        setCreatedCredentials({ email: inviteForm.email, password: manualPassword, phone: inviteForm.phone });
        toast.success(
          res.data?.recoveredExistingUser
            ? "נמצא משתמש קיים עם אימייל זה — הסיסמה שלו עודכנה"
            : "המשתמש נוצר בהצלחה"
        );
      } else {
        toast.success("ההזמנה נשלחה בהצלחה");
        setIsInviteOpen(false);
      }
      setInviteForm({ email: "", fullName: "", phone: "", role: "photographer" });
      setUseManualPassword(false);
      setManualPassword("");
      loadUsers();
    } catch (error) {
      toast.error("שליחת ההזמנה נכשלה", { description: error.message });
    }
    setIsInviting(false);
  };

  const handleSendCredentialsWhatsApp = async (phoneOverride) => {
    const phone = phoneOverride || createdCredentials?.phone;
    if (!phone) {
      toast.error("יש להזין מספר טלפון כדי לשלוח בוואטסאפ");
      return;
    }
    setIsSendingCreds(true);
    try {
      const message = `שלום! נוצר לך משתמש במערכת 😊\nאימייל: ${createdCredentials.email}\nסיסמה: ${createdCredentials.password}\n\nהיכנסו למערכת עם הפרטים האלה.`;
      const res = await base44.functions.invoke("sendWhatsAppMessage", { to: phone, message });
      if (res.data?.error) throw new Error(res.data.error);
      if (phoneOverride) setCreatedCredentials((prev) => (prev ? { ...prev, phone: phoneOverride } : prev));
      toast.success("פרטי ההתחברות נשלחו בוואטסאפ");
    } catch (error) {
      toast.error("שליחת הוואטסאפ נכשלה", { description: error.message });
    }
    setIsSendingCreds(false);
  };

  const handleResendInvite = async (method) => {
    if (!resendTarget) return;
    if (method === "whatsapp" && !resendPhone) {
      toast.error("יש להזין מספר טלפון");
      return;
    }
    setIsResending(true);
    try {
      const res = await base44.functions.invoke("resendInvite", {
        userId: resendTarget.id,
        method,
        phone: method === "whatsapp" ? resendPhone : undefined,
      });
      if (res.data?.error) throw new Error(res.data.error);
      if (method === "link" && res.data?.actionLink) {
        await navigator.clipboard.writeText(res.data.actionLink);
        toast.success("הקישור הועתק ללוח");
      } else {
        toast.success("ההזמנה נשלחה שוב בוואטסאפ");
        setResendTarget(null);
      }
    } catch (error) {
      toast.error("הפעולה נכשלה", { description: error.message });
    }
    setIsResending(false);
  };

  const handleRoleChange = async (userId, role) => {
    setUpdatingId(userId);
    try {
      await base44.functions.invoke("updateTenantUser", { userId, role });
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
      toast.success("התפקיד עודכן");
    } catch (error) {
      toast.error("עדכון התפקיד נכשל", { description: error.message });
    }
    setUpdatingId(null);
  };

  const handleToggleActive = async (userId, isActive) => {
    setUpdatingId(userId);
    try {
      await base44.functions.invoke("updateTenantUser", { userId, isActive });
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, isActive } : u)));
      toast.success(isActive ? "המשתמש הופעל" : "המשתמש הושבת");
    } catch (error) {
      toast.error("העדכון נכשל", { description: error.message });
      loadUsers();
    }
    setUpdatingId(null);
  };

  const handleStaffLinkChange = async (userId, staffMemberId) => {
    const resolvedId = staffMemberId === NO_STAFF_LINK ? null : staffMemberId;
    setUpdatingId(userId);
    try {
      await base44.functions.invoke("updateTenantUser", { userId, staffMemberId: resolvedId });
      const staffRow = staffMembers.find((s) => s.id === resolvedId);
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, staffMemberId: resolvedId, staffMemberName: staffRow?.name ?? null } : u
        )
      );
      toast.success(resolvedId ? "החשבון קושר לאיש הצוות" : "הקישור הוסר");
    } catch (error) {
      toast.error("עדכון הקישור נכשל", { description: error.message });
    }
    setUpdatingId(null);
  };

  const handleDeleteUser = async (u) => {
    const confirmed = window.confirm(
      `למחוק לצמיתות את המשתמש "${u.fullName || u.email || "ללא שם"}"? הפעולה בלתי הפיכה — החשבון וההרשאות שלו יימחקו, וכל הקישורים אליו (איש צוות מקושר וכו') יתנתקו.`
    );
    if (!confirmed) return;
    setUpdatingId(u.id);
    try {
      await base44.functions.invoke("deleteTenantUser", { userId: u.id });
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
      toast.success("המשתמש נמחק");
    } catch (error) {
      toast.error("מחיקת המשתמש נכשלה", { description: error.message });
    }
    setUpdatingId(null);
  };

  return (
    <div className="space-y-6">
    <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
      <CardHeader className="border-b border-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-yellow-400" />
              משתמשי המערכת
            </CardTitle>
            <p className="text-gray-400 text-sm mt-1">ניהול המשתמשים שיש להם גישה למערכת</p>
          </div>
          {canManage && (
            <Dialog
              open={isInviteOpen}
              onOpenChange={(open) => {
                setIsInviteOpen(open);
                if (!open) {
                  // Reset everything when the admin closes the dialog, whether via the
                  // explicit success path or just clicking away — the password (if any)
                  // was already shown once, no reason to keep it lingering in state.
                  setCreatedCredentials(null);
                  setUseManualPassword(false);
                  setManualPassword("");
                  setShowPassword(false);
                  setInviteForm({ email: "", fullName: "", phone: "", role: "photographer" });
                }
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm" className="bg-yellow-400 hover:bg-yellow-500 text-gray-900">
                  <Plus className="w-4 h-4 mr-2" />
                  הזמן משתמש
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-gray-900 border-gray-800 text-white">
                {createdCredentials ? (
                  <>
                    <DialogHeader>
                      <DialogTitle>המשתמש נוצר בהצלחה</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <p className="text-sm text-gray-400">
                        שמרו את הפרטים האלה — הסיסמה לא תוצג שוב. שלחו אותם למשתמש בוואטסאפ או העתיקו ידנית.
                      </p>
                      <div className="space-y-2">
                        <Label>אימייל</Label>
                        <div className="flex items-center gap-2">
                          <Input readOnly value={createdCredentials.email} className="bg-gray-800 border-gray-700 text-white" />
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="border-gray-700"
                            onClick={() => {
                              navigator.clipboard.writeText(createdCredentials.email);
                              toast.success("האימייל הועתק");
                            }}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>סיסמה</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            readOnly
                            type={showPassword ? "text" : "password"}
                            value={createdCredentials.password}
                            className="bg-gray-800 border-gray-700 text-white"
                          />
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="border-gray-700"
                            onClick={() => setShowPassword((v) => !v)}
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="border-gray-700"
                            onClick={() => {
                              navigator.clipboard.writeText(createdCredentials.password);
                              toast.success("הסיסמה הועתקה");
                            }}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      {!createdCredentials.phone && (
                        <div className="space-y-2">
                          <Label>טלפון לשליחה בוואטסאפ (אופציונלי)</Label>
                          <Input
                            value={credsPhoneInput}
                            onChange={(e) => setCredsPhoneInput(e.target.value)}
                            className="bg-gray-800 border-gray-700 text-white"
                            placeholder="05XXXXXXXX"
                          />
                        </div>
                      )}
                    </div>
                    <DialogFooter>
                      <Button
                        onClick={() => handleSendCredentialsWhatsApp(credsPhoneInput || undefined)}
                        disabled={isSendingCreds || (!createdCredentials.phone && !credsPhoneInput)}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        <MessageCircle className="w-4 h-4 mr-2" />
                        {isSendingCreds ? "שולח..." : "שלח בוואטסאפ"}
                      </Button>
                      <Button
                        variant="outline"
                        className="border-gray-700"
                        onClick={() => setIsInviteOpen(false)}
                      >
                        סגור
                      </Button>
                    </DialogFooter>
                  </>
                ) : (
                  <>
                    <DialogHeader>
                      <DialogTitle>הזמנת משתמש חדש</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>שם מלא</Label>
                        <Input
                          value={inviteForm.fullName}
                          onChange={(e) => setInviteForm({ ...inviteForm, fullName: e.target.value })}
                          className="bg-gray-800 border-gray-700 text-white"
                          placeholder="שם המשתמש"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>אימייל</Label>
                        <Input
                          type="email"
                          value={inviteForm.email}
                          onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                          className="bg-gray-800 border-gray-700 text-white"
                          placeholder="example@email.com"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>טלפון (לשליחת פרטי התחברות בוואטסאפ)</Label>
                        <Input
                          value={inviteForm.phone}
                          onChange={(e) => setInviteForm({ ...inviteForm, phone: e.target.value })}
                          className="bg-gray-800 border-gray-700 text-white"
                          placeholder="05XXXXXXXX"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>תפקיד</Label>
                        <Select
                          value={inviteForm.role}
                          onValueChange={(val) => setInviteForm({ ...inviteForm, role: val })}
                        >
                          <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-gray-900 border-gray-700 text-white">
                            {ROLE_OPTIONS.map(([value, label]) => (
                              <SelectItem key={value} value={value}>{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex items-center justify-between border-t border-gray-800 pt-4">
                        <div>
                          <Label>קביעת סיסמה ידנית</Label>
                          <p className="text-xs text-gray-500 mt-0.5">
                            במקום לשלוח מייל הזמנה — צור את המשתמש מיד עם סיסמה שתגדירו,
                            ותעבירו אותה בעצמכם.
                          </p>
                        </div>
                        <Switch checked={useManualPassword} onCheckedChange={setUseManualPassword} />
                      </div>

                      {useManualPassword && (
                        <div className="space-y-2">
                          <Label>סיסמה</Label>
                          <div className="flex items-center gap-2">
                            <Input
                              type={showPassword ? "text" : "password"}
                              value={manualPassword}
                              onChange={(e) => setManualPassword(e.target.value)}
                              className="bg-gray-800 border-gray-700 text-white"
                              placeholder="לפחות 6 תווים"
                            />
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="border-gray-700"
                              onClick={() => setShowPassword((v) => !v)}
                            >
                              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="border-gray-700"
                              title="צור סיסמה אקראית"
                              onClick={() => {
                                setManualPassword(generateRandomPassword());
                                setShowPassword(true);
                              }}
                            >
                              <Wand2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                    <DialogFooter>
                      <Button
                        onClick={handleInvite}
                        disabled={isInviting}
                        className="bg-yellow-400 hover:bg-yellow-500 text-gray-900"
                      >
                        {useManualPassword ? <Plus className="w-4 h-4 mr-2" /> : <Mail className="w-4 h-4 mr-2" />}
                        {isInviting ? "שולח..." : useManualPassword ? "צור משתמש" : "שלח הזמנה"}
                      </Button>
                    </DialogFooter>
                  </>
                )}
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-6">
        {isLoading ? (
          <div className="space-y-3">
            {Array(3).fill(0).map((_, i) => (
              <div key={i} className="h-16 bg-gray-800 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : users.length === 0 ? (
          <p className="text-gray-400 text-center py-8">אין משתמשים במערכת</p>
        ) : (
          <div className="space-y-3">
            {users.map((u) => (
              <div key={u.id} className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 bg-gray-800/50 rounded-lg">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-white font-medium">{u.fullName || "ללא שם"}</p>
                    {u.isSelf && <Badge variant="outline" className="border-yellow-400 text-yellow-400 text-xs">אתה</Badge>}
                    <Badge className={u.isActive ? "bg-green-600" : "bg-gray-600"}>
                      {u.isActive ? "פעיל" : "מושבת"}
                    </Badge>
                    {u.isConfirmed === false && (
                      <Badge className="bg-orange-600 text-white">טרם התחבר/ה</Badge>
                    )}
                  </div>
                  <p className="text-sm text-gray-400 truncate">{u.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  {canManage && u.isConfirmed === false && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-orange-500 text-orange-400 hover:bg-orange-500/10"
                      onClick={() => {
                        setResendTarget(u);
                        setResendPhone(u.phone || "");
                      }}
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      שלח שוב
                    </Button>
                  )}
                  {canManage ? (
                    <>
                      {/* Photographer-only: which staff_members roster row this login is
                          linked to — powers /MyEvents' "which events am I crew on" match
                          (see supabase/functions/photographer-events/index.ts). */}
                      {u.role === "photographer" && (
                        <Select
                          value={u.staffMemberId || NO_STAFF_LINK}
                          onValueChange={(val) => handleStaffLinkChange(u.id, val)}
                          disabled={updatingId === u.id}
                        >
                          <SelectTrigger className="bg-gray-800 border-gray-700 text-white w-44">
                            <SelectValue placeholder="קישור לאיש צוות" />
                          </SelectTrigger>
                          <SelectContent className="bg-gray-900 border-gray-700 text-white">
                            <SelectItem value={NO_STAFF_LINK}>ללא קישור</SelectItem>
                            {staffMembers.map((s) => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <Select
                        value={u.role}
                        onValueChange={(val) => handleRoleChange(u.id, val)}
                        disabled={updatingId === u.id}
                      >
                        <SelectTrigger className="bg-gray-800 border-gray-700 text-white w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-gray-900 border-gray-700 text-white">
                          {ROLE_OPTIONS.map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Switch
                        checked={u.isActive}
                        disabled={u.isSelf || updatingId === u.id}
                        onCheckedChange={(checked) => handleToggleActive(u.id, checked)}
                      />
                      {!u.isSelf && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red-500 text-red-400 hover:bg-red-500/10"
                          disabled={updatingId === u.id}
                          onClick={() => handleDeleteUser(u)}
                          title="מחק משתמש"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </>
                  ) : (
                    <span className="text-sm text-gray-400">{ROLE_LABELS[u.role] || u.role}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>

    <Dialog open={!!resendTarget} onOpenChange={(open) => { if (!open) { setResendTarget(null); setResendPhone(""); } }}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white">
        <DialogHeader>
          <DialogTitle>שליחת הזמנה מחדש — {resendTarget?.fullName || resendTarget?.email}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <p className="text-sm text-gray-400">
            המשתמש עדיין לא התחבר למערכת (לא הגדיר סיסמה). אפשר לשלוח קישור חדש בוואטסאפ, או להעתיק את הקישור ולשלוח אותו בעצמכם בכל דרך אחרת.
          </p>
          <div className="space-y-2">
            <Label>טלפון</Label>
            <Input
              value={resendPhone}
              onChange={(e) => setResendPhone(e.target.value)}
              className="bg-gray-800 border-gray-700 text-white"
              placeholder="05XXXXXXXX"
            />
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            onClick={() => handleResendInvite("whatsapp")}
            disabled={isResending}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            <MessageCircle className="w-4 h-4 mr-2" />
            {isResending ? "שולח..." : "שלח בוואטסאפ"}
          </Button>
          <Button
            onClick={() => handleResendInvite("link")}
            disabled={isResending}
            variant="outline"
            className="border-gray-700"
          >
            <Copy className="w-4 h-4 mr-2" />
            העתק קישור
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <CreateStudioDialog canManage={isOwner(user)} />
    </div>
  );
}
