import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { downloadZip } from "client-zip";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, FileDown, CheckCircle2, ImageOff } from "lucide-react";

// Public, no-login print-shop file-download page -- /print-access/:token.
// Delivers only the order's APPROVED spreads. Never builds a ZIP server-side --
// streams each spread's signed Storage URL straight into a client-side ZIP via
// client-zip, per CLAUDE.md's iron rule (Edge Functions here are capped at
// ~2s CPU / 400s wall-clock, unreliable for 30-40+ full-resolution files).

function formatDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString("he-IL", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return value;
  }
}

export default function AlbumPrintAccess() {
  const { token } = useParams();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState(null);

  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [downloadError, setDownloadError] = useState("");
  const [downloadDone, setDownloadDone] = useState(false);

  useEffect(() => {
    (async () => {
      if (!token) {
        setError("קישור לא תקין");
        setIsLoading(false);
        return;
      }
      try {
        const res = await base44.functions.invoke("albumPrintAccess", { token, action: "validate" });
        setInfo(res.data);
      } catch (e) {
        setError(e?.message || "אירעה שגיאה בטעינת הקישור");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [token]);

  // Spreads are 15-30MB each and an album can have 30-40+ of them, so nothing may be held in
  // memory all at once (2026-10-08: the old code fetched every file into a Blob first —
  // 30 x 30MB = ~1GB of RAM before the ZIP even started).
  //   - Chrome/Edge: the ZIP is written straight to a file the print shop picks
  //     (showSaveFilePicker); each spread is fetched only when client-zip reaches it.
  //   - Other browsers: "one by one" saves each spread as its own file, one at a time.
  // File names are 001.jpg, 002.jpg, … in album order (two digits broke past 99).
  const numberedName = (f, i) => {
    const ext = (String(f.fileName || "").match(/\.[a-z0-9]+$/i) || [".jpg"])[0].toLowerCase();
    return `${String(i + 1).padStart(3, "0")}${ext}`;
  };
  const safeZipName = () => `${(info?.coupleNames || "album").replace(/[^\u0590-\u05FFa-zA-Z0-9\-_ ]/g, "").trim() || "album"}.zip`;
  const canStream = typeof window !== "undefined" && typeof window.showSaveFilePicker === "function";

  const listFiles = async () => {
    const res = await base44.functions.invoke("albumPrintAccess", { token, action: "listFiles" });
    return res.data?.files || [];
  };

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError("");
    setDownloadDone(false);
    try {
      // Ask where to save first — the picker needs the click's user activation.
      const handle = canStream ? await window.showSaveFilePicker({ suggestedName: safeZipName(), types: [{ description: "ZIP", accept: { "application/zip": [".zip"] } }] }) : null;
      const files = await listFiles();
      if (!files.length) {
        setDownloadError("לא נמצאו קבצים להורדה");
        setDownloading(false);
        return;
      }
      setProgress({ done: 0, total: files.length });

      async function* entries() {
        for (const [i, f] of files.entries()) {
          const fileRes = await fetch(f.signedUrl);
          if (!fileRes.ok) throw new Error(`הורדת הקובץ ${numberedName(f, i)} נכשלה`);
          yield { name: numberedName(f, i), input: fileRes };
          setProgress((p) => ({ ...p, done: i + 1 }));
        }
      }

      const zipResponse = downloadZip(entries());
      if (handle) {
        const writable = await handle.createWritable();
        await zipResponse.body.pipeTo(writable);
      } else {
        // No streaming to disk in this browser — fine for a small album; the "one by one"
        // button below is the safe path for big ones.
        const zipBlob = await zipResponse.blob();
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = safeZipName();
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
      setDownloadDone(true);
    } catch (e) {
      if (e?.name === "AbortError") { setDownloading(false); return; } // picker cancelled
      setDownloadError(e?.message || "שגיאה בהורדת הקבצים");
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadOneByOne = async () => {
    setDownloading(true);
    setDownloadError("");
    setDownloadDone(false);
    try {
      const files = await listFiles();
      setProgress({ done: 0, total: files.length });
      for (const [i, f] of files.entries()) {
        const fileRes = await fetch(f.signedUrl);
        if (!fileRes.ok) throw new Error(`הורדת הקובץ ${numberedName(f, i)} נכשלה`);
        const url = URL.createObjectURL(await fileRes.blob());
        const a = document.createElement("a");
        a.href = url;
        a.download = numberedName(f, i);
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        setProgress((p) => ({ ...p, done: i + 1 }));
        await new Promise((r) => setTimeout(r, 600));
      }
      setDownloadDone(true);
    } catch (e) {
      setDownloadError(e?.message || "שגיאה בהורדת הקבצים");
    } finally {
      setDownloading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="e-page min-h-screen bg-gray-950 flex items-center justify-center" dir="rtl">
        <Loader2 className="w-10 h-10 text-yellow-400 animate-spin" />
      </div>
    );
  }

  if (!info) {
    return (
      <div className="e-page min-h-screen bg-gray-950 flex items-center justify-center p-6" dir="rtl">
        <div className="max-w-md w-full bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center space-y-3">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto" />
          <h1 className="text-lg font-bold text-white">לא ניתן להציג את הקישור</h1>
          <p className="text-gray-400 text-sm">{error || "קישור לא תקין"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="e-page min-h-screen bg-gray-950 flex items-center justify-center p-6" dir="rtl">
      <div className="max-w-md w-full bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center space-y-5">
        <h1 className="text-xl font-bold text-white">{info.coupleNames || "הזמנת אלבום"}</h1>
        {info.weddingDate && <p className="text-gray-400 text-sm">{formatDate(info.weddingDate)}</p>}

        {!info.ready ? (
          <div className="flex flex-col items-center gap-2 text-gray-400 text-sm py-4">
            <ImageOff className="w-8 h-8 text-gray-600" />
            <p>האלבום עדיין לא אושר על ידי הזוג. הקישור יהיה זמין להורדה לאחר האישור.</p>
          </div>
        ) : (
          <>
            {downloading && progress.total > 0 && (
              <p className="text-gray-400 text-sm">
                מוריד קבצים... {progress.done}/{progress.total}
              </p>
            )}
            {downloadError && <p className="text-red-400 text-sm">{downloadError}</p>}
            {downloadDone && (
              <p className="text-green-400 text-sm flex items-center justify-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> ההורדה הושלמה
              </p>
            )}
            <Button
              type="button"
              disabled={downloading}
              onClick={handleDownload}
              className="w-full bg-yellow-400 text-gray-900 hover:bg-yellow-500 h-12 text-base font-bold flex items-center justify-center gap-2"
            >
              {downloading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileDown className="w-5 h-5" />}
              {downloading ? "מוריד..." : "הורדת כל הקבצים (ZIP)"}
            </Button>
            <button
              type="button"
              disabled={downloading}
              onClick={handleDownloadOneByOne}
              className="w-full text-sm text-gray-400 underline hover:text-white disabled:opacity-50"
            >
              או: הורדת הקבצים אחד-אחד (001.jpg, 002.jpg…)
            </button>
            {!canStream && (
              <p className="text-xs text-gray-500">לאלבום גדול מומלץ להוריד מ-Chrome או Edge, או להשתמש בהורדה אחד-אחד.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
