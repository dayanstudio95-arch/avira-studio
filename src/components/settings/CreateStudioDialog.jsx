import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Building2, Mail } from "lucide-react";
import { toast } from "sonner";

// New (2026-08-13), per explicit request: "אני רוצה לתת לחבר שיש לו גם סטודיו כמו שלי
// להשתמש במערכת" (want to give a friend who also runs a studio access to the system,
// with fully separate data). Unlike "הזמן משתמש" in UsersTab.jsx (which adds a teammate
// to YOUR OWN studio's data), this spins up a brand new, fully isolated tenant — the
// invited person becomes the owner of their own separate studio, with their own leads/
// events/packages/staff, invisible to you and vice versa. Only visible to the account
// owner (role === 'owner'), enforced both here and server-side in create-tenant/index.ts.
export default function CreateStudioDialog({ canManage }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({ studioName: "", email: "", fullName: "" });

  if (!canManage) return null;

  const handleCreate = async () => {
    if (!form.studioName.trim()) {
      toast.error("יש להזין שם סטודיו");
      return;
    }
    if (!form.email) {
      toast.error("יש להזין כתובת אימייל");
      return;
    }
    setIsCreating(true);
    try {
      await base44.functions.invoke("createTenant", {
        studioName: form.studioName,
        email: form.email,
        fullName: form.fullName,
        origin: window.location.origin,
      });
      toast.success("הסטודיו נוצר וההזמנה נשלחה בהצלחה");
      setIsOpen(false);
      setForm({ studioName: "", email: "", fullName: "" });
    } catch (error) {
      toast.error("יצירת הסטודיו נכשלה", { description: error.message });
    }
    setIsCreating(false);
  };

  return (
    <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
      <CardHeader className="border-b border-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-white flex items-center gap-2">
              <Building2 className="w-5 h-5 text-yellow-400" />
              יצירת סטודיו נפרד
            </CardTitle>
            <p className="text-gray-400 text-sm mt-1">
              עבור עסק/חבר אחר — ייווצר חשבון עצמאי ומבודד לחלוטין, עם לידים, אירועים,
              חבילות וצוות משלו, בלי גישה לנתונים שלך ולהפך.
            </p>
          </div>
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-yellow-400 hover:bg-yellow-500 text-gray-900">
                <Building2 className="w-4 h-4 mr-2" />
                צור סטודיו חדש
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-gray-900 border-gray-800 text-white">
              <DialogHeader>
                <DialogTitle>יצירת סטודיו חדש ומבודד</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>שם הסטודיו</Label>
                  <Input
                    value={form.studioName}
                    onChange={(e) => setForm({ ...form, studioName: e.target.value })}
                    className="bg-gray-800 border-gray-700 text-white"
                    placeholder="למשל: סטודיו X"
                  />
                </div>
                <div className="space-y-2">
                  <Label>שם הבעלים</Label>
                  <Input
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    className="bg-gray-800 border-gray-700 text-white"
                    placeholder="שם מלא"
                  />
                </div>
                <div className="space-y-2">
                  <Label>אימייל הבעלים</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="bg-gray-800 border-gray-700 text-white"
                    placeholder="example@email.com"
                  />
                </div>
                <p className="text-xs text-gray-500">
                  תישלח לכתובת זו הזמנה להגדרת סיסמה. לאחר מכן יתחבר עם החשבון שלו ויראה רק
                  את הנתונים של הסטודיו החדש שלו.
                </p>
              </div>
              <DialogFooter>
                <Button
                  onClick={handleCreate}
                  disabled={isCreating}
                  className="bg-yellow-400 hover:bg-yellow-500 text-gray-900"
                >
                  <Mail className="w-4 h-4 mr-2" />
                  {isCreating ? "יוצר..." : "צור סטודיו ושלח הזמנה"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <p className="text-gray-500 text-xs">
          שימו לב: זו פעולה נפרדת מ"הזמן משתמש" למעלה — הזמנת משתמש רגילה מוסיפה איש צוות
          לנתונים שלכם, בעוד כפתור זה יוצר חשבון וסטודיו חדשים לגמרי, מבודדים מהנתונים שלכם.
        </p>
      </CardContent>
    </Card>
  );
}
