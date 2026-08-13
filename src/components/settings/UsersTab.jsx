import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/SupabaseAuthContext";
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
import { Users, Plus, Mail } from "lucide-react";
import { toast } from "sonner";
import CreateStudioDialog from "./CreateStudioDialog";

const ROLE_LABELS = {
  owner: "בעלים",
  admin: "מנהל",
  studio_manager: "מנהל סטודיו",
  photographer: "צלם",
  editor: "עורך",
  album_manager: "מנהל אלבומים",
};

const ROLE_OPTIONS = Object.entries(ROLE_LABELS);

export default function UsersTab() {
  const { user } = useAuth();
  const canManage = ["owner", "admin"].includes(user?.role);

  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);
  const [inviteForm, setInviteForm] = useState({ email: "", fullName: "", role: "photographer" });

  useEffect(() => {
    loadUsers();
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
    setIsInviting(true);
    try {
      await base44.functions.invoke("inviteUser", {
        email: inviteForm.email,
        fullName: inviteForm.fullName,
        role: inviteForm.role,
        origin: window.location.origin,
      });
      toast.success("ההזמנה נשלחה בהצלחה");
      setIsInviteOpen(false);
      setInviteForm({ email: "", fullName: "", role: "photographer" });
      loadUsers();
    } catch (error) {
      toast.error("שליחת ההזמנה נכשלה", { description: error.message });
    }
    setIsInviting(false);
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
            <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-yellow-400 hover:bg-yellow-500 text-gray-900">
                  <Plus className="w-4 h-4 mr-2" />
                  הזמן משתמש
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-gray-900 border-gray-800 text-white">
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
                </div>
                <DialogFooter>
                  <Button
                    onClick={handleInvite}
                    disabled={isInviting}
                    className="bg-yellow-400 hover:bg-yellow-500 text-gray-900"
                  >
                    <Mail className="w-4 h-4 mr-2" />
                    {isInviting ? "שולח..." : "שלח הזמנה"}
                  </Button>
                </DialogFooter>
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
                  </div>
                  <p className="text-sm text-gray-400 truncate">{u.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  {canManage ? (
                    <>
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

    <CreateStudioDialog canManage={user?.role === "owner"} />
    </div>
  );
}
