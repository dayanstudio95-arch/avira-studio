import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, ChevronUp, CloudUpload, Pause, Play, X } from "lucide-react";
import { dismissUpload, isOpen, pauseUpload, resumeUpload, subscribe } from "@/lib/driveUpload";
import { etaText, sizeText } from "@/lib/driveUploadPlan";

// The Drive upload in the background (Avira, 2026-11-03, src/lib/driveUpload.js): a small pill at the bottom of every
// page while a gallery uploads, opened for its sets, pause / go on, and the result. Also says how the Google Drive
// connection went when Google sends the browser back (?drive=connected / ?drive_error=…).
const PHASE = { queued: "ממתין בתור", preparing: "מכין את התיקיות בדרייב…", uploading: "מעלה לדרייב", paused: "מושהה", finishing: "טוען את התמונות לגלריה…", done: "עלה לדרייב", error: "ההעלאה נעצרה" };
const CONNECT_ERRORS = { access_denied: "החיבור לגוגל דרייב בוטל.", no_drive_scope: "בחלון של גוגל לא אושרה הגישה לדרייב. מתחברים שוב ומסמנים את האישור לדרייב.", no_refresh_token: "גוגל לא השלימה את החיבור. מתחברים שוב." };

export function DriveJobProgress({ job, compact = false }) {
  const live = job.liveBytes ?? job.bytesDone;
  const pct = job.bytesTotal ? Math.min(100, Math.round((live / job.bytesTotal) * 100)) : job.total ? Math.round((job.done / job.total) * 100) : 0;
  const eta = job.phase === "uploading" ? etaText(job.bytesTotal - live, job.speed) : "";
  return (
    <div className="space-y-1.5" data-testid="drive-job">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold text-white">
          {PHASE[job.phase]}
          {job.phase === "uploading" || job.phase === "paused" ? ` · ${pct}%` : ""}
        </span>
        <span className="text-xs text-gray-400" dir="rtl">
          {job.done.toLocaleString("he-IL")} מתוך {job.total.toLocaleString("he-IL")} · {sizeText(live)} מתוך {sizeText(job.bytesTotal)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-gray-800">
        <div className={`h-full ${job.phase === "done" ? "bg-green-500" : job.phase === "error" ? "bg-red-500" : "bg-brand-400"}`} style={{ width: `${job.phase === "done" ? 100 : pct}%` }} />
      </div>
      {(eta || job.speed > 0) && job.phase === "uploading" && (
        <div className="text-xs text-gray-400">
          {sizeText(job.speed)} בשנייה{eta ? ` · ${eta}` : ""}
        </div>
      )}
      {!compact && job.sets.length > 0 && (
        <div className="divide-y divide-gray-800 text-xs">
          {job.sets.map((s) => (
            <div key={s.name} className="flex items-center gap-2 py-1">
              <span className="flex-1 truncate text-gray-300">{s.name || "ישר בתיקיית האירוע"}</span>
              {s.done >= s.total ? <span className="text-green-400">✓ {s.total}</span> : <span className="text-gray-500">{s.done}/{s.total}</span>}
            </div>
          ))}
        </div>
      )}
      {job.error && <p className="text-xs text-red-300">{job.error}</p>}
      {job.note && <p className="text-xs text-amber-300">{job.note}</p>}
      {job.filedTo && job.phase !== "error" && (
        <p className="text-xs text-gray-400">
          {job.helperOld ? "עוזר הדרייב צריך עדכון כדי להעביר את התיקייה אל " : "עוזר הדרייב יעביר את התיקייה תוך כמה דקות אל "}
          {[...job.filedTo, job.folderName].join(" › ")}
        </p>
      )}
      {job.phase === "done" && (
        <p className="text-xs text-green-300">
          {job.total.toLocaleString("he-IL")} תמונות בדרייב, התיקייה שותפה בקישור{job.loaded ? " והתמונות נטענו לגלריה" : ""}
          {job.marked?.length ? ` · ${job.marked.join(" ו")} ${job.marked.length > 1 ? "סומנו" : "סומן"} בסטטוס עבודה` : ""}.
        </p>
      )}
    </div>
  );
}

export function DriveJobButtons({ job }) {
  return (
    <div className="flex flex-wrap gap-2">
      {job.phase === "uploading" && (
        <button type="button" onClick={() => pauseUpload(job)} className="flex items-center gap-1 rounded-md border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-gray-800" data-testid="drive-pause">
          <Pause className="h-3.5 w-3.5" /> השהיה
        </button>
      )}
      {(job.phase === "paused" || job.phase === "error") && (
        <button type="button" onClick={() => resumeUpload(job)} className="flex items-center gap-1 rounded-md border border-brand-400/60 px-2 py-1 text-xs text-brand-200 hover:bg-brand-400/10" data-testid="drive-resume">
          <Play className="h-3.5 w-3.5" /> {job.phase === "error" ? "לנסות שוב" : "להמשיך"}
        </button>
      )}
      {job.folderUrl && (
        <a href={job.folderUrl} target="_blank" rel="noopener noreferrer" className="rounded-md border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800">
          פתיחה בדרייב
        </a>
      )}
    </div>
  );
}

export default function DriveUploadPill() {
  const [jobs, setJobs] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => subscribe(setJobs), []);
  // Back from Google's consent page.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (!p.has("drive") && !p.has("drive_error")) return;
    if (p.get("drive") === "connected") toast.success("גוגל דרייב מחובר. אפשר להעלות גלריות.");
    else toast.error(CONNECT_ERRORS[p.get("drive_error")] || "החיבור לגוגל דרייב לא הצליח. מנסים שוב.");
    p.delete("drive");
    p.delete("drive_error");
    const qs = p.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
  }, []);
  const job = jobs.find((j) => isOpen(j) && j.phase !== "queued") || jobs.find(isOpen) || jobs[jobs.length - 1];
  if (!job) return null;
  const waiting = jobs.filter((j) => j !== job && j.phase === "queued").length;
  const live = job.liveBytes ?? job.bytesDone;
  const pct = job.bytesTotal ? Math.min(100, Math.round((live / job.bytesTotal) * 100)) : 0;
  return (
    <div className="fixed bottom-4 left-1/2 z-[70] w-[min(92vw,420px)] -translate-x-1/2 rounded-xl border border-gray-700 bg-gray-900/95 shadow-2xl shadow-black/60 backdrop-blur" dir="rtl" data-testid="drive-pill">
      <div className="flex items-center gap-2 px-3 py-2">
        {job.phase === "done" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-400" /> : <CloudUpload className={`h-4 w-4 shrink-0 ${job.phase === "error" ? "text-red-400" : "text-brand-300"}`} />}
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-right">
          <div className="truncate text-sm text-white">
            {PHASE[job.phase]} · {job.coupleName}
            {job.phase === "uploading" || job.phase === "paused" ? ` · ${pct}%` : ""}
          </div>
          {job.phase !== "done" && (
            <div className="mt-1 h-1 overflow-hidden rounded bg-gray-800">
              <div className={`h-full ${job.phase === "error" ? "bg-red-500" : "bg-brand-400"}`} style={{ width: `${pct}%` }} />
            </div>
          )}
        </button>
        {waiting > 0 && <span className="text-[11px] text-gray-400">ועוד {waiting} בתור</span>}
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-gray-400 hover:text-white" aria-label={open ? "סגירה" : "פתיחה"}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
        {!isOpen(job) && (
          <button type="button" onClick={() => dismissUpload(job)} className="text-gray-500 hover:text-white" aria-label="הסתרה" data-testid="drive-pill-close">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-3 border-t border-gray-800 px-3 py-3">
          <DriveJobProgress job={job} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <DriveJobButtons job={job} />
            <Link to={`/${job.galleryKind === "films" ? "films" : "photos"}/${job.galleryId}`} className="text-xs text-brand-300 hover:underline">
              לעמוד הגלריה
            </Link>
          </div>
          {isOpen(job) && <p className="text-[11px] text-gray-500">אפשר לעבור בין הדפים, ההעלאה ממשיכה. רק לא לסגור או לרענן את הלשונית.</p>}
        </div>
      )}
    </div>
  );
}
