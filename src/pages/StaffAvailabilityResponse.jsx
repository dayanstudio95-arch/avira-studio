import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

// Public, no-login staff availability-response page -- /staff-availability/:token.
// Opened from the WhatsApp link sent by StaffAvailabilityModal.jsx. Two big tap
// targets, no form, no login. Idempotent: re-opening the same link after answering
// (or after someone else answers on the studio's behalf) shows the recorded answer
// instead of the buttons again -- respond-staff-availability-public enforces this
// server-side too, not just in this UI.

function formatDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString("he-IL", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return value;
  }
}

const STATUS_LABEL = {
  available: "פנוי/ה",
  declined: "לא פנוי/ה",
};

export default function StaffAvailabilityResponse() {
  const { token } = useParams();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState(null);
  const [isResponding, setIsResponding] = useState(false);

  useEffect(() => {
    (async () => {
      if (!token) {
        setError("קישור לא תקין");
        setIsLoading(false);
        return;
      }
      try {
        const res = await base44.functions.invoke("respondStaffAvailabilityPublic", { token, action: "validate" });
        setInfo(res.data);
      } catch (e) {
        setError(e?.message || "אירעה שגיאה בטעינת הקישור");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [token]);

  const handleRespond = async (response) => {
    setIsResponding(true);
    try {
      const res = await base44.functions.invoke("respondStaffAvailabilityPublic", { token, action: "respond", response });
      setInfo(res.data);
    } catch (e) {
      setError(e?.message || "שגיאה בשליחת התגובה");
    } finally {
      setIsResponding(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center" dir="rtl">
        <Loader2 className="w-10 h-10 text-yellow-400 animate-spin" />
      </div>
    );
  }

  if (!info) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6" dir="rtl">
        <div className="max-w-md w-full bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center space-y-3">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto" />
          <h1 className="text-lg font-bold text-white">לא ניתן להציג את הקישור</h1>
          <p className="text-gray-400 text-sm">{error || "קישור לא תקין"}</p>
        </div>
      </div>
    );
  }

  const alreadyAnswered = info.status !== "pending";

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6" dir="rtl">
      <div className="max-w-md w-full bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center space-y-5">
        <h1 className="text-xl font-bold text-white">בדיקת זמינות — {info.roleLabel}</h1>
        <div className="text-gray-400 text-sm space-y-1">
          {info.coupleNames && <p>{info.coupleNames}</p>}
          {info.eventDate && <p>{formatDate(info.eventDate)}</p>}
          {info.venue && <p>{info.venue}</p>}
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {alreadyAnswered ? (
          <div className="flex flex-col items-center gap-2 py-4">
            {info.status === "available" ? (
              <CheckCircle2 className="w-10 h-10 text-green-400" />
            ) : (
              <XCircle className="w-10 h-10 text-red-400" />
            )}
            <p className="text-white font-semibold">
              רשמנו שאת/ה {STATUS_LABEL[info.status] || info.status}
            </p>
            <p className="text-gray-500 text-xs">תודה על התגובה!</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-300">תוכל/י לאשר האם את/ה פנוי/ה?</p>
            <Button
              type="button"
              disabled={isResponding}
              onClick={() => handleRespond("available")}
              className="w-full bg-green-500 hover:bg-green-600 text-white h-14 text-base font-bold flex items-center justify-center gap-2"
            >
              {isResponding ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
              פנוי/ה
            </Button>
            <Button
              type="button"
              disabled={isResponding}
              onClick={() => handleRespond("declined")}
              className="w-full bg-gray-700 hover:bg-gray-600 text-white h-14 text-base font-bold flex items-center justify-center gap-2"
            >
              {isResponding ? <Loader2 className="w-5 h-5 animate-spin" /> : <XCircle className="w-5 h-5" />}
              לא פנוי/ה
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
