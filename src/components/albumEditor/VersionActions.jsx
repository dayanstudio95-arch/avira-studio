import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, Link2, Loader2, Send } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { ensurePortalLink, restorePortalLink } from "@/lib/albumPortalLink";
import { getCachedPortalTokenRaw } from "@/lib/albumPortalTokenCache";
import { generateRawToken, hashToken } from "@/lib/albumTokens";
import { friendlySendError } from "@/lib/sendErrors";

const LINK_MARK = "{{link}}";
// Same message as "💌 שלח לזוג" on the order page (Settings → תבניות → "שליחת קישור לבדיקת אלבום").
const DEFAULT_TPL = `שלום {{names}} 😊\nהכנו עבורכם תצוגה מקדימה של האלבום לצפייה ואישור 💛\n{{link}}`;
const SKETCH_KEY = (versionId) => `album_sketch_link:${versionId}`;

const readSketch = (versionId) => {
  try {
    return JSON.parse(localStorage.getItem(SKETCH_KEY(versionId)) || "null");
  } catch {
    return null;
  }
};
const saveSketch = (versionId, v) => {
  try {
    localStorage.setItem(SKETCH_KEY(versionId), JSON.stringify(v));
  } catch {
    /* private mode — the link is just not shown again after a refresh */
  }
};

