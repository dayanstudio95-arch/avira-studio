import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const ROLE_LABELS = {
  photographer1: 'צלם 1',
  photographer2: 'צלם 2',
  videographer: 'צלם וידאו 1',
  videographer2: 'צלם וידאו 2',
};

const TARGET_ROLES = ['photographer1', 'photographer2', 'videographer', 'videographer2'];

const HEBREW_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

Deno.serve(async (req) => {
  try {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try { body = await req.json(); } catch (_) {}

  // Determine target month (default = next month)
  const now = new Date();
  let targetYear = now.getFullYear();
  let targetMonth = now.getMonth() + 2; // getMonth() is 0-indexed, +2 = next month
  if (targetMonth > 12) { targetMonth = 1; targetYear++; }

  if (body.month) {
    // Expect format "YYYY-MM"
    const parts = body.month.split('-');
    targetYear = parseInt(parts[0]);
    targetMonth = parseInt(parts[1]);
  }

  const monthStart = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`;
  const lastDay = new Date(targetYear, targetMonth, 0).getDate();
  const monthEnd = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${lastDay}`;
  const monthLabel = `${HEBREW_MONTHS[targetMonth - 1]} ${targetYear}`;

  // Optional custom template from request
  const customTemplate = body.template || null;

  // Fetch all events in target month
  const allEventsRaw = await base44.asServiceRole.entities.Event.filter({ date: { $gte: monthStart, $lte: monthEnd } }, 'date', 500);
  const events = (Array.isArray(allEventsRaw) ? allEventsRaw : (allEventsRaw?.data || []))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  console.log('[DEBUG] Events fetched for', monthStart, '-', monthEnd, ':', events.length, events.map(e => e.date));

  // Fetch staff members for phone lookup
  const staffMembersRaw = await base44.asServiceRole.entities.StaffMember.list();
  const staffMembers = Array.isArray(staffMembersRaw) ? staffMembersRaw : (staffMembersRaw?.data || []);
  const staffByName = {};
  staffMembers.forEach(s => { staffByName[s.name] = s; });

  function normalizePhone(phone) {
    if (!phone) return null;
    let p = phone.replace(/[-\s]/g, '');
    if (p.startsWith('0')) p = '972' + p.slice(1);
    return p;
  }

  function findStaff(name) {
    if (!name) return null;
    // Exact match
    if (staffByName[name]) return staffByName[name];
    // Normalized match (trim + lowercase)
    const norm = name.trim().toLowerCase();
    const exact = staffMembers.find(s => s.name.trim().toLowerCase() === norm);
    if (exact) return exact;
    // Partial match
    return staffMembers.find(s =>
      s.name.trim().toLowerCase().includes(norm) ||
      norm.includes(s.name.trim().toLowerCase())
    ) || null;
  }

  // Build per-role data: { role -> { staffMemberName -> [events] } }
  const roleMap = {};
  TARGET_ROLES.forEach(r => { roleMap[r] = {}; });

  for (const event of events) {
    const team = event.team || [];
    for (const member of team) {
      if (!TARGET_ROLES.includes(member.role)) continue;
      if (!member.staffMemberName) continue;
      if (!roleMap[member.role][member.staffMemberName]) {
        roleMap[member.role][member.staffMemberName] = [];
      }
      roleMap[member.role][member.staffMemberName].push(event);
    }
  }

  // Build result
  const result = {};

  for (const role of TARGET_ROLES) {
    const staffMap = roleMap[role];
    const entries = [];

    for (const [staffName, staffEvents] of Object.entries(staffMap)) {
      const staffInfo = findStaff(staffName);
      const lines = staffEvents.map(e => {
        const couple = e.coupleNames || '';
        const venue = e.venue ? ` | ${e.venue}` : '';
        return `*${formatDate(e.date)}*\n${couple}${venue}\nתפקיד: ${ROLE_LABELS[role]}`;
      });

      let message;
      if (customTemplate) {
        message = customTemplate
          .replace(/\{name\}/g, staffName)
          .replace(/\{month\}/g, monthLabel)
          .replace(/\{count\}/g, String(staffEvents.length))
          .replace(/\{\{events\}\}/g, lines.join('\n\n'));
      } else {
        message =
          `סיכום אירועים לחודש ${monthLabel}\n\n` +
          lines.join('\n\n');
      }

      entries.push({
        name: staffName,
        phone: normalizePhone(staffInfo?.phoneNumber) || null,
        message,
        eventCount: staffEvents.length,
      });
    }

    result[role] = entries;
  }

  return Response.json({
    month: `${targetMonth}/${targetYear}`,
    monthLabel,
    summary: result,
  });
  } catch (error) {
    console.error('Error:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});