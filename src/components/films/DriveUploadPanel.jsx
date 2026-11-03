import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Camera, FolderDown, Loader2, PlugZap, Upload } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { appFolderOf, connectDrive, driveQuota, driveStatus, filesFromDrop, filesFromInput, isOpen, jobFor, startUpload, subscribe } from "@/lib/driveUpload";
import { photosText, planUpload, sizeText, teamPhotographers } from "@/lib/driveUploadPlan";
import { DriveJobButtons, DriveJobProgress } from "@/components/DriveUploadPill";

// "העלאה מהמחשב לגוגל דרייב" on a photo gallery (Avira, 2026-11-03, the owner's request; src/lib/driveUpload.js): the
// wedding's folder is dropped here, its sub-folders are the sets; whose materials they are (the event's photographers,
// as on work status — marked "done" there at the end); then the upload runs in the background.
// `galleryId` null = a new gallery not saved yet: `onReady({ plan, roles })` hands the choice to the form, which starts
// the upload once the gallery is made.
export default function DriveUploadPanel({ galleryId = null, coupleName = "", date = "", eventId = null, existingFolderUrl = "", onReady = null }) {
  const location = useLocation();
  const [status, setStatus] = useState(null); // { connected, email } | { failed }
  const [plan, setPlan] = useState(null);
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);
  const [team, setTeam] = useState([]);
  const [roles, setRoles] = useState([]);
  const [quota, setQuota] = useState(null);
  const [target, setTarget] = useState({ checked: false, folderId: null });
  const [job, setJob] = useState(() => (galleryId ? jobFor(galleryId) : null));
  const inputRef = useRef(null);

  useEffect(() => (galleryId ? subscribe(() => setJob(jobFor(galleryId))) : undefined), [galleryId]);
  useEffect(() => {
    let live = true;
    driveStatus()
      .then((s) => live && setStatus(s || { failed: true }))
      .catch(() => live && setStatus({ failed: true }));
    return () => {
      live = false;
    };
  }, []);
  // The event's photographers, as work status shows them; "צלם 1" chosen at first.
  useEffect(() => {
    if (!eventId) return setTeam([]);
    let live = true;
    supabase
      .from("events")
      .select("team")
      .eq("id", eventId)
      .maybeSingle()
      .then(({ data }) => {
        if (!live) return;
        const t = teamPhotographers(data?.team);
        setTeam(t);
        setRoles(t.length ? [t[0].role] : []);
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

  const choose = async (files) => {
    setReading(true);
    try {
      const p = planUpload(await files);
      if (!p.count) {
        toast.error("לא נמצאו תמונות בתיקייה (JPG, PNG, HEIC…)");
        return;
      }
      setPlan(p);
      onReady?.({ plan: p, roles });
    } catch {
      toast.error("לא הצלחנו לקרוא את התיקייה. גוררים אותה שוב, או בוחרים אותה מהמחשב.");
    } finally {
      setReading(false);
    }
  };
  useEffect(() => {
    if (plan) onReady?.({ plan, roles });
  }, [roles]);

  const start = () => {
    try {
      startUpload({ galleryId, coupleName, date, eventId, roles, plan, folderId: target.folderId });
      setPlan(null);
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
          {isOpen(job) ? <span className="text-[11px] text-gray-500">אפשר לעבור לדפים אחרים, ההעלאה ממשיכה (פס למטה במסך).</span> : null}
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
        ) : (
          <>
            <FolderDown className="mx-auto mb-1 h-5 w-5" />
            גוררים לכאן את התיקייה של החתונה (עם תיקיות הסטים), או{" "}
            <button type="button" onClick={() => inputRef.current?.click()} className="text-brand-300 underline">
              בוחרים מהמחשב
            </button>
          </>
        )}
        <input ref={inputRef} type="file" className="hidden" webkitdirectory="" multiple onChange={(e) => choose(filesFromInput(e.target.files))} data-testid="drive-input" />
      </div>

      {plan && (
        <div className="space-y-3 rounded-lg border border-gray-700 p-3 text-sm">
          <p className="text-xs text-gray-400">
            יעלה לדרייב אל: <span className="text-gray-200">{target.folderId ? "התיקייה של הגלריה בדרייב (מוסיף אליה)" : `גלריות אווירה › ${coupleName || "הגלריה"}`}</span>
            {!target.folderId && existingFolderUrl && target.checked && <span className="block text-amber-300">לגלריה כבר יש קישור לתיקייה אחרת. ההעלאה תיצור תיקייה חדשה בדרייב, והגלריה תיטען ממנה.</span>}
          </p>
          <div className="divide-y divide-gray-800 text-xs">
            {plan.sets.map((s) => (
              <div key={s.name} className="flex justify-between py-1">
                <span className="text-gray-200">{s.name}</span>
                <span className="text-gray-400">{photosText(s.files.length)}</span>
              </div>
            ))}
            {plan.loose.length > 0 && (
              <div className="flex justify-between py-1">
                <span className="text-gray-200">בלי סט (ישר בתיקייה)</span>
                <span className="text-gray-400">{photosText(plan.loose.length)}</span>
              </div>
            )}
            <div className="flex justify-between py-1 font-semibold text-white">
              <span>סה״כ</span>
              <span>
                {photosText(plan.count)} · {sizeText(plan.bytes)}
              </span>
            </div>
          </div>
          {plan.skipped > 0 && <p className="text-xs text-gray-500">{plan.skipped === 1 ? "קובץ אחד שאינו תמונה לא יעלה." : `${plan.skipped.toLocaleString("he-IL")} קבצים שאינם תמונות לא יעלו.`}</p>}

          <div>
            <p className="mb-1.5 text-xs text-gray-400">של מי החומרים? (מצוות האירוע, כמו בסטטוס עבודה)</p>
            {team.length ? (
              <div className="flex flex-wrap gap-2">
                {team.map((m) => {
                  const on = roles.includes(m.role);
                  return (
                    <button
                      key={m.role}
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
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-500">{eventId ? "באירוע אין צלמים בצוות." : "הגלריה לא מקושרת לאירוע, אז שום צלם לא יסומן בסטטוס עבודה. אפשר לבחור אירוע ב\"פרטי הזוג\"."}</p>
            )}
            {roles.length > 0 && <p className="mt-1.5 text-[11px] text-gray-500">כשההעלאה מסתיימת, הקובייה שלו בסטטוס עבודה הופכת לירוקה.</p>}
          </div>

          {!onReady && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={start} disabled={!target.checked} className="inline-flex items-center gap-1.5 rounded-md bg-brand-400 px-3 py-1.5 text-sm font-semibold text-brand-fg hover:bg-brand-500 disabled:opacity-50" data-testid="drive-start">
                <Upload className="h-4 w-4" /> העלאה לדרייב
              </button>
              <button type="button" onClick={() => setPlan(null)} className="text-xs text-gray-400 hover:text-white">
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
