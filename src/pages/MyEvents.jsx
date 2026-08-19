// The ONE page the "photographer" role can reach (see src/App.jsx's restructured
// gate) — a strictly READ-ONLY view of only the events this photographer is
// personally assigned to as crew. Never shows pricing/payments/financial data: the
// backing edge function (supabase/functions/photographer-events/index.ts) strips
// financial sub-fields out of `team` server-side before this page ever sees them,
// and RLS (0029_scoped_roles.sql) additionally scopes this role's SELECT on `events`
// to only rows where it's actually assigned crew.
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Camera, MapPin, Clock, Users, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/lib/SupabaseAuthContext";

export default function MyEvents() {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  const [linked, setLinked] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const res = await base44.functions.invoke("photographerEvents", {});
        setEvents(res?.data?.events || []);
        setLinked(res?.data?.linked !== false);
      } catch (error) {
        console.error("Failed to load events:", error);
        toast.error("שגיאה בטעינת האירועים");
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const safeFormat = (dateStr, fmt) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : format(d, fmt);
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Camera className="w-6 h-6 text-yellow-400" />
          האירועים שלי
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          שלום {user?.full_name || ""} — כאן האירועים שאת/ה משובץ/ת אליהם כצוות.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      ) : !linked ? (
        <div className="text-center py-16 text-gray-400 bg-gray-900 border border-gray-800 rounded-xl">
          <p className="mb-2">החשבון שלך עדיין לא מקושר לרשומת איש צוות.</p>
          <p className="text-sm text-gray-500">פנה/י למנהל המערכת לקישור החשבון.</p>
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-16 text-gray-500">אין לך אירועים משובצים כרגע.</div>
      ) : (
        <div className="space-y-3">
          {events.map((ev) => (
            <div key={ev.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <p className="font-semibold text-white text-lg">{ev.coupleNames || "—"}</p>
                <p className="text-yellow-400 font-medium">
                  {safeFormat(ev.date, "dd/MM/yyyy") || "אין תאריך"}
                </p>
              </div>
              <div className="flex flex-wrap gap-4 text-sm text-gray-400 mb-3">
                {ev.venue && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-4 h-4" /> {ev.venue}
                  </span>
                )}
                {ev.checkinTime && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" /> קבלת פנים: {ev.checkinTime}
                  </span>
                )}
                {ev.chuppahTime && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" /> חופה: {ev.chuppahTime}
                  </span>
                )}
              </div>
              {ev.team?.length > 0 && (
                <div className="border-t border-gray-800 pt-3">
                  <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" /> צוות
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {ev.team.map((m, i) => (
                      <span
                        key={i}
                        className="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded-lg"
                      >
                        {m.role ? `${m.role}: ` : ""}
                        {m.staffMemberName || "—"}
                        {m.progressStatus ? ` (${m.progressStatus})` : ""}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
