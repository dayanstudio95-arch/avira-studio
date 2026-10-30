import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2, Monitor, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { COLOR_STYLES, COLORS, COVER_LABELS, COVERS, DEFAULT_DESIGN, FONT_STYLES, FONTS, cleanDesign } from "@films-shared/design";
import { FILMS_BASE_URL, filmsApi, photoUrl } from "@/lib/filmsApi";
import { Button } from "@/components/ui/button";
import "./DesignEditor.css";

// "עיצוב הגלריה": the couple's photo gallery look, like Pixieset's Design (cover style, fonts,
// colours, grid). Ported from the Avira films app (2026-09-27). Every choice shows at once in the
// live preview (the couple's real page from the films site, in a frame) and saves by itself.

const TABS = [
  { key: "cover", label: "שער" },
  { key: "font", label: "טיפוגרפיה" },
  { key: "color", label: "צבע" },
  { key: "grid", label: "גריד" },
];

/** What the couple's page looks like at each size (the preview is the real page, scaled down). */
const DEVICES = { desktop: { w: 1280, h: 800 }, phone: { w: 390, h: 844 } };

const FILMS_ORIGIN = (() => {
  try {
    return new URL(FILMS_BASE_URL).origin;
  } catch {
    return "";
  }
})();

const tileClass = (on) =>
  `flex flex-col items-center gap-2 rounded-lg border p-2.5 text-gray-200 transition-colors ${on ? "border-brand-400 ring-1 ring-inset ring-brand-400 bg-gray-800" : "border-gray-700 bg-gray-800/60 hover:border-gray-500"}`;

