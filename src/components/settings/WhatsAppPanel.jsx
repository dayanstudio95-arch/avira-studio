import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QrCode, RefreshCw, Wifi, WifiOff, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function WhatsAppPanel({ gatewayUrl, instanceId, apiKey }) {
  const [status, setStatus] = useState(null); // null | { connected, phone }
  const [qrImage, setQrImage] = useState(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const intervalRef = useRef(null);

  const isConfigured = !!(gatewayUrl && instanceId && apiKey);

  const checkStatus = async () => {
    if (!isConfigured) return;
    setLoadingStatus(true);
    try {
      const res = await base44.functions.invoke("whatsappManager", { action: "check_status" });
      setStatus({
        connected: res.data?.connected || false,
        phone: res.data?.phone || null,
        error: res.data?.error || null
      });
    } catch (e) {
      setStatus({ connected: false, phone: null, error: e.message });
    }
    setLoadingStatus(false);
  };

  const fetchQr = async () => {
    if (!isConfigured) {
      toast.error("יש להגדיר Gateway URL ו-API Key תחילה");
      return;
    }
    setLoadingQr(true);
    setQrImage(null);
    try {
      const res = await base44.functions.invoke("whatsappManager", { action: "get_qr" });
      if (res.data?.qr) {
        setQrImage(res.data.qr);
      } else {
        toast.error("לא ניתן לאחזר QR. בדוק את הגדרות ה-Gateway.");
      }
    } catch (e) {
      toast.error("שגיאה בקבלת QR Code");
    }
    setLoadingQr(false);
  };

  const sendTest = async () => {
    if (!testPhone.trim()) {
      toast.error("יש להזין מספר טלפון");
      return;
    }
    setSendingTest(true);
    try {
      const res = await base44.functions.invoke("whatsappManager", {
        action: "send_test",
        testPhone: testPhone.trim(),
      });
      if (res.data?.success) {
        toast.success("הודעת ניסיון נשלחה בהצלחה! ✅");
      } else {
        toast.error(res.data?.error || "שגיאה בשליחה");
      }
    } catch (e) {
      toast.error("שגיאה בשליחת הודעה");
    }
    setSendingTest(false);
  };

  // Poll status every 30 seconds
  useEffect(() => {
    if (isConfigured) {
      checkStatus();
      intervalRef.current = setInterval(checkStatus, 30000);
    }
    return () => clearInterval(intervalRef.current);
  }, [isConfigured]);

  return (
    <div className="space-y-5">
      {/* Status Banner */}
      {isConfigured && (
        <div
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium ${
            status === null
              ? "bg-gray-800/50 border-gray-700 text-gray-400"
              : status.connected
              ? "bg-green-900/30 border-green-600/40 text-green-300"
              : "bg-red-900/30 border-red-600/40 text-red-300"
          }`}
        >
          {loadingStatus ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : status?.connected ? (
            <Wifi className="w-4 h-4" />
          ) : (
            <WifiOff className="w-4 h-4" />
          )}
          <span>
            {status === null
              ? "בודק סטטוס..."
              : status.connected
              ? `מחובר${status.phone ? ` למספר ${status.phone}` : ""} ✅`
              : "מנותק — נא לסרוק QR לחיבור מחדש 🔴"}
          </span>
          <button
            onClick={checkStatus}
            disabled={loadingStatus}
            className="mr-auto text-xs opacity-60 hover:opacity-100 underline"
          >
            רענן
          </button>
        </div>
      )}

      {!isConfigured && (
        <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-xl p-3 text-xs text-yellow-300">
          יש להגדיר API URL, Instance ID ו-API Token ולשמור בכפתור "שמור הגדרות אינטגרציות" לפני שניתן לנהל את החיבור.
        </div>
      )}

      {status?.error && (
        <div className="bg-red-900/20 border border-red-700/40 rounded-xl p-3 text-xs text-red-300 space-y-2">
          <div className="font-semibold">⚠️ שגיאה בחיבור</div>
          <div>{status.error}</div>
          {status.statusCode === 404 && (
            <div className="text-red-200">
              <strong>עזרה:</strong> זה בדרך כלל אומר שאחד השדות שגוי. אנא בדוק בדשבורד Green-API (console.green-api.com):
              <ul className="list-disc list-inside mt-1 ml-2">
                <li>API URL — רק הכתובת הבסיסית (apiUrl), למשל https://7107.api.green-api.com, בלי waInstance</li>
                <li>Instance ID — המספר בשדה idInstance בדיוק כפי שהוא</li>
                <li>API Token — הערך בשדה apiTokenInstance בדיוק כפי שהוא</li>
                <li>שהחשבון בגרין-אפיי רשום ופעיל, ושה-WhatsApp בחשבון זה מחובר</li>
              </ul>
            </div>
          )}
        </div>
      )}

      {/* QR Section */}
      <div className="border border-gray-700 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-white font-medium">
            <QrCode className="w-4 h-4 text-green-400" />
            חיבור דרך QR Code
          </div>
          <Button
            onClick={fetchQr}
            disabled={loadingQr || !isConfigured}
            size="sm"
            className="bg-green-600 hover:bg-green-700 text-white gap-1"
          >
            {loadingQr ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            {loadingQr ? "טוען..." : "רענן חיבור (QR Code)"}
          </Button>
        </div>

        {qrImage ? (
          <div className="flex flex-col items-center gap-2">
            <img
              src={qrImage.startsWith("data:") ? qrImage : `data:image/png;base64,${qrImage}`}
              alt="WhatsApp QR Code"
              className="w-52 h-52 rounded-xl border border-gray-700 bg-white p-2"
            />
            <p className="text-xs text-gray-400">סרוק עם WhatsApp → מכשירים מקושרים → קשר מכשיר</p>
          </div>
        ) : (
          <p className="text-xs text-gray-500 text-center py-4">
            לחץ "רענן חיבור" כדי להציג את ה-QR Code
          </p>
        )}
      </div>

      {/* Test Message */}
      <div className="border border-gray-700 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-white font-medium">
          <Send className="w-4 h-4 text-blue-400" />
          שליחת הודעת ניסיון
        </div>
        <div className="flex gap-2">
          <Input
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            placeholder="972501234567"
            className="bg-gray-800 border-gray-700 text-white"
            dir="ltr"
          />
          <Button
            onClick={sendTest}
            disabled={sendingTest || !isConfigured}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-1 whitespace-nowrap"
          >
            {sendingTest ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {sendingTest ? "שולח..." : "שלח ניסיון"}
          </Button>
        </div>
        <p className="text-xs text-gray-500">הזן מספר עם קידומת מדינה (ללא +), לדוגמה: 972501234567</p>
      </div>
    </div>
  );
}