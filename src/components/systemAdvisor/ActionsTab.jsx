import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, FileText, Copy, Check } from "lucide-react";

// ─── WHITELIST ────────────────────────────────────────────────────────────────
// V4.0: Navigate + Draft only. Zero write operations.
// ─────────────────────────────────────────────────────────────────────────────

const NAVIGATE_TARGETS = {
  payments:      "/Payments",
  staffSchedule: "/StaffScheduling",
  automations:   "/AutomationsDashboard",
  leads:         "/Leads",
};

// ─── Navigate Action Card ─────────────────────────────────────────────────────

function NavigateAction({ icon, label, description, target, badge }) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center justify-between p-3 rounded-xl border border-gray-700/60 bg-gray-800/40">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-lg shrink-0">{icon}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-gray-200 text-sm font-medium">{label}</span>
            {badge != null && badge > 0 && (
              <Badge className="bg-red-500/20 text-red-300 border-red-700/50 text-xs px-1.5">{badge}</Badge>
            )}
          </div>
          <p className="text-gray-500 text-xs mt-0.5">{description}</p>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white gap-1"
        onClick={() => navigate(NAVIGATE_TARGETS[target])}
      >
        <ExternalLink className="w-3.5 h-3.5" />
        פתח
      </Button>
    </div>
  );
}

// ─── Draft Preview Card ───────────────────────────────────────────────────────

