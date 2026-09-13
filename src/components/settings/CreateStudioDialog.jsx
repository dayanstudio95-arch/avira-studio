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
import { Building2, MessageCircle, Copy } from "lucide-react";
import { toast } from "sonner";

// New (2026-08-13), per explicit request: "אני רוצה לתת לחבר שיש לו גם סטודיו כמו שלי
// להשתמש במערכת" (want to give a friend who also runs a studio access to the system,
// with fully separate data). Unlike "הזמן משתמש" in UsersTab.jsx (which adds a teammate
// to YOUR OWN studio's data), this spins up a brand new, fully isolated tenant — the
// invited person becomes the owner of their own separate studio, with their own leads/
// events/packages/staff, invisible to you and vice versa. Only visible to the account
// owner (role === 'owner'), enforced both here and server-side in create-tenant/index.ts.
//
// 2026-09-13: the login link now goes out over WhatsApp, not email — the email path died
// three times (see create-tenant/index.ts and DEPLOYMENT.md §2.1). If the WhatsApp send
// fails the studio still exists, so the dialog stays open and shows the link with a copy
// button instead of pretending nothing happened. The email is still required: it is the
// username the new owner logs in with.
export default function CreateStudioDialog({ canManage }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({ studioName: "", email: "", fullName: "", phone: "" });
  const [fallbackLink, setFallbackLink] = useState(null);

  if (!canManage) return null;

  const reset = () => {
    setForm({ studioName: "", email: "", fullName: "", phone: "" });
    setFallbackLink(null);
  };

  const handleCreate = async () => {
    if (!form.studioName.trim()) {
      toast.error("יש להזין שם סטודיו");
      return;
    }
    if (!form.email) {
      toast.error("יש להזין כתובת אימייל");
      return;
    }
    if (!form.phone.trim()) {
      toast.error("יש להזין מספר וואטסאפ");
      return;
    }
    setIsCreating(true);
    setFallbackLink(null);
    try {
      const res = await base44.functions.invoke("createTenant", {
        studioName: form.studioName,
        email: form.email,
        fullName: form.fullName,
        phone: form.phone,
      });
      const data = res?.data || {};
      if (data.success) {
        toast.success(
          data.recoveredExistingUser
            ? "הסטודיו כבר היה קיים — נשלח קישור חדש בוואטסאפ"
            : "הסטודיו נוצר והקישור נשלח בוואטסאפ"
        );
        setIsOpen(false);
        reset();
      } else if (data.actionLink) {
        // Studio + account exist; only the WhatsApp leg failed. Keep the dialog open so
        // the owner can send the link themselves.
        setFallbackLink(data.actionLink);
        toast.error("הסטודיו נוצר, אבל שליחת הוואטסאפ נכשלה", { description: data.error });
      } else {
        toast.error("יצירת הסטודיו נכשלה", { description: data.error });
      }
    } catch (error) {
      toast.error("יצירת הסטודיו נכשלה", { description: error.message });
    }
    setIsCreating(false);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(fallbackLink);
      toast.success("הקישור הועתק — אפשר לשלוח אותו בכל דרך");
    } catch {
      toast.error("ההעתקה נכשלה — סמן את הקישור והעתק ידנית");
    }
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
          <Dialog
            open={isOpen}
            onOpenChange={(open) => {
              setIsOpen(open);
              if (!open) reset();
            }}
          >
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
                  <Label>וואטסאפ הבעלים</Label>
                  <Input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="bg-gray-800 border-gray-700 text-white"
                    placeholder="050-1234567"
                    dir="ltr"
                  />
                </div>
                <div className="space-y-2">
                  <Label>אימייל הבעלים (שם המשתמש להתחברות)</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="bg-gray-800 border-gray-700 text-white"
                    placeholder="example@email.com"
                    dir="ltr"
                  />
                </div>
                <p className="text-xs text-gray-500">
                  קישור להגדרת סיסמה יישלח לוואטסאפ שלו מהמספר של הסטודיו שלך. לאחר מכן יתחבר
                  עם האימייל ויראה רק את הנתונים של הסטודיו החדש שלו.
                </p>
                {fallbackLink && (
                  <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-3 space-y-2">
                    <p className="text-xs text-amber-300">
                      הסטודיו נוצר, אבל הוואטסאפ לא יצא. שלח לו את הקישור הזה בעצמך:
                    </p>
                    <div className="flex items-center gap-2">
                      <Input
                        readOnly
                        value={fallbackLink}
                        className="bg-gray-800 border-gray-700 text-white text-xs"
                        dir="ltr"
                        onFocus={(e) => e.target.select()}
                      />
                      <Button size="sm" variant="outline" onClick={copyLink} className="border-gray-600 shrink-0">
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button
                  onClick={handleCreate}
                  disabled={isCreating}
                  className="bg-yellow-400 hover:bg-yellow-500 text-gray-900"
                >
                  <MessageCircle className="w-4 h-4 mr-2" />
                  {isCreating ? "יוצר..." : "צור סטודיו ושלח בוואטסאפ"}
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
          אם הקישור שנשלח פג או אבד — פשוט מלאו שוב את אותם פרטים; יישלח קישור חדש לאותו סטודיו.
        </p>
      </CardContent>
    </Card>
  );
}