export default function DesignEditor({ galleryId, coupleUrl, coupleName }) {
  const [tab, setTab] = useState("cover");
  const [design, setDesign] = useState(null);
  const [own, setOwn] = useState(false);
  const [studioDefault, setStudioDefault] = useState(DEFAULT_DESIGN);
  const [cover, setCover] = useState("");
  const [token, setToken] = useState("");
  const [gen, setGen] = useState(0);
  const [device, setDevice] = useState("desktop");
  const [saved, setSaved] = useState("");
  const frame = useRef(null);
  const box = useRef(null);
  const [boxW, setBoxW] = useState(600);
  const timer = useRef(0);

  useEffect(() => {
    Promise.all([filmsApi("GET", `/api/admin/galleries/${galleryId}/photos`), filmsApi("GET", "/api/admin/settings")])
      .then(([photos, settings]) => {
        const def = cleanDesign(settings.designDefault);
        setStudioDefault(def);
        setOwn(Boolean(photos.design));
        setDesign(cleanDesign(photos.design, def));
        setCover(photos.cover || photos.items.find((i) => !i.hidden)?.key || "");
        setToken(photos.previewToken || "");
        setGen(photos.gen || 0);
      })
      .catch(() => setDesign(DEFAULT_DESIGN));
    // The tiles show every font: load them all here.
    for (const f of FONTS) {
      const id = `font-${f}`;
      if (document.getElementById(id)) continue;
      const l = document.createElement("link");
      l.id = id;
      l.rel = "stylesheet";
      l.href = `https://fonts.googleapis.com/css2?family=${FONT_STYLES[f].google}&display=swap`;
      document.head.appendChild(l);
    }
  }, [galleryId]);

  // The preview frame (the films site) asks for the design when it's ready; every change goes straight to it.
  const send = (d) => d && FILMS_ORIGIN && frame.current?.contentWindow?.postMessage({ type: "pg-design", design: d }, FILMS_ORIGIN);
  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin === FILMS_ORIGIN && e.source === frame.current?.contentWindow && e.data?.type === "pg-ready") send(design);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  });
  // Re-measure once the design has loaded (the box only renders then).
  const hasDesign = design !== null;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, [hasDesign]);

  const change = (patch) => {
    if (!design) return;
    const next = { ...design, ...patch };
    setDesign(next);
    setOwn(true);
    send(next);
    setSaved("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        await filmsApi("PUT", `/api/admin/galleries/${galleryId}/photos`, { design: next });
        setSaved("saved");
      } catch (e) {
        setSaved("");
        toast.error(e.message);
      }
    }, 400);
  };
  const makeDefault = async () => {
    if (!design) return;
    try {
      await filmsApi("PUT", "/api/admin/settings", { designDefault: design });
      setStudioDefault(design);
      toast.success("העיצוב נשמר כברירת המחדל של הסטודיו");
    } catch (e) {
      toast.error(e.message);
    }
  };
  const backToDefault = async () => {
    try {
      await filmsApi("PUT", `/api/admin/galleries/${galleryId}/photos`, { design: null });
      window.clearTimeout(timer.current);
      setOwn(false);
      setSaved("");
      setDesign(studioDefault);
      send(studioDefault);
      toast.success("הגלריה חזרה לעיצוב ברירת המחדל של הסטודיו");
    } catch (e) {
      toast.error(e.message);
    }
  };

  if (!design) {
    return (
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5 flex justify-center">
        <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
      </section>
    );
  }
  const size = DEVICES[device];
  const available = Math.max(200, boxW);
  const scale = Math.min(1, available / size.w, 620 / size.h);
  const coverImg = cover ? photoUrl(galleryId, cover, "m", token, gen) : "";
  const previewSrc = coupleUrl ? `${coupleUrl}?preview=1${token ? `&pt=${encodeURIComponent(token)}` : ""}` : "";

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-4" data-testid="design-card" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-white">עיצוב הגלריה</h2>
        <span className="text-sm text-gray-400" data-testid="design-saved">
          {saved === "saving" ? "שומר…" : saved === "saved" ? "✓ נשמר" : own ? "עיצוב משלה" : "לפי ברירת המחדל של הסטודיו"}
        </span>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(18rem,25rem)_minmax(0,1fr)] items-start">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5" role="tablist">
            {TABS.map((t) => (
              <button
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-full border px-3 py-1 text-sm ${tab === t.key ? "border-brand-400 bg-brand-400/15 text-brand-300" : "border-gray-700 text-gray-400 hover:text-gray-200"}`}
                data-testid={`design-tab-${t.key}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "cover" && (
            <div className="grid grid-cols-2 gap-2.5">
              {COVERS.map((c) => (
                <button type="button" key={c} className={tileClass(design.cover === c)} aria-pressed={design.cover === c} onClick={() => change({ cover: c })} data-testid={`design-cover-${c}`}>
                  <span className={`mini-cover mc-${c}`} style={{ "--mc-img": coverImg ? `url("${coverImg}")` : "none" }}>
                    <i className="mc-img" />
                    <b>{coupleName || "השמות"}</b>
                  </span>
                  <span className="text-xs">{COVER_LABELS[c]}</span>
                </button>
              ))}
            </div>
          )}

          {tab === "font" && (
            <div className="grid grid-cols-2 gap-2.5">
              {FONTS.map((f) => {
                const st = FONT_STYLES[f];
                return (
                  <button type="button" key={f} className={tileClass(design.font === f)} aria-pressed={design.font === f} onClick={() => change({ font: f })} data-testid={`design-font-${f}`}>
                    <span className="text-xl py-2 max-w-full truncate text-white" style={{ fontFamily: st.family, fontWeight: st.weight, letterSpacing: st.spacing }}>
                      {coupleName || "נועה & תומר"}
                    </span>
                    <span className="text-xs">
                      {st.label} <span className="text-gray-500">· {st.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {tab === "color" && (
            <div className="grid grid-cols-2 gap-2.5">
              {COLORS.map((c) => {
                const st = COLOR_STYLES[c];
                return (
                  <button type="button" key={c} className={tileClass(design.color === c)} aria-pressed={design.color === c} onClick={() => change({ color: c })} data-testid={`design-color-${c}`}>
                    <span className="flex gap-1.5 py-2.5">
                      {[st.bg, st.surface, st.accent].map((col, i) => (
                        <i key={i} className="block w-7 h-7 rounded-full border border-white/20" style={{ background: col }} />
                      ))}
                    </span>
                    <span className="text-xs">{st.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {tab === "grid" && (
            <div className="space-y-4">
              <GridChoice label="סגנון" value={design.grid} onChange={(grid) => change({ grid })} options={[{ v: "columns", t: "עמודות", icon: "M4 4h7v10H4zM13 4h7v6h-7zM4 16h7v4H4zM13 12h7v8h-7z" }, { v: "rows", t: "שורות", icon: "M4 4h10v7H4zM16 4h4v7h-4zM4 13h5v7H4zM11 13h9v7h-9z" }]} testid="design-grid" />
              <GridChoice label="גודל התמונות" value={design.thumb} onChange={(thumb) => change({ thumb })} options={[{ v: "regular", t: "רגיל", icon: "M4 4h4v4H4zM10 4h4v4h-4zM16 4h4v4h-4zM4 10h4v4H4zM10 10h4v4h-4zM16 10h4v4h-4zM4 16h4v4H4zM10 16h4v4h-4zM16 16h4v4h-4z" }, { v: "large", t: "גדול", icon: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" }]} testid="design-thumb" />
              <GridChoice label="ריווח" value={design.spacing} onChange={(spacing) => change({ spacing })} options={[{ v: "regular", t: "רגיל", icon: "M4 4h7.5v7.5H4zM12.5 4H20v7.5h-7.5zM4 12.5h7.5V20H4zM12.5 12.5H20V20h-7.5z" }, { v: "large", t: "מרווח", icon: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" }]} testid="design-spacing" />
              <GridChoice label="כפתורים בסרגל העליון" value={design.nav} onChange={(nav) => change({ nav })} options={[{ v: "icons", t: "אייקונים בלבד", icon: "M6 6h12v12H6z" }, { v: "text", t: "אייקון וטקסט", icon: "M5 5h14v14H5zM9 16l3-8 3 8M10.2 13.2h3.6" }]} testid="design-nav" stroke />
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" size="sm" variant="outline" className="border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700" onClick={makeDefault} data-testid="design-make-default">
              שמירה כברירת מחדל לכל הגלריות
            </Button>
            {own && (
              <Button type="button" size="sm" variant="outline" className="border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700" onClick={backToDefault} data-testid="design-reset">
                חזרה לברירת המחדל
              </Button>
            )}
          </div>
          <p className="text-xs text-gray-500">ברירת המחדל חלה על כל גלריה שלא עוצבה בנפרד.</p>
        </div>

        <div className="flex flex-col items-center gap-3 min-w-0 lg:sticky lg:top-4" ref={box}>
          {previewSrc ? (
            <div className="ds-frame overflow-hidden rounded-lg bg-white shadow-2xl" style={{ width: size.w * scale, height: size.h * scale }}>
              <iframe ref={frame} src={previewSrc} title="תצוגה מקדימה של הגלריה" style={{ width: size.w, height: size.h, transform: `scale(${scale})` }} onLoad={() => send(design)} data-testid="design-preview" />
            </div>
          ) : (
            <p className="text-sm text-gray-500">התצוגה המקדימה תופיע אחרי שמירת הגלריה.</p>
          )}
          <div className="inline-flex rounded-lg border border-gray-700 overflow-hidden">
            <button type="button" onClick={() => setDevice("desktop")} aria-pressed={device === "desktop"} className={`px-3 py-1.5 text-sm inline-flex items-center gap-1.5 ${device === "desktop" ? "bg-brand-400/15 text-brand-300" : "text-gray-400"}`}>
              <Monitor className="w-4 h-4" /> מחשב
            </button>
            <button type="button" onClick={() => setDevice("phone")} aria-pressed={device === "phone"} className={`px-3 py-1.5 text-sm inline-flex items-center gap-1.5 ${device === "phone" ? "bg-brand-400/15 text-brand-300" : "text-gray-400"}`} data-testid="design-phone">
              <Smartphone className="w-4 h-4" /> טלפון
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function GridChoice({ label, value, options, onChange, testid, stroke = false }) {
  return (
    <div className="space-y-1.5">
      <b className="text-sm text-gray-200">{label}</b>
      <div className="grid grid-cols-2 gap-2.5">
        {options.map((o) => (
          <button type="button" key={o.v} className={tileClass(value === o.v)} aria-pressed={value === o.v} onClick={() => onChange(o.v)} data-testid={`${testid}-${o.v}`}>
            <svg viewBox="0 0 24 24" width="30" height="30" fill={stroke ? "none" : "currentColor"} stroke={stroke ? "currentColor" : "none"} strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
              <path d={o.icon} />
            </svg>
            <span className="text-xs">{o.t}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
