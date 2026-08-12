import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ROLE_LABELS = {
  photographer1: 'צלם 1',
  photographer2: 'צלם 2',
  videographer: 'צלם וידאו',
  videographer2: 'צלם וידאו 2',
  editor: 'עורך',
};

const HEBREW_MONTHS = {
  'ינואר': 1, 'פברואר': 2, 'מרץ': 3, 'אפריל': 4, 'מאי': 5, 'יוני': 6,
  'יולי': 7, 'אוגוסט': 8, 'ספטמבר': 9, 'אוקטובר': 10, 'נובמבר': 11, 'דצמבר': 12
};

const MONTH_NAMES_HE = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

const normalize = (s) => s?.trim().toLowerCase().replace(/\s+/g, ' ') || '';

function formatDate(dateStr) {
  // "2026-04-18" → "18/04/26"
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

function formatMonth(yyyyMM) {
  const [y, m] = yyyyMM.split('-');
  return `${MONTH_NAMES_HE[parseInt(m) - 1]} ${y}`;
}

// ── Intent detection ──────────────────────────────────────────────────────────

function detectStaffScheduleIntent(message) {
  const pattern = /(?:איפה|מה האירועים של|לוח עבודה של|מתי עובד|איפה עובד)\s+([^\s?]+)(?:\s+ב?החודש|\s+ב?חודש\s+(\S+))?/i;
  const match = message.match(pattern);
  if (!match) return null;
  return { staffQuery: match[1], monthOverride: match[2] || null };
}

function detectStaffScheduleByMonthIntent(message) {
  // Pattern: "איפה [name] עובד בחודש [month]?" or "איפה [name] בחודש [month]?" etc.
  const pattern = /(?:איפה|מה האירועים של|תן לי|צלמ[ת]?)\s+([^?\s]+?)\s+(?:עובד|עובדת)?\s+(?:ב|ב?)חודש\s+(\S+)/i;
  const match = message.match(pattern);
  if (!match) return null;
  const staffQuery = match[1];
  const monthName = match[2].replace(/[?!.,]/g, '');
  return { staffQuery, monthName, type: 'month' };
}

function detectStaffScheduleByYearIntent(message) {
  // Must contain a year marker word
  if (!/השנה|שנה\s*זו|שנה\s*הנוכחית/.test(message)) return null;

  // Remove all known noise words/tokens and take the first remaining word as the staff name.
  // This handles any word order, e.g.:
  //   "תן לי את כל התאריכים שהצלם איילון עובד השנה"
  //   "איפה איילון עובד השנה"
  //   "כל האירועים של איילון השנה"
  //   "רשימת כל האירועים של איילון השנה"
  //   "כל התאריכים של איילון השנה"
  const noiseWords = new Set([
    'תן','לי','את','כל','ש','של','שה','מה','איפה','רשימת',
    'התאריכים','האירועים','תאריכים','אירועים',
    'הצלם','הצלמת','צלם','צלמת','עורך','וידאוגרף',
    'שהצלם','שהצלמת','שצלם','שצלמת',
    'עובד','עובדת','השנה','שנה','זו','הנוכחית','בשנה','לשנה',
  ]);

  // Strip leading ש/ה/ב/ל prefixes from each token before checking noise, then find the staff name
  const stripPrefix = (t) => t.replace(/^(שה|ש|ה|ב|ל)/, '');
  const tokens = message.replace(/[?!.,]/g, '').split(/\s+/);
  const staffQuery = tokens
    .map(t => ({ raw: t, clean: stripPrefix(t) }))
    .find(({ clean }) => clean.length > 1 && !noiseWords.has(clean))
    ?.clean;

  if (!staffQuery) return null;
  return { staffQuery, type: 'year' };
}

function parseMonthYear(monthName, year) {
  // monthName can be Hebrew month name or number
  let monthNum = null;
  
  // Try Hebrew month names
  if (HEBREW_MONTHS[monthName]) {
    monthNum = HEBREW_MONTHS[monthName];
  } else if (/^\d+$/.test(monthName) && parseInt(monthName) >= 1 && parseInt(monthName) <= 12) {
    monthNum = parseInt(monthName);
  } else {
    return null; // Could not parse
  }
  
  return `${year}-${String(monthNum).padStart(2, '0')}`;
}

function detectUnpaidIntent(message) {
  return /מי עדיין לא שילם|חובות פתוחים|חסר תשלום|לא שילמו|unpaid/i.test(message);
}

// ── Structured resolvers ──────────────────────────────────────────────────────

function resolveStaffMember(staffQuery, staffMembers) {
  // Filter out stop words from the query
  const stopWords = ['הצלם', 'צלמת', 'צלם', 'בשם', 'של', 'עובד', 'עובדת', 'בחודש', 'חודש', 'בשנה', 'השנה'];
  let cleanQuery = staffQuery;
  for (const stopWord of stopWords) {
    cleanQuery = cleanQuery.replace(new RegExp(`\\b${stopWord}\\b`, 'i'), '').trim();
  }
  
  cleanQuery = normalize(cleanQuery);
  
  // Find matching staff members (normalized, partial match)
  const matches = staffMembers.filter(s =>
    normalize(s.name).includes(cleanQuery) ||
    cleanQuery.includes(normalize(s.name))
  );

  return { matches, cleanedQuery: cleanQuery };
}

function resolveStaffSchedule({ staffQuery, monthOverride }, events, staffMembers, today) {
  const targetMonth = monthOverride || today.slice(0, 7);

  // Find matching staff members (normalized, partial match)
  const matches = staffMembers.filter(s =>
    normalize(s.name).includes(normalize(staffQuery)) ||
    normalize(staffQuery).includes(normalize(s.name))
  );

  if (matches.length === 0) {
    return {
      type: 'structured_answer',
      intent: 'staff_schedule_by_month',
      staffName: staffQuery,
      month: targetMonth,
      events: [],
      count: 0,
      ambiguous: false,
      notFound: true,
    };
  }

  if (matches.length > 1) {
    return {
      type: 'structured_answer',
      intent: 'staff_schedule_by_month',
      staffName: staffQuery,
      month: targetMonth,
      events: [],
      count: 0,
      ambiguous: true,
      candidates: matches.map(s => s.name),
    };
  }

  const staffName = matches[0].name;
  const staffId = matches[0].id;

  const relevantEvents = events
    .filter(e => e.date?.startsWith(targetMonth))
    .filter(e => Array.isArray(e.team) && e.team.some(t => t.staffMemberName === staffName))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .map(e => {
      const member = e.team.find(t => t.staffMemberName === staffName);
      return {
        date: e.date,
        coupleNames: e.coupleNames || '',
        venue: e.venue || '',
        role: member?.role || '',
      };
    });

  return {
    type: 'structured_answer',
    intent: 'staff_schedule_by_month',
    staffName,
    staffId,
    month: targetMonth,
    events: relevantEvents,
    count: relevantEvents.length,
    ambiguous: false,
    notFound: false,
  };
}

function resolveStaffScheduleByMonth({ staffQuery, monthName }, events, staffMembers, today) {
  const { matches } = resolveStaffMember(staffQuery, staffMembers);

  if (matches.length === 0) {
    return {
      type: 'structured_answer',
      intent: 'staff_schedule_by_month',
      staffName: staffQuery,
      month: null,
      events: [],
      count: 0,
      notFound: true,
      ambiguous: false,
    };
  }

  if (matches.length > 1) {
    return {
      type: 'structured_answer',
      intent: 'staff_schedule_by_month',
      staffName: staffQuery,
      month: null,
      events: [],
      count: 0,
      ambiguous: true,
      candidates: matches.map(s => s.name),
    };
  }

  const staffName = matches[0].name;
  const staffId = matches[0].id;
  const currentYear = today.split('-')[0];
  const targetMonth = parseMonthYear(monthName, currentYear);

  if (!targetMonth) {
    return {
      type: 'structured_answer',
      intent: 'staff_schedule_by_month',
      staffName,
      staffId,
      month: null,
      events: [],
      count: 0,
      notFound: false,
      ambiguous: true,
      error: `לא הבנתי את השם החודש "${monthName}". אנא תן שם בעברית או מספר (1-12).`,
    };
  }

  const relevantEvents = events
    .filter(e => e.date?.startsWith(targetMonth))
    .filter(e => Array.isArray(e.team) && e.team.some(t => t.staffMemberName === staffName))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .map(e => {
      const member = e.team.find(t => t.staffMemberName === staffName);
      return {
        date: e.date,
        coupleNames: e.coupleNames || '',
        venue: e.venue || '',
        role: member?.role || '',
      };
    });

  return {
    type: 'structured_answer',
    intent: 'staff_schedule_by_month',
    staffName,
    staffId,
    month: targetMonth,
    events: relevantEvents,
    count: relevantEvents.length,
    notFound: false,
    ambiguous: false,
  };
}

function resolveStaffScheduleByYear({ staffQuery }, events, staffMembers, today) {
  const { matches } = resolveStaffMember(staffQuery, staffMembers);

  if (matches.length === 0) {
    return {
      type: 'structured_answer',
      intent: 'staff_schedule_by_year',
      staffName: staffQuery,
      year: null,
      events: [],
      count: 0,
      notFound: true,
      ambiguous: false,
    };
  }

  if (matches.length > 1) {
    return {
      type: 'structured_answer',
      intent: 'staff_schedule_by_year',
      staffName: staffQuery,
      year: null,
      events: [],
      count: 0,
      ambiguous: true,
      candidates: matches.map(s => s.name),
    };
  }

  const staffName = matches[0].name;
  const staffId = matches[0].id;
  const currentYear = today.split('-')[0];

  const relevantEvents = events
    .filter(e => e.date?.startsWith(currentYear))
    .filter(e => Array.isArray(e.team) && e.team.some(t => t.staffMemberName === staffName))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .map(e => {
      const member = e.team.find(t => t.staffMemberName === staffName);
      return {
        date: e.date,
        coupleNames: e.coupleNames || '',
        venue: e.venue || '',
        role: member?.role || '',
      };
    });

  return {
    type: 'structured_answer',
    intent: 'staff_schedule_by_year',
    staffName,
    staffId,
    year: currentYear,
    events: relevantEvents,
    count: relevantEvents.length,
    notFound: false,
    ambiguous: false,
  };
}

function resolveUnpaid(events, today) {
  const unpaidEvents = events
    .filter(e => e.date && e.date < today)
    .filter(e => e.clientPaymentStatus !== 'Paid')
    .sort((a, b) => (b.date || '').localeCompare(a.date || '')) // most recent first
    .map(e => ({
      date: e.date,
      coupleNames: e.coupleNames || '',
      venue: e.venue || '',
      paymentStatus: e.clientPaymentStatus || 'Unpaid',
    }));

  return {
    type: 'structured_answer',
    intent: 'unpaid_events',
    events: unpaidEvents,
    count: unpaidEvents.length,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { message, history, read_only } = await req.json();
    const isReadOnly = read_only === true;

    // Load all relevant data
    const [events, staffMembers] = await Promise.all([
      base44.entities.Event.list('-date'),
      base44.entities.StaffMember.list(),
    ]);

    const today = new Date().toISOString().split('T')[0];

    // ── Clarification followup: check if last assistant turn had a pendingIntent ──
    const lastAssistantMsg = [...(history || [])].reverse().find(m => m.role === 'assistant');
    if (lastAssistantMsg?.pendingIntent) {
      const pending = lastAssistantMsg.pendingIntent;
      // Use the user's reply as the new staff query
      const clarifiedIntent = { ...pending, staffQuery: message.trim() };
      let result;
      if (pending.type === 'month') {
        result = resolveStaffScheduleByMonth(clarifiedIntent, events, staffMembers, today);
      } else if (pending.type === 'year') {
        result = resolveStaffScheduleByYear(clarifiedIntent, events, staffMembers, today);
      } else {
        result = resolveStaffSchedule(clarifiedIntent, events, staffMembers, today);
      }
      // If still ambiguous, ask again
      if (result.ambiguous) {
        return Response.json({
          result: {
            type: 'clarification_needed',
            text: `עדיין לא ברור. נמצאו: ${result.candidates.join(', ')}. איזה מהם התכוונת?`,
            pendingIntent: pending,
          },
        });
      }
      return Response.json({ result });
    }

    // ── Intent: staff schedule by month ───────────────────────────────────────
    const staffByMonthIntent = detectStaffScheduleByMonthIntent(message);
    if (staffByMonthIntent) {
      const result = resolveStaffScheduleByMonth(staffByMonthIntent, events, staffMembers, today);
      if (result.ambiguous && result.candidates?.length) {
        return Response.json({
          result: {
            type: 'clarification_needed',
            text: `נמצאו כמה אנשי צוות תואמים: ${result.candidates.join(', ')}. איזה מהם התכוונת?`,
            pendingIntent: staffByMonthIntent,
          },
        });
      }
      return Response.json({ result });
    }

    // ── Intent: staff schedule by year ────────────────────────────────────────
    const staffByYearIntent = detectStaffScheduleByYearIntent(message);
    if (staffByYearIntent) {
      const result = resolveStaffScheduleByYear(staffByYearIntent, events, staffMembers, today);
      if (result.ambiguous && result.candidates?.length) {
        return Response.json({
          result: {
            type: 'clarification_needed',
            text: `נמצאו כמה אנשי צוות תואמים: ${result.candidates.join(', ')}. איזה מהם התכוונת?`,
            pendingIntent: staffByYearIntent,
          },
        });
      }
      return Response.json({ result });
    }

    // ── Intent: staff schedule (legacy) ───────────────────────────────────────
    const staffIntent = detectStaffScheduleIntent(message);
    if (staffIntent) {
      const result = resolveStaffSchedule(staffIntent, events, staffMembers, today);
      if (result.ambiguous && result.candidates?.length) {
        return Response.json({
          result: {
            type: 'clarification_needed',
            text: `נמצאו כמה אנשי צוות תואמים: ${result.candidates.join(', ')}. איזה מהם התכוונת?`,
            pendingIntent: { ...staffIntent, type: 'legacy' },
          },
        });
      }
      return Response.json({ result });
    }

    // ── Intent: unpaid events ─────────────────────────────────────────────────
    if (detectUnpaidIntent(message)) {
      const result = resolveUnpaid(events, today);
      return Response.json({ result });
    }

    // ── Fallback: LLM ─────────────────────────────────────────────────────────
    const staffPhoneMap = {};
    staffMembers.forEach(s => { if (s.name) staffPhoneMap[s.name] = s.phoneNumber || null; });

    const eventsSummary = events.map(e => ({
      id: e.id,
      coupleNames: e.coupleNames,
      date: e.date,
      venue: e.venue || '',
      phoneNumber: e.phoneNumber || '',
      team: (e.team || []).map(m => ({
        role: m.role,
        name: m.staffMemberName,
        phone: staffPhoneMap[m.staffMemberName] || null,
      })),
      photographer1_done: !!e.photographer1_done,
      photographer2_done: !!e.photographer2_done,
      video1_done: !!e.video1_done,
      editor_done: !!e.editor_done,
      raw_link: e.raw_link || null,
      raw_sent_to_editor: !!e.raw_sent_to_editor,
      raw_done_manual: !!e.raw_done_manual,
      final_link: e.final_link || null,
      final_done_manual: !!e.final_done_manual,
      albumStatus: e.albumStatus || 'pending',
      clientPaymentStatus: e.clientPaymentStatus || 'Unpaid',
    }));

    const weekLater = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    const systemPrompt = `אתה עוזר תפעולי חכם של סטודיו צילום חתונות Avira Media.
יש לך גישה לנתונים הבאים של המערכת:

תאריך היום: ${today}
אירועים השבוע: ${today} עד ${weekLater}

נתוני אירועים (JSON):
${JSON.stringify(eventsSummary, null, 2)}

אנשי צוות ומספרי טלפון:
${JSON.stringify(staffMembers.map(s => ({ name: s.name, role: s.role, phone: s.phoneNumber })), null, 2)}

---
כללי תגובה:

1. ענה תמיד בעברית, בצורה קצרה וממוקדת.

2. שאלות על נתונים (Query) — ענה ישירות מהנתונים, החזר type: "answer" בלבד, לעולם לא action_proposal.

3. כשמשתמש מבקש לבצע פעולה — ה-AI חייב להציע action מובנה לאישור.
   החזר JSON כך:
   {
     "type": "action_proposal",
     "description": "תיאור הפעולה שתבצע",
     "action": {
       "name": "send_to_editor" | "send_to_couple" | "update_field" | "mark_done",
       "eventId": "...",
       "params": { ... }
     },
     "confirmText": "טקסט כפתור האישור"
   }

4. פעולות אפשריות (רק אלה, אין אחרות):
   - send_to_editor: שלח גלם לעורך. params: { eventId, coupleNames, eventDate, venue, phoneNumber, editorName, editorPhone, rawLink }
   - send_to_couple: שלח סופי לזוג. params: { eventId, coupleNames, eventDate, phoneNumber, finalLink }
   - update_field: עדכן שדה מותר. params: { eventId, field, value }
     שדות מותרים: albumStatus, raw_sent_to_editor, raw_done_manual, final_done_manual, photographer1_done, photographer2_done, video1_done, editor_done
   - mark_done: סמן כהושלם. params: { eventId, field }
     שדות מותרים: photographer1_done, photographer2_done, video1_done, editor_done, raw_done_manual, final_done_manual

5. אם חסר מידע (טלפון, לינק, שם עורך) — ציין זאת בבירור.
   אם הפעולה כבר בוצעה (raw_sent_to_editor=true) — ציין זאת.

6. אם אין action נדרש — החזר פשוט:
   { "type": "answer", "text": "..." }`;

    const conversationMessages = (history || []).map(m => ({ role: m.role, content: m.content }));
    conversationMessages.push({ role: 'user', content: message });

    const prompt = systemPrompt + '\n\n---\nשיחה:\n' +
      conversationMessages.map(m => `${m.role === 'user' ? 'משתמש' : 'עוזר'}: ${m.content}`).join('\n') +
      '\n\nעוזר:';

    const response = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          text: { type: 'string' },
          description: { type: 'string' },
          action: { type: 'object' },
          confirmText: { type: 'string' },
        },
        required: ['type'],
      },
    });

    // ── Read-only enforcement ─────────────────────────────────────────────────
    // If read_only: true, downgrade action_proposal to a plain answer
    if (isReadOnly && response?.type === 'action_proposal') {
      return Response.json({
        result: {
          type: 'answer',
          text: 'פעולה זו אינה זמינה במצב תצוגה בלבד.',
        },
      });
    }

    return Response.json({ result: response });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});