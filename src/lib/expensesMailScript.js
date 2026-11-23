// The Google Apps Script the owner pastes into script.google.com once in each mailbox (2026-11-23, "מרכז הוצאות";
// 0117). Every 10 minutes it looks for mails from the day the collection starts that mention an invoice / receipt
// (or carry a Morning / Paperless link), and for each mail:
//   start   → tells expenses-mail the sender, subject, date, its text and its PDF / image attachments; gets an upload
//             address for each file the server wants (the mail's own body as a PDF when it IS the receipt);
//   upload  → puts each file at its address (straight to Storage);
//   done    → the server reads them.
// A thread is labelled "avira-expenses" once all of it went through (a failure is tried again next run). Mails the
// owner sent himself are skipped. Nothing else leaves the mailbox.
// `setup()` installs the 10-minute trigger (removing any older one of this script) and runs once.
// Pure — the test checks the token / url / start day land in it and that it parses.
export const MAIL_LABEL = "avira-expenses";

export function expensesMailScript({ url, token, since }) {
  const day = String(since || "2026-11-01").slice(0, 10);
  return `// AVIRA — הוצאות מהמייל: חשבוניות וקבלות מהתיבה הזו נשלחות למסך "הוצאות". נוצר במערכת. אל תשתף את הקובץ.
const AVIRA_URL = ${JSON.stringify(url)};
const AVIRA_TOKEN = ${JSON.stringify(token)};
const SINCE = ${JSON.stringify(day)};
const LABEL = ${JSON.stringify(MAIL_LABEL)};
const QUERY = 'after:' + SINCE.replace(/-/g, '/') + ' -in:sent -in:chats -in:spam -in:trash -label:' + LABEL +
  ' (חשבונית OR קבלה OR invoice OR receipt OR mrng.to OR paperless.tax)';
const THREADS_PER_RUN = 10;

function post_(body) {
  const res = UrlFetchApp.fetch(AVIRA_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-avira-token': AVIRA_TOKEN },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    console.log('AVIRA: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
    return null;
  }
  return JSON.parse(res.getContentText());
}

function label_() {
  return GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
}

// One mail: reported, its files uploaded, then "done". true = all of it went through.
function sendMail_(msg) {
  const atts = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });
  const parts = atts.map(function (a, n) {
    return { n: n, name: a.getName(), mime: String(a.getContentType()).split(';')[0].toLowerCase(), size: a.getSize() };
  });
  const answer = post_({
    action: 'start',
    mail: { id: msg.getId(), from: msg.getFrom(), subject: msg.getSubject(), date: msg.getDate().toISOString(), text: msg.getPlainBody().slice(0, 8000), parts: parts, html: true },
  });
  if (!answer) return false;
  if (answer.skip) return true;
  let ok = true;
  (answer.uploads || []).forEach(function (u) {
    if (!ok) return;
    const blob = u.n === 'body' ? Utilities.newBlob(msg.getBody(), 'text/html', 'mail.html').getAs('application/pdf') : atts[u.n];
    if (!blob) { ok = false; return; }
    const res = UrlFetchApp.fetch(u.url, { method: 'put', contentType: u.mime, headers: answer.headers || {}, payload: blob.getBytes(), muteHttpExceptions: true });
    if (res.getResponseCode() >= 300) {
      console.log('AVIRA upload: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
      ok = false;
    }
  });
  return ok && !!post_({ action: 'done', id: msg.getId() });
}

function runAvira() {
  const start = new Date(SINCE + 'T00:00:00');
  const me = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  const label = label_();
  GmailApp.search(QUERY, 0, THREADS_PER_RUN).forEach(function (thread) {
    let ok = true;
    thread.getMessages().forEach(function (m) {
      if (!ok || m.getDate() < start) return;
      if (me && String(m.getFrom()).toLowerCase().indexOf(me) !== -1) return; // what you sent yourself
      try {
        ok = sendMail_(m);
      } catch (e) {
        console.log('AVIRA: ' + e);
        ok = false;
      }
    });
    if (ok) thread.addLabel(label);
  });
}

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('runAvira').timeBased().everyMinutes(10).create();
  post_({ action: 'ping' });
  runAvira();
}
`;
}
