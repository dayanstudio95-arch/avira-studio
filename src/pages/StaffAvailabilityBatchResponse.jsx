import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Loader2, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

// Public, no-login page for an availability check covering several events (2026-10-09) —
// /staff-availability/b/:token, sent from the chat app's staff panel. Each event gets its own
// פנוי / לא פנוי; an answer is final (respond-staff-availability-public enforces it too).

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
function formatDate(value) {
  if (!value) return "";
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return `יום ${WEEKDAYS[d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

export default function StaffAvailabilityBatchResponse() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await base44.functions.invoke("respondStaffAvailabilityPublic", { batchToken: token, action: "validateBatch" });
        if (res.data?.error) throw new Error(res.data.error);
        setInfo(res.data);
      } catch (e) {
        setError(e?.message || "אירעה שגיאה בטעינת הקישור");
      }
      setLoading(false);
    })();
  }, [token]);

  const respond = async (requestId, response) => {
    setBusy(requestId);
    try {
      const res = await base44.functions.invoke("respondStaffAvailabilityPublic", { batchToken: token, action: "respondBatch", requestId, response });
      if (res.data?.error) throw new Error(res.data.error);
      setInfo(res.data);
    } catch (e) {
      setError(e?.message || "שגיאה בשליחת התגובה");
    }
    setBusy(null);
  };

  if (loading) {
    return (
      <div className="e-page flex min-h-screen items-center justify-center bg-gray-950" dir="rtl">
        <Loader2 className="h-10 w-10 animate-spin text-yellow-400" />
      </div>
    );
  }
  if (!info) {
    return (
      <div className="e-page flex min-h-screen items-center justify-center bg-gray-950 p-6" dir="rtl">
        <div className="w-full max-w-md space-y-3 rounded-2xl border border-gray-800 bg-gray-900 p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-red-400" />
          <h1 className="text-lg font-bold text-white">לא ניתן להציג את הקישור</h1>
          <p className="text-sm text-gray-400">{error || "קישור לא תקין"}</p>
        </div>
      </div>
    );
  }

  const left = info.items.filter((i) => i.status === "pending").length;
  return (
    <div className="e-page min-h-screen bg-gray-950 p-4" dir="rtl">
      <div className="mx-auto w-full max-w-md space-y-4 py-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-white">בדיקת זמינות{info.roleLabel ? ` — ${info.roleLabel}` : ""}</h1>
          <p className="mt-1 text-sm text-gray-400">
            {info.staffName ? `${info.staffName}, ` : ""}{left ? `סמן/י לכל אירוע אם את/ה פנוי/ה (${left} נשארו)` : "תודה! כל התשובות נרשמו 🙏"}
          </p>
        </div>
        {error && <p className="text-center text-sm text-red-400">{error}</p>}
        {info.items.map((it) => (
          <div key={it.id} className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
            <div className="text-base font-semibold text-white">{formatDate(it.eventDate)}</div>
            <div className="text-sm text-gray-400">{[it.venue, it.coupleNames].filter(Boolean).join(" · ")}</div>
            {it.status === "pending" ? (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy === it.id}
                  onClick={() => respond(it.id, "available")}
                  className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-green-500 font-bold text-white hover:bg-green-600 disabled:opacity-50"
                >
                  {busy === it.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />} פנוי/ה
                </button>
                <button
                  type="button"
                  disabled={busy === it.id}
                  onClick={() => respond(it.id, "declined")}
                  className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-gray-700 font-bold text-white hover:bg-gray-600 disabled:opacity-50"
                >
                  <XCircle className="h-5 w-5" /> לא פנוי/ה
                </button>
              </div>
            ) : (
              <div className={`mt-3 flex items-center gap-2 text-sm font-semibold ${it.status === "available" ? "text-green-400" : "text-red-400"}`}>
                {it.status === "available" ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                רשמנו: {it.status === "available" ? "פנוי/ה" : "לא פנוי/ה"}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
