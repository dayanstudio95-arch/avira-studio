// The Google Apps Script the owner pastes into script.google.com under the Gmail account
// Pixieset emails (2026-10-29). Every 5 minutes it looks for "[Pixieset] Check out favorites
// from …" (the couple pressed "send to photographer"), posts each one to
// pixieset-favorites-notify, and labels the thread once the system answered 200 — a failed
// send stays unlabelled and is tried again on the next run. `setup()` first labels every such
// email already in the mailbox WITHOUT sending, so old selections never reach the group, then
// installs the 5-minute trigger (and removes any older trigger of this script).
// Pure — PART 73 checks the token/url land in it and nothing else does.
export function pixiesetAppsScript({ url, token }) {
  return `// AVIRA — פיקסיסט ← קבוצת וואטסאפ. נוצר במערכת (הגדרות ← חיבורים). אל תשתף את הקובץ.
const AVIRA_URL = ${JSON.stringify(url)};
const AVIRA_TOKEN = ${JSON.stringify(token)};
const LABEL = 'avira-pixieset-sent';
const QUERY = 'from:pixiesetmail.com subject:"Check out favorites" -label:' + LABEL;

function label_() {
  return GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
}

function checkPixieset() {
  const label = label_();
  const threads = GmailApp.search(QUERY + ' newer_than:14d', 0, 20);
  threads.forEach(function (t) {
    let ok = true;
    t.getMessages().forEach(function (m) {
      if (!/check out favorites/i.test(m.getSubject())) return;
      const res = UrlFetchApp.fetch(AVIRA_URL, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-avira-token': AVIRA_TOKEN },
        payload: JSON.stringify({ id: m.getId(), subject: m.getSubject(), body: m.getPlainBody(), html: m.getBody(), date: m.getDate().toISOString() }),
        muteHttpExceptions: true,
      });
      if (res.getResponseCode() !== 200) { ok = false; console.log('AVIRA: ' + res.getResponseCode() + ' ' + res.getContentText()); }
    });
    if (ok) t.addLabel(label);
  });
}

// Run once: marks what is already in the mailbox (nothing is sent), then checks every 5 minutes.
function setup() {
  const label = label_();
  GmailApp.search(QUERY, 0, 200).forEach(function (t) { t.addLabel(label); });
  ScriptApp.getProjectTriggers().forEach(function (tr) { ScriptApp.deleteTrigger(tr); });
  ScriptApp.newTrigger('checkPixieset').timeBased().everyMinutes(5).create();
  console.log('AVIRA: מוכן. מעכשיו נבדק כל 5 דקות.');
}
`;
}