function DraftAction({ icon, label, description, draftText, disabled }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(draftText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl border border-gray-700/60 bg-gray-800/40 overflow-hidden">
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-lg shrink-0">{icon}</span>
          <div className="min-w-0">
            <span className="text-gray-200 text-sm font-medium">{label}</span>
            <p className="text-gray-500 text-xs mt-0.5">{description}</p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white gap-1"
          onClick={() => setOpen(o => !o)}
          disabled={disabled}
        >
          <FileText className="w-3.5 h-3.5" />
          {open ? "סגור" : "טיוטה"}
        </Button>
      </div>

      {open && (
        <div className="border-t border-gray-700/60 bg-gray-900/60 p-3 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-400 text-xs">טיוטת הודעה — העתק ושלח ידנית</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-gray-400 hover:text-white gap-1"
              onClick={handleCopy}
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "הועתק" : "העתק"}
            </Button>
          </div>
          <pre className="text-gray-300 text-xs whitespace-pre-wrap font-sans leading-relaxed bg-gray-800/60 rounded-lg p-3 border border-gray-700/40">
            {draftText}
          </pre>
          <p className="text-gray-600 text-xs text-center">⚠️ אין שליחה אוטומטית — טיוטה בלבד</p>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ActionsTab({ events, leads, automationRuns, staffMembers }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // ── Compute counts ──────────────────────────────────────────────────────────
  const unpaidEvents = events.filter(e => new Date(e.date) < today && e.clientPaymentStatus !== "Paid");
  const unpaidOld    = unpaidEvents.filter(e => (today - new Date(e.date)) / 86400000 > 30);

  const sevenAhead = new Date(today.getTime() + 7 * 86400000);
  const missingCrewEvents = events.filter(e => {
    const d = new Date(e.date);
    if (d < today || d > sevenAhead) return false;
    const assigned = (e.team || []).filter(m => m.staffMemberName).length;
    return assigned < (e.requiredCrew || 3);
  });

  const threeDaysAgo = new Date(today.getTime() - 3 * 86400000).toISOString();
  const failedRuns = automationRuns.filter(r => r.status === "error" && r.started_at > threeDaysAgo);

  const staleLeads = leads.filter(l => {
    if (l.status !== "חדש" && l.status !== "נשלחה הצעה") return false;
    if (!l.last_contact_date) return true;
    return (today - new Date(l.last_contact_date)) / 86400000 > 5;
  });

  // ── Build draft texts ───────────────────────────────────────────────────────

  const paymentDraft = unpaidOld.length === 0
    ? "אין חובות פתוחים מעל 30 יום."
    : unpaidOld.map(e => {
        const days = Math.round((today - new Date(e.date)) / 86400000);
        return `שלום ${e.coupleNames},\nרצינו להזכיר שיש יתרה פתוחה של ₪${(e.totalAmountGross || 0).toLocaleString()} עבור האירוע שלכם ב-${e.date}.\nנשמח אם תוכלו לסגור את החשבון בהקדם.\nתודה רבה 🙏`;
      }).join("\n\n---\n\n");

  const crewDraft = (() => {
    const upcoming = events.find(e => {
      const d = new Date(e.date);
      return d >= today && d <= sevenAhead;
    });
    if (!upcoming) return "אין אירועים קרובים.";
    const sp = staffMembers.slice(0, 1)[0];
    const staffName = sp ? sp.name : "[שם הצלם]";
    return `שלום ${staffName},\nרצינו לאשר את הלו"ז שלך לאירוע הקרוב:\n\nזוג: ${upcoming.coupleNames}\nתאריך: ${upcoming.date}\nאולם: ${upcoming.venue || "—"}\n\nנא לאשר קבלת ההודעה.\nתודה! 📸`;
  })();

  const questionnaireDraft = (() => {
    const soon = events.find(e => {
      const days = Math.round((new Date(e.date) - today) / 86400000);
      return days >= 0 && days <= 30 && !e.questionnaireSentAt;
    });
    if (!soon) return "אין אירועים קרובים ללא שאלון.";
    return `שלום ${soon.coupleNames},\nהאירוע שלכם מתקרב ב-${soon.date} 🎉\nכדי שנוכל להתכונן בצורה הטובה ביותר, נשמח אם תמלאו את השאלון המקדים:\n[קישור לשאלון]\n\nתודה ומחכים לחגוג איתכם! 💍`;
  })();

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Navigate Actions */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-white text-sm flex items-center gap-2">
            <ExternalLink className="w-4 h-4 text-blue-400" />
            ניווט מהיר לפי בעיה
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <NavigateAction
            icon="💰"
            label="חובות פתוחים"
            description={unpaidEvents.length > 0 ? `${unpaidEvents.length} אירועים ממתינים לתשלום` : "אין חובות פתוחים כרגע"}
            target="payments"
            badge={unpaidEvents.length}
          />
          <NavigateAction
            icon="👥"
            label="שיבוץ צוות"
            description={missingCrewEvents.length > 0 ? `${missingCrewEvents.length} אירועים קרובים חסרי צוות` : "כל האירועים הקרובים מאוישים"}
            target="staffSchedule"
            badge={missingCrewEvents.length}
          />
          <NavigateAction
            icon="🤖"
            label="לוח אוטומציות"
            description={failedRuns.length > 0 ? `${failedRuns.length} אוטומציות נכשלו ב-3 הימים האחרונים` : "אין כשלים אחרונים"}
            target="automations"
            badge={failedRuns.length}
          />
          <NavigateAction
            icon="📋"
            label="לידים ממתינים"
            description={staleLeads.length > 0 ? `${staleLeads.length} לידים ללא מענה מעל 5 ימים` : "כל הלידים מטופלים"}
            target="leads"
            badge={staleLeads.length}
          />
        </CardContent>
      </Card>

      {/* Draft Actions */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-white text-sm flex items-center gap-2">
            <FileText className="w-4 h-4 text-yellow-400" />
            טיוטות הודעה
            <span className="text-gray-600 text-xs font-normal">— העתק ושלח ידנית בלבד</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <DraftAction
            icon="💳"
            label="הודעת גבייה"
            description={unpaidOld.length > 0 ? `${unpaidOld.length} חובות פתוחים מעל 30 יום` : "אין חובות פתוחים מעל 30 יום"}
            draftText={paymentDraft}
            disabled={unpaidOld.length === 0}
          />
          <DraftAction
            icon="📸"
            label="הודעה לצלם"
            description={'טיוטת הודעת אישור לו"ז לאירוע הקרוב'}
            draftText={crewDraft}
          />
          <DraftAction
            icon="📋"
            label="שאלון לזוג"
            description="טיוטת שאלון לאירוע הקרוב ביותר ללא שאלון"
            draftText={questionnaireDraft}
            disabled={events.every(e => {
              const days = Math.round((new Date(e.date) - today) / 86400000);
              return !(days >= 0 && days <= 30 && !e.questionnaireSentAt);
            })}
          />
        </CardContent>
      </Card>

      <p className="text-gray-700 text-xs text-center">
        V4.0 — Navigate + Draft only · אין שום write operation · אין שליחה אוטומטית
      </p>
    </div>
  );
}