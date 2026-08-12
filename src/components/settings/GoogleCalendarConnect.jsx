import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { CheckCircle, Calendar, Loader2 } from "lucide-react";

export default function GoogleCalendarConnect() {
  const [status, setStatus] = useState("loading"); // loading | connected | disconnected
  const [connectedEmail, setConnectedEmail] = useState("");

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    try {
      const res = await base44.functions.invoke("checkGoogleCalendarConnection", {});
      if (res.data?.connected) {
        setConnectedEmail(res.data.email || "");
        setStatus("connected");
      } else {
        setStatus("disconnected");
      }
    } catch {
      setStatus("disconnected");
    }
  };

  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 text-gray-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        בודק חיבור...
      </div>
    );
  }

  if (status === "connected") {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-green-900/20 border border-green-700/40 rounded-lg w-fit">
        <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
        <span className="text-green-400 font-medium text-sm">
          מחובר ליומן: {connectedEmail}
        </span>
      </div>
    );
  }

  return (
    <div className="text-sm text-gray-400">
      החיבור מנוהל על ידי מנהל המערכת דרך פנל Base44.
      <div className="mt-2 flex items-center gap-2 text-yellow-400">
        <Calendar className="w-4 h-4" />
        <span>Google Calendar מחובר — לחץ &quot;בדוק חיבור&quot; לאימות</span>
        <Button
          size="sm"
          variant="outline"
          onClick={checkConnection}
          className="border-yellow-600 text-yellow-400 hover:bg-yellow-900/20 ml-2"
        >
          בדוק חיבור
        </Button>
      </div>
    </div>
  );
}