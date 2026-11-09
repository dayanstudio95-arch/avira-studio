import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Camera, FolderDown, FolderPlus, Loader2, PlugZap, Upload, X } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { appFolderOf, connectDrive, dismissUpload, driveQuota, driveStatus, filesFromDrop, filesFromInput, isOpen, jobFor, startUpload, subscribe } from "@/lib/driveUpload";
import { addPicked, defaultUploadRoles, drivePath, galleryFolderName, photosText, planUpload, READ_DEPTH, sizeText, teamPhotographers, withoutFolder } from "@/lib/driveUploadPlan";
import { DriveJobButtons, DriveJobProgress } from "@/components/DriveUploadPill";

// "העלאה מהמחשב לגוגל דרייב" on a photo gallery (Avira, 2026-11-03, the owner's request; src/lib/driveUpload.js): the
// wedding's folder is dropped here, its sub-folders are the sets; whose materials they are (the event's photographers,
// as on work status — marked "done" there at the end; 2026-11-09: or "יהיו עוד בהמשך" — not marked, the end offers to
// mark him); then the upload runs in the background.
// 2026-11-10: folders picked / dropped one after another join one list (one upload), each with an "X".
// `galleryId` null = a new gallery not saved yet: `onReady({ plan, roles, people, later })` hands the choice to the form,
// which starts the upload once the gallery is made (null when nothing is chosen).
export default function DriveUploadPanel({ galleryId = null, coupleName = "", date = "", eventId = null, existingFolderUrl = "", onReady = null }) {
  const location = useLocation();
  const [status, setStatus] = useState(null); // { connected, email } | { failed }
  // Every file chosen so far ({ path, size, file }), from every folder picked or dropped.
  const [picked, setPicked] = useState([]);
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  const plan = useMemo(() => (picked.length ? planUpload(picked) : null), [picked]);
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);
  const [team, setTeam] = useState([]);
  const [roles, setRoles] = useState([]);
  // The chosen photographers with more of their materials to come (not marked "done" at the end).
  const [later, setLater] = useState([]);
  const people = team.filter((m) => roles.includes(m.role));
  const [quota, setQuota] = useState(null);
  const [target, setTarget] = useState({ checked: false, folderId: null });
  const [job, setJob] = useState(() => (galleryId ? jobFor(galleryId) : null));
  const inputRef = useRef(null);

  // The job changes in place: a tick redraws its progress and buttons (2026-11-07 — the same object stopped React, and
  // the panel stayed on "מכין את התיקיות" with no pause button while the pill below moved on).
  const [, setTick] = useState(0);
  useEffect(
    () =>
      galleryId
        ? subscribe(() => {
            setJob(jobFor(galleryId));
            setTick((t) => t + 1);
          })
        : undefined,
    [galleryId],
  );
  useEffect(() => {
    let live = true;
    driveStatus()
      .then((s) => live && setStatus(s || { failed: true }))
      .catch(() => live && setStatus({ failed: true }));
    return () => {
      live = false;
    };
  }, []);
  // The event's photographers, as work status shows them; the first whose materials are not marked yet chosen at first.
  useEffect(() => {
    if (!eventId) return setTeam([]);
    let live = true;
    supabase
      .from("events")
      .select("team, photographer1_done, photographer2_done")
      .eq("id", eventId)
      .maybeSingle()
      .then(({ data }) => {
        if (!live) return;
        const t = teamPhotographers(data?.team);
        setTeam(t);
        setRoles(defaultUploadRoles(t, data));
      });
    return () => {
      live = false;
    };
  }, [eventId]);
  // Once connected: the Drive's space, and whether the gallery already has a Drive folder the system made.
  useEffect(() => {
    if (!status?.connected) return;
    driveQuota().then(setQuota);
    if (existingFolderUrl) appFolderOf(existingFolderUrl).then((folderId) => setTarget({ checked: true, folderId }));
    else setTarget({ checked: true, folderId: null });
  }, [status?.connected, existingFolderUrl]);

  // What is picked or dropped joins what was chosen before (the same folder again is kept once).
  const choose = async (files) => {
    setReading(true);
    try {
      const added = await files;
      if (!planUpload(added).count) {
        toast.error("לא נמצאו תמונות בתיקייה (JPG, PNG, HEIC…)");
        return;
      }
      const before = pickedRef.current;
      const next = addPicked(before, added);
      if (next.length === before.length) {
        toast.info("התיקייה הזו כבר ברשימה");
        return;
      }
      setPicked(next);
    } catch {
      toast.error("לא הצלחנו לקרוא את התיקייה. גוררים אותה שוב, או בוחרים אותה מהמחשב.");
    } finally {
      setReading(false);
    }
  };
  useEffect(() => {
    onReady?.(plan ? { plan, roles, people, later: later.filter((r) => roles.includes(r)) } : null);
  }, [plan, roles, later]);

  const start = () => {
    try {
      startUpload({ galleryId, coupleName, date, eventId, roles, people, later: later.filter((r) => roles.includes(r)), plan, folderId: target.folderId });
      setPicked([]);
    } catch (e) {
      toast.error(e.message);
    }
  };

  if (!status) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" /> בודק את החיבור לגוגל דרייב…
      </div>
    );
  }
  if (job && (isOpen(job) || job.phase === "done")) {
    return (
      <div className="space-y-3 rounded-lg border border-gray-700 p-3" data-testid="drive-panel-job">
        <DriveJobProgress job={job} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <DriveJobButtons job={job} />
          {isOpen(job) ? (
            <span className="text-[11px] text-gray-500">אפשר לעבור לדפים אחרים, ההעלאה ממשיכה (פס למטה במסך).</span>
          ) : (
            // Done: the next photographer's materials the same day (2026-11-07; the finished upload hid the drop zone).
            <button type="button" onClick={() => dismissUpload(job)} className="rounded-md border border-brand-400/60 px-2 py-1 text-xs text-brand-200 hover:bg-brand-400/10" data-testid="drive-upload-another">
              העלאה נוספת
            </button>
          )}
        </div>
      </div>
    );
  }
  if (!status.connected) {
    return (
      <div className="rounded-lg border border-dashed border-gray-600 p-4 text-center" data-testid="drive-connect">
        <p className="text-sm font-semibold text-white">{status.error ? "החיבור לגוגל דרייב נותק" : "מחברים את הגוגל דרייב שלך, פעם אחת"}</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-gray-400">המערכת תוכל ליצור תיקיות ולהעלות אליהן, ורק לתיקיות שהיא עצמה יצרה. שאר הדרייב שלך לא נגיש לה. הגלריות ייכנסו לתיקייה חדשה, "גלריות אווירה".</p>
        <button
          type="button"
          onClick={() => connectDrive(location.pathname).catch((e) => toast.error(e.message))}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-brand-400 px-3 py-1.5 text-sm font-semibold text-brand-fg hover:bg-brand-500"
          data-testid="drive-connect-btn"
        >
          <PlugZap className="h-4 w-4" /> {status.error ? "חיבור מחדש לגוגל דרייב" : "חיבור לגוגל דרייב"}
        </button>
      </div>
    );
  }

  const free = quota?.limit ? quota.limit - quota.used : null;
  return (
    <div className="space-y-3" data-testid="drive-panel">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          choose(filesFromDrop(e.dataTransfer));
        }}
        className={`rounded-lg border-2 border-dashed p-4 text-center text-sm transition ${over ? "border-brand-400 bg-brand-400/10 text-brand-100" : "border-gray-600 text-gray-300"}`}
        data-testid="drive-drop"
      >
        {reading ? (
          <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> קורא את התיקייה…</span>
        ) : plan ? (
          <>
            <FolderDown className="mx-auto mb-1 h-5 w-5" />
            גוררים לכאן עוד תיקיות, או{" "}
            <button type="button" onClick={() => inputRef.current?.click()} className="text-brand-300 underline">
              מוסיפים תיקייה מהמחשב
            </button>
            . הן מצטרפות לרשימה.
          </>
        ) : (
          <>
            <FolderDown className="mx-auto mb-1 h-5 w-5" />
            גוררים לכאן את התיקיות שמעלים (צלם ראשון, צלם שני, טיזר…), אחת או כמה ביחד, או{" "}
            <button type="button" onClick={() => inputRef.current?.click()} className="text-brand-300 underline">
              בוחרים מהמחשב
            </button>
          </>
        )}
        {/* The Mac's window picks one folder: the value is cleared, so the next pick (even the same folder) is read too. */}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          webkitdirectory=""
          multiple
          onChange={(e) => {
            choose(filesFromInput(e.target.files));
            e.target.value = "";
          }}
          data-testid="drive-input"
        />
      </div>

      {plan && (
        <div className="space-y-3 rounded-lg border border-gray-700 p-3 text-sm">
          <p className="text-xs text-gray-400">
            יעלה לדרייב אל:{" "}
            <span className="text-gray-200">
              {target.folderId ? `התיקייה של הגלריה בדרייב (מוסיף אליה)` : [...(drivePath(date) || ["גלריות אווירה"]), galleryFolderName(coupleName, date)].join(" › ")}
            </span>
            {!target.folderId && existingFolderUrl && target.checked && <span className="block text-amber-300">לגלריה כבר יש קישור לתיקייה אחרת. ההעלאה תיצור תיקייה חדשה בדרייב, והגלריה תיטען ממנה.</span>}
            {!target.folderId && drivePath(date) && !(status.helperVersion >= 2) && (
              <span className="block text-amber-300" data-testid="drive-helper-old">
                כדי שהתיקייה תעבור לשם, מעדכנים פעם אחת את עוזר הדרייב: הגדרות ← חיבורים ← עוזר הדרייב ← "צור סקריפט חדש", ומדביקים אותו ב-script.google.com במקום הקודם. עד אז היא מחכה ב"גלריות אווירה".
              </span>
            )}
          </p>
          <div className="divide-y divide-gray-800 text-xs">
            {plan.groups.map((g) => (
              <div key={g.name || "-"} className="flex items-center justify-between gap-3 py-1" data-testid="drive-group">
                <span className="min-w-0 text-gray-200">
                  {g.name ? `📁 ${g.name}` : "ישר בתיקיית האירוע"}
                  {g.folders > 0 && <span className="text-gray-500"> · {g.folders === 1 ? "תיקייה אחת בתוכה" : `${g.folders} תיקיות בתוכה`}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-gray-400">
                  {photosText(g.count)}
                  <button
                    type="button"
                    onClick={() => setPicked((p) => withoutFolder(p, g.name))}
                    title="להוריד מהרשימה"
                    aria-label={`הורדת ${g.name || "התמונות שבלי תיקייה"} מהרשימה`}
                    className="rounded p-1 text-gray-500 hover:bg-red-500/10 hover:text-red-300"
                    data-testid="drive-group-remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
            ))}
            <div className="flex justify-between py-1 font-semibold text-white">
              <span>סה״כ</span>
              <span>
                {photosText(plan.count)} · {sizeText(plan.bytes)}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={reading}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-600 px-2.5 py-1 text-xs text-gray-200 hover:border-gray-400 disabled:opacity-50"
            data-testid="drive-add-folder"
          >
            <FolderPlus className="h-3.5 w-3.5" /> הוספת תיקייה
          </button>
          {plan.deep > 0 && <p className="text-xs text-amber-300">{photosText(plan.deep)} יותר מ-{READ_DEPTH} תיקיות פנימה: הן יעלו לדרייב, אבל הגלריה לא תקרא אותן.</p>}
          {plan.skipped > 0 && <p className="text-xs text-gray-500">{plan.skipped === 1 ? "קובץ אחד שאינו תמונה לא יעלה." : `${plan.skipped.toLocaleString("he-IL")} קבצים שאינם תמונות לא יעלו.`}</p>}

          <div>
            <p className="mb-1.5 text-xs text-gray-400">של מי החומרים? (מצוות האירוע, כמו בסטטוס עבודה)</p>
            {team.length ? (
              <div className="flex flex-col gap-2">
                {team.map((m) => {
                  const on = roles.includes(m.role);
                  const more = later.includes(m.role);
                  const seg = (active, tone) => `px-2.5 py-1 ${active ? tone : "text-gray-400 hover:text-gray-200"}`;
                  return (
                    <div key={m.role} className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setRoles((r) => (on ? r.filter((x) => x !== m.role) : [...r, m.role]))}
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${on ? "border-brand-400 bg-brand-400/15 text-white ring-1 ring-brand-400" : "border-gray-600 text-gray-300 hover:border-gray-400"}`}
                        aria-pressed={on}
                        data-testid={`drive-role-${m.role}`}
                      >
                        <Camera className="h-3.5 w-3.5" /> {on ? "✓ " : ""}
                        {m.label}
                        {m.name ? ` · ${m.name}` : ""}
                      </button>
                      {/* All of his materials, or more to come (2026-11-09): only "all" is marked "done" at the end. */}
                      {on && (
                        <span className="inline-flex overflow-hidden rounded-md border border-gray-600 text-xs" role="group" aria-label={`החומרים של ${m.name || m.label}`}>
                          <button type="button" onClick={() => setLater((l) => l.filter((x) => x !== m.role))} aria-pressed={!more} className={seg(!more, "bg-green-500/20 text-green-300")} data-testid={`drive-all-${m.role}`}>
                            כל החומרים שלו
                          </button>
                          <button type="button" onClick={() => setLater((l) => (more ? l : [...l, m.role]))} aria-pressed={more} className={seg(more, "bg-amber-400/20 text-amber-200")} data-testid={`drive-later-${m.role}`}>
                            יהיו עוד בהמשך
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-500">{eventId ? "באירוע אין צלמים בצוות." : "הגלריה לא מקושרת לאירוע, אז שום צלם לא יסומן בסטטוס עבודה. אפשר לבחור אירוע ב\"פרטי הזוג\"."}</p>
            )}
            {roles.length > 0 && (
              <p className="mt-1.5 text-[11px] text-gray-500">
                כשההעלאה מסתיימת, מי שסימנת "כל החומרים שלו" נצבע בירוק בסטטוס עבודה. מי שסימנת "יהיו עוד בהמשך" נשאר אדום, ובסוף יופיע כפתור לסמן אותו.
              </p>
            )}
          </div>

          {!onReady && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={start} disabled={!target.checked} className="inline-flex items-center gap-1.5 rounded-md bg-brand-400 px-3 py-1.5 text-sm font-semibold text-brand-fg hover:bg-brand-500 disabled:opacity-50" data-testid="drive-start">
                <Upload className="h-4 w-4" /> העלאה לדרייב
              </button>
              <button type="button" onClick={() => setPicked([])} className="text-xs text-gray-400 hover:text-white">
                ביטול
              </button>
              {free != null && (
                <span className={`text-xs ${free < plan.bytes ? "text-red-300" : "text-gray-400"}`}>
                  {free < plan.bytes ? `אין מספיק מקום בדרייב: פנוי ${sizeText(free)}` : `בדרייב פנוי ${sizeText(free)}`}
                </span>
              )}
            </div>
          )}
          {onReady && <p className="text-xs text-brand-200">ההעלאה תתחיל כשלוחצים "יצירת הגלריה".</p>}
        </div>
      )}
      <p className="text-[11px] text-gray-500">
        מחובר: {status.email || "גוגל דרייב"} · ההעלאה רצה ברקע, ואפשר לעבור בין הדפים בזמן שהיא רצה.
      </p>
    </div>
  );
}
