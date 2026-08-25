// Shared source of truth for message-template variable chips, used by both
// the fixed-automation editor (AutomationsDashboard.jsx) and the
// custom-audience automation builder (CreateCustomAutomationModal.jsx).
//
// Keep this in sync with supabase/functions/automation-engine/index.ts's
// renderTemplate() calls -- every token listed here must actually be
// substituted by the matching backend handler, or it will render as dead
// literal text ("{token}") in real outgoing messages.

export const VARS_BY_TYPE = {
  monthly_staff_summary: ["{staffName}", "{month}", "{eventsList}", "{eventCount}", "{totalDays}"],
  daily_event_brief: [
    "{staffName}", "{coupleNames}", "{venue}", "{date}", "{time}",
    "{productionDetails}", "{photographer}", "{photographer2}", "{videographer}",
    "{bridePhone}", "{groomPhone}", "{bridePrepLocation}", "{instagram}",
    "{specialRequests}", "{phoneNumber}", "{productionBrief}", "{finalTechnicalSummary}",
  ],
  // Fixed: was {date}/{venue} (wrong keys, never substituted) + {albumLink}
  // (no backing data). Now matches the corrected runAlbumReminder().
  album_reminder: ["{coupleNames}", "{albumLink}", "{eventDate}", "{venueName}", "{studioName}"],
  payment_reminder: ["{coupleNames}", "{remainingBalance}", "{eventDate}", "{venueName}", "{studioName}"],
  questionnaire_reminder: ["{coupleNames}", "{eventDate}", "{venue}", "{questionnaireLink}", "{studioName}"],
  questionnaire_send: ["{coupleNames}", "{venue}", "{date}", "{questionnaireUrl}", "{studioName}"],
};

export const VARS_BY_AUDIENCE_TYPE = {
  staff_role: ["{staff_name}", "{staffName}"],
  leads_events: ["{coupleNames}", "{eventDate}", "{venueName}", "{studioName}"],
};

export const TEMPLATE_VARIABLE_DESCRIPTIONS = {
  "{staffName}": "שם איש הצוות",
  "{staff_name}": "שם איש הצוות",
  "{month}": "שם החודש הרלוונטי",
  "{eventsList}": "רשימת האירועים של איש הצוות באותו חודש",
  "{eventCount}": "מספר האירועים באותו חודש",
  "{totalDays}": "סה\"כ ימי עבודה באותו חודש",
  "{coupleNames}": "שמות בני הזוג",
  "{venue}": "שם האולם",
  "{venueName}": "שם האולם",
  "{date}": "תאריך האירוע",
  "{eventDate}": "תאריך האירוע",
  "{time}": "שעת האירוע",
  "{productionDetails}": "סיכום פרטי הפקה מהשאלון",
  "{photographer}": "שם הצלם הראשי",
  "{photographer2}": "שם הצלם המשני (אם קיים)",
  "{videographer}": "שם הוידאוגרף",
  "{bridePhone}": "נייד הכלה",
  "{groomPhone}": "נייד החתן",
  "{bridePrepLocation}": "מקום התארגנות הכלה",
  "{instagram}": "אינסטגרם (כלה/חתן)",
  "{specialRequests}": "בקשות מיוחדות מהשאלון",
  "{phoneNumber}": "טלפון איש הקשר של האירוע",
  "{productionBrief}": "תמצית פרטי הפקה",
  "{finalTechnicalSummary}": "סיכום טכני סופי",
  "{albumLink}": "קישור לסקיצת האלבום (אם הוזן באירוע)",
  "{remainingBalance}": "יתרת התשלום שנותרה",
  "{questionnaireLink}": "קישור לשאלון ההפקה",
  "{questionnaireUrl}": "קישור לשאלון ההפקה",
  "{studioName}": "שם הסטודיו (מפרטי הסטודיו בהגדרות)",
};