// What to do with an exported version, from the album editor (2026-11-05, the owner's request):
// - "💌 שליחה לזוג": the order page's "שלח לזוג" message with the couple's link — editable, sent only on "שלח".
//   The link is the one this browser has; otherwise a new one is made (ensurePortalLink) and, if the message
//   fails, the old one is put back.
// - "🔗 קישור להורדה באיכות מלאה": a print_access_links row pinned to THIS version (0111) — the print shop's
//   download page, for a sketch the couple hasn't approved yet. The raw token is shown once and kept in this
//   browser only (the DB holds its hash).
export default function VersionActions({ order, names, phone, versionId, versionNumber }) {
  const [open, setOpen] = useState(null); // "send" | null
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [otherLink, setOtherLink] = useState(false); // the couple has a link this browser doesn't know
  const [sketch, setSketch] = useState(null); // { linkId, raw }
  const [making, setMaking] = useState(false);

  useEffect(() => {
    const cached = readSketch(versionId);
    if (!cached?.linkId) return;
    base44.entities.PrintAccessLink.filter({ id: cached.linkId })
      .then(([row]) => row && !row.revokedAt && setSketch(cached))
      .catch(() => {});
  }, [versionId]);

  useEffect(() => {
    if (open !== "send" || !order) return;
    (async () => {
      const rows = await base44.entities.AppSetting.filter({ key: "template_album_portal_link" }).catch(() => []);
      setText((rows?.[0]?.value || DEFAULT_TPL).replace(/\{\{names\}\}/g, names || ""));
      const cached = getCachedPortalTokenRaw(order.id);
      const active = order.portalTokenHash && !order.portalTokenRevokedAt && order.source !== "couple_designer";
      setOtherLink(Boolean(active && (!cached || (await hashToken(cached)) !== order.portalTokenHash)));
    })();
  }, [open, order, names]);

  const send = async () => {
    if (!phone || !text.trim() || sending) return;
    setSending(true);
    let link = null;
    let fresh = order;
    try {
      fresh = (await base44.entities.AlbumOrder.get(order.id)) || order; // the hash as it is now, not as the editor loaded it
      link = await ensurePortalLink(fresh);
      const message = text.includes(LINK_MARK) ? text.replace(LINK_MARK, link.url) : `${text.trim()}\n${link.url}`;
      const res = await base44.functions.invoke("sendWhatsAppMessage", { to: phone, message });
      if (res?.data?.error) throw new Error(res.data.error);
      setSent(true);
      setOpen(null);
      toast.success(`נשלח ל${names || "זוג"} בוואטסאפ`);
    } catch (e) {
      console.error("send to couple failed:", e);
      if (link?.minted) await restorePortalLink(fresh, link.previous).catch((err) => console.error("restore link failed:", err));
      toast.error("השליחה נכשלה", { description: friendlySendError(e?.message) });
    }
    setSending(false);
  };

  const makeSketchLink = async () => {
    setMaking(true);
    try {
      const raw = generateRawToken();
      const row = await base44.entities.PrintAccessLink.create({ albumOrderId: order.id, versionId, tokenHash: await hashToken(raw) });
      const v = { linkId: row.id, raw };
      saveSketch(versionId, v);
      setSketch(v);
      toast.success("נוצר קישור להורדה");
    } catch (e) {
      toast.error(e?.message || "יצירת הקישור נכשלה");
    }
    setMaking(false);
  };

  const sketchUrl = sketch ? `${window.location.origin}/print-access/${sketch.raw}` : "";
  const copy = async (t) => {
    try {
      await navigator.clipboard.writeText(t);
      toast.success("הקישור הועתק");
    } catch {
      toast.error("ההעתקה נכשלה — סמנו את הקישור והעתיקו ידנית");
    }
  };

  return (
    <div className="space-y-2" data-testid="version-actions">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => (o === "send" ? null : "send"))}
          className={`flex h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold ${sent ? "border border-emerald-400/60 text-emerald-200" : "bg-green-600 text-white hover:bg-green-700"}`}
          data-testid="va-send-open"
        >
          <Send className="h-4 w-4" /> {sent ? "✓ נשלח לזוג" : "שליחה לזוג"}
        </button>
        <button
          type="button"
          onClick={sketch ? () => copy(sketchUrl) : makeSketchLink}
          disabled={making}
          title={`קישור להורדת כל הכפולות של גרסה ${versionNumber} בגודל הדפסה מלא — עובד גם לפני שהזוג אישר`}
          className="flex h-10 items-center justify-center gap-1.5 rounded-lg border border-sky-400/50 text-sm text-sky-100 hover:bg-sky-400/10 disabled:opacity-50"
          data-testid="va-link"
        >
          {making ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} {sketch ? "העתקת הקישור להורדה" : "קישור להורדה באיכות מלאה"}
        </button>
      </div>

      {sketch && (
        <div className="space-y-1 rounded-lg bg-white/[0.04] p-2.5" data-testid="va-link-box">
          <div className="text-[11px] text-slate-400">הורדת גרסה {versionNumber} באיכות מלאה (ZIP), גם לפני אישור הזוג:</div>
          <div className="flex gap-1.5">
            <input readOnly value={sketchUrl} dir="ltr" onFocus={(e) => e.target.select()} className="h-8 min-w-0 flex-1 rounded border border-white/10 bg-[#070F1F] px-2 text-xs text-white" data-testid="va-link-url" />
            <button type="button" onClick={() => copy(sketchUrl)} title="העתקה" className="rounded border border-white/10 px-2 text-slate-300 hover:bg-white/10"><Copy className="h-3.5 w-3.5" /></button>
            <a href={sketchUrl} target="_blank" rel="noreferrer" title="פתיחה" className="flex items-center rounded border border-white/10 px-2 text-slate-300 hover:bg-white/10"><ExternalLink className="h-3.5 w-3.5" /></a>
          </div>
          <div className="text-[10px] text-slate-500">הקישור מוצג רק בדפדפן הזה. אפשר לבטל אותו בדף ההזמנה ← "קישור למעבדת הדפסה".</div>
        </div>
      )}

      {open === "send" && (
        <div className="space-y-2 rounded-lg border border-white/10 p-2.5" data-testid="va-send-box">
          <div className="text-xs text-slate-400">{phone ? <>יישלח בוואטסאפ ל-<span dir="ltr">{phone}</span></> : "אין טלפון להזמנה הזו (באירוע או בהזמנה) — אי אפשר לשלוח."}</div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} disabled={sending} className="w-full rounded-lg border border-white/10 bg-[#070F1F] p-2 text-sm text-white" data-testid="va-send-text" />
          <div className="text-[10px] text-slate-500">{LINK_MARK} יוחלף בקישור של הזוג. הנוסח הקבוע: הגדרות ← תבניות ← "שליחת קישור לבדיקת אלבום".</div>
          {otherLink && <div className="text-[11px] text-amber-300">לזוג כבר יש קישור שנוצר במחשב או בדפדפן אחר. השליחה תיצור קישור חדש, והקודם יפסיק לעבוד (ההערות של הזוג נשמרות).</div>}
          <button type="button" onClick={send} disabled={sending || !phone || !text.trim()} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-green-600 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40" data-testid="va-send">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} שלח
          </button>
        </div>
      )}
    </div>
  );
}
