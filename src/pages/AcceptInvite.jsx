import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Camera } from "lucide-react";
import { toast } from "sonner";

// Public route landed on after clicking the invite email link sent by the
// invite-user Edge Function (Settings → משתמשים → הזמן משתמש). The Supabase
// client auto-detects the session from the URL (detectSessionInUrl, on by
// default) — this page just waits for that session to appear, then lets the
// new teammate pick a password. Their `profiles` row (tenant_id + role) was
// already inserted server-side when they were invited, so the moment
// updateUser succeeds they're fully provisioned and can log in normally.
export default function AcceptInvite() {
  const navigate = useNavigate();
  const [sessionReady, setSessionReady] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted && session) setSessionReady(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted && session) setSessionReady(true);
    });

    const timeout = setTimeout(() => {
      if (mounted) {
        setSessionReady((ready) => {
          if (!ready) setLinkInvalid(true);
          return ready;
        });
      }
    }, 5000);

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("הסיסמה חייבת להכיל לפחות 6 תווים");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("הסיסמאות אינן תואמות");
      return;
    }

    setIsSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setIsSubmitting(false);

    if (error) {
      toast.error("שמירת הסיסמה נכשלה", { description: error.message });
      return;
    }

    toast.success("החשבון הופעל בהצלחה!");
    navigate("/", { replace: true });
  };

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <Card className="w-full max-w-sm bg-gray-900 border-gray-800 text-white">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-yellow-500/10 flex items-center justify-center">
            <Camera className="w-6 h-6 text-yellow-500" />
          </div>
          <CardTitle className="text-xl">ברוכים הבאים לאווירה סטודיו</CardTitle>
        </CardHeader>
        <CardContent>
          {linkInvalid ? (
            <p className="text-red-400 text-sm text-center">
              קישור ההזמנה לא תקין או פג תוקף. בקשו מבעל הסטודיו לשלוח הזמנה חדשה.
            </p>
          ) : !sessionReady ? (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 border-2 border-gray-600 border-t-yellow-400 rounded-full animate-spin" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-gray-400 text-sm text-center">בחרו סיסמה כדי להשלים את ההרשמה</p>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-gray-300">סיסמה חדשה</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-gray-800 border-gray-700 text-white"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-gray-300">אימות סיסמה</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="bg-gray-800 border-gray-700 text-white"
                />
              </div>
              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? "שומר..." : "הפעל חשבון"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
