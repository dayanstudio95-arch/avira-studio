import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";

/**
 * Phone validation — decision is based on CLEANED value only.
 *
 * "ok"      🟢 valid Israeli number
 * "dirty"   🟡 valid after cleaning (had invisible/extra chars in raw)
 * "check"   🟡 unusual length but plausible
 * "invalid" 🔴 empty / too short / not a valid number even after cleaning
 *
 * Returns { level, reason }
 */
function classifyPhone(phone) {
  if (!phone || phone.trim() === "") {
    return { level: "invalid", reason: "חסר מספר" };
  }

  // Strip ALL non-digit characters (spaces, dashes, dots, RTL marks, +, parens, invisible unicode)
  const cleaned = phone.replace(/[^\d]/g, "");

  if (cleaned.length === 0) {
    return { level: "invalid", reason: "חסר מספר" };
  }

  const isDirty = cleaned !== phone.trim().replace(/[^\d]/g, "") || phone.trim() !== phone;

  // Valid Israeli mobile: 05X + 7 digits = 10 total
  if (/^05\d{8}$/.test(cleaned)) {
    const wasDirty = cleaned !== phone.trim();
    return wasDirty
      ? { level: "dirty", reason: "תקין לאחר ניקוי תווים מיותרים" }
      : { level: "ok", reason: "פורמט ישראלי תקני" };
  }

  // Valid Israeli landline: 0[2-9] + 7-8 digits
  if (/^0[2-9]\d{7,8}$/.test(cleaned)) {
    const wasDirty = cleaned !== phone.trim();
    return wasDirty
      ? { level: "dirty", reason: "תקין לאחר ניקוי תווים מיותרים" }
      : { level: "ok", reason: "פורמט ישראלי תקני" };
  }

  // +972 / 972 prefix
  if (/^972\d+$/.test(cleaned)) {
    const local = "0" + cleaned.slice(3);
    if (/^05\d{8}$/.test(local) || /^0[2-9]\d{7,8}$/.test(local)) {
      return { level: "ok", reason: "פורמט +972 תקין" };
    }
    return { level: "check", reason: `קידומת 972 אך אורך חריג (${cleaned.length} ספרות)` };
  }

  // Too short
  if (cleaned.length < 9) {
    return { level: "invalid", reason: `אורך לא תקין — ${cleaned.length} ספרות בלבד` };
  }

  // Too long
  if (cleaned.length > 13) {
    return { level: "invalid", reason: `אורך לא תקין — ${cleaned.length} ספרות` };
  }

  // 9-13 digits but unknown prefix
  return { level: "check", reason: `קידומת לא תקינה (${cleaned.slice(0, 3)}...)` };
}

export default function DataAnomaliesCard({ events, leads, staffMembers, messageLogs = [] }) {
  // Build set of phone numbers proven to work (sent successfully via WhatsApp)
  const provenPhones = new Set(
    messageLogs
      .filter(log => log.status === "sent" && log.channel === "whatsapp" && log.recipient_contact)
      .map(log => log.recipient_contact.replace(/[^\d]/g, ""))
  );

  const anomalies = [];

  // 1. Phone numbers for staff members
  staffMembers.forEach(s => {
    if (!s.phoneNumber) {
      anomalies.push({
        type: "phone",
        label: `חסר טלפון — ${s.name}`,
        detail: "אין מספר טלפון רשום",
        severity: "error",
      });
      return;
    }

    const cleaned = s.phoneNumber.replace(/[^\d]/g, "");

    // Proven by successful WhatsApp send → always OK
    if (provenPhones.has(cleaned)) return;

    const { level, reason } = classifyPhone(s.phoneNumber);

    if (level === "invalid") {
      anomalies.push({
        type: "phone",
        label: `טלפון לא תקין — ${s.name}`,
        detail: `${s.phoneNumber} | ${reason}`,
        severity: "error",
      });
    } else if (level === "dirty") {
      anomalies.push({
        type: "phone",
        label: `טלפון דורש ניקוי — ${s.name}`,
        detail: `${s.phoneNumber} → ${cleaned} | ${reason}`,
        severity: "warning",
      });
    } else if (level === "check") {
      anomalies.push({
        type: "phone",
        label: `טלפון דורש בדיקה — ${s.name}`,
        detail: `${s.phoneNumber} | ${reason}`,
        severity: "warning",
      });
    }
    // "ok" → no anomaly
  });

  // 2. Signed leads without a linked event
  const signedLeads = leads.filter(l => l.status === "נסגר/חתימה");
  signedLeads.forEach(l => {
    if (!l.linkedEventId) {
      anomalies.push({
        type: "lead",
        label: `ליד חתום ללא אירוע — ${l.coupleNames || l.id}`,
        detail: l.eventDate ? `תאריך: ${l.eventDate}` : "ללא תאריך",
        severity: "error",
      });
    }
  });

  // 3. Events without sourceLeadId
  const noLead = events.filter(e => !e.sourceLeadId);
  if (noLead.length > 0) {
    anomalies.push({
      type: "event",
      label: `${noLead.length} אירועים ללא ליד מקושר`,
      detail: noLead.map(e => e.coupleNames).slice(0, 3).join(", ") + (noLead.length > 3 ? ` ועוד ${noLead.length - 3}` : ""),
      severity: "info",
    });
  }

  // 4. Duplicate events (same name + date)
  const eventKeys = {};
  events.forEach(e => {
    const key = `${(e.coupleNames || "").trim().toLowerCase()}_${e.date}`;
    if (!eventKeys[key]) eventKeys[key] = [];
    eventKeys[key].push(e);
  });
  Object.values(eventKeys).filter(arr => arr.length > 1).forEach(arr => {
    anomalies.push({
      type: "duplicate",
      label: `כפילות: ${arr[0].coupleNames}`,
      detail: `${arr.length} רשומות לתאריך ${arr[0].date}`,
      severity: "error",
    });
  });

  const severityStyle = {
    error:   "border-red-700/50 bg-red-900/15",
    warning: "border-yellow-700/50 bg-yellow-900/10",
    info:    "border-blue-700/50 bg-blue-900/10",
  };
  const severityIcon = { error: "🔴", warning: "🟡", info: "🔵" };

  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-white text-base flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-yellow-400" />
          חריגות דאטה
          {anomalies.length > 0 && (
            <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-700 text-xs ml-1">{anomalies.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {anomalies.length === 0 ? (
          <p className="text-gray-500 text-sm">לא נמצאו חריגות ✓</p>
        ) : (
          <div className="space-y-2">
            {anomalies.map((a, i) => (
              <div key={i} className={`rounded-lg p-3 border ${severityStyle[a.severity]}`}>
                <div className="flex items-center gap-2">
                  <span className="text-sm">{severityIcon[a.severity]}</span>
                  <span className="text-gray-200 text-sm">{a.label}</span>
                </div>
                {a.detail && <p className="text-gray-500 text-xs mt-1 mr-6">{a.detail}</p>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}