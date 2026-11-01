// The Google Apps Script the owner pastes into script.google.com under the Google account that holds the photos
// (2026-11-02, 0101). Every 5 minutes it tells drive-helper the Drive's used / total space, gets the work and does it:
//   trash         the folder of a gallery removed for good → the Drive trash (Drive keeps it 30 more days);
//   to_favorites  a starred gallery's folder → "גלריות מועדפים" at the top of My Drive (made the first time), and says
//                 where it was;
//   restore       the star taken off → back to that folder.
// It reports what each task came to on the same run. Moving a folder keeps its id, so the gallery keeps working.
// `setup()` installs the 5-minute trigger (removing any older one of this script) and runs once.
// Pure — PART 78 checks the token / url land in it and nothing else does.
export function driveAppsScript({ url, token }) {
  return `// AVIRA — גוגל דרייב: מחיקה, מועדפים ושטח אחסון. נוצר במערכת (הגדרות ← חיבורים). אל תשתף את הקובץ.
const AVIRA_URL = ${JSON.stringify(url)};
const AVIRA_TOKEN = ${JSON.stringify(token)};
const FAVORITES = 'גלריות מועדפים';

function post_(body) {
  const res = UrlFetchApp.fetch(AVIRA_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-avira-token': AVIRA_TOKEN },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    console.log('AVIRA: ' + res.getResponseCode() + ' ' + res.getContentText());
    return null;
  }
  return JSON.parse(res.getContentText());
}

function favorites_() {
  const root = DriveApp.getRootFolder();
  const found = root.getFoldersByName(FAVORITES);
  return found.hasNext() ? found.next() : root.createFolder(FAVORITES);
}

function runAvira() {
  const answer = post_({ storage: { used: DriveApp.getStorageUsed(), limit: DriveApp.getStorageLimit() }, results: [] });
  if (!answer || !answer.tasks || !answer.tasks.length) return;
  const results = [];
  answer.tasks.forEach(function (t) {
    try {
      const folder = DriveApp.getFolderById(t.folderId);
      if (t.kind === 'trash') {
        folder.setTrashed(true);
        results.push({ id: t.id, ok: true });
      } else if (t.kind === 'to_favorites') {
        const parents = folder.getParents();
        const was = parents.hasNext() ? parents.next().getId() : '';
        folder.moveTo(favorites_());
        results.push({ id: t.id, ok: true, prevParentId: was });
      } else if (t.kind === 'restore') {
        folder.moveTo(t.parentId ? DriveApp.getFolderById(t.parentId) : DriveApp.getRootFolder());
        results.push({ id: t.id, ok: true });
      }
    } catch (e) {
      results.push({ id: t.id, ok: false, error: String(e).slice(0, 300) });
    }
  });
  if (results.length) post_({ results: results });
}

// Run once: checks every 5 minutes from now on.
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (tr) { ScriptApp.deleteTrigger(tr); });
  ScriptApp.newTrigger('runAvira').timeBased().everyMinutes(5).create();
  favorites_();
  runAvira();
  console.log('AVIRA: מוכן. מעכשיו רץ כל 5 דקות.');
}
`;
}
