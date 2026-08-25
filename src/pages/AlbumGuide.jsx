import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import {
  Loader2,
  AlertTriangle,
  Camera,
  Send,
  ShoppingBag,
  BookImage,
  Image as ImageIcon,
  Layers,
  Ban,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  X,
  Images,
} from "lucide-react";

// Public, no-login, generic (identical for every couple of the tenant) guide
// page explaining how album ordering works -- sent as a companion link
// alongside the couple's gallery link (see send-to-couple/index.ts). NOT the
// per-order review/purchase portal (that's /album/:token, AlbumPortal.jsx) --
// this page is purely informational and never touches album_orders/
// album_versions/... Per CLAUDE.md's Wedding Albums module rules, it only
// reads (via the get-album-guide-public Edge Function) album_products/
// album_covers/album_addons, and never touches the legacy
// events.album_status marker.

function formatPrice(amount) {
  if (amount === null || amount === undefined) return null;
  const num = Number(amount);
  if (Number.isNaN(num)) return null;
  return `₪${num.toLocaleString("he-IL")}`;
}

function SectionCard({ icon: Icon, title, children }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 sm:p-6 space-y-3">
      <div className="flex items-center gap-2.5">
        {Icon && (
          <div className="w-9 h-9 rounded-xl bg-yellow-400/10 flex items-center justify-center shrink-0">
            <Icon className="w-4.5 h-4.5 text-yellow-400" />
          </div>
        )}
        <h2 className="text-base sm:text-lg font-bold text-white">{title}</h2>
      </div>
      <div className="text-gray-300 text-sm sm:text-[15px] leading-relaxed whitespace-pre-line">
        {children}
      </div>
    </div>
  );
}

function FaqAccordionItem({ item }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 text-right bg-gray-900 hover:bg-gray-800/60 transition-colors"
      >
        <span className="text-sm sm:text-[15px] font-semibold text-white">{item.question}</span>
        <ChevronDown
          className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="p-4 pt-0 bg-gray-900">
          <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-line">{item.answer}</p>
        </div>
      )}
    </div>
  );
}

// Cover card -- shows the studio-uploaded preview image directly (no click
// needed to reveal it, per the user's explicit request), same grid-card
// layout as the sketch-examples gallery below for visual consistency.
// Clicking the image still opens the shared lightbox for a bigger look, but
// the image itself is always visible up front.
function CoverCard({ cover, onOpen }) {
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => cover.imageUrl && onOpen()}
        disabled={!cover.imageUrl}
        className="w-full aspect-[4/3] bg-gray-900 flex items-center justify-center disabled:cursor-default"
      >
        {cover.imageUrl ? (
          <img src={cover.imageUrl} alt={cover.name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <ImageIcon className="w-8 h-8 text-gray-700" />
        )}
      </button>
      <div className="p-3 flex items-center justify-between gap-2">
        <span className="text-white text-sm font-medium truncate">{cover.name}</span>
        <span className="text-gray-300 text-xs shrink-0">
          {cover.priceDelta ? `+${formatPrice(cover.priceDelta)}` : "ללא תוספת"}
        </span>
      </div>
    </div>
  );
}

// Simple full-screen image viewer for a single cover preview -- reuses the
// same overlay chrome as SketchExampleLightbox but for one static image
// instead of a paged sequence.
function CoverImageLightbox({ cover, onClose }) {
  if (!cover) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-3"
      dir="rtl"
      onClick={onClose}
    >
      <div className="absolute top-3 inset-x-3 flex items-center justify-between text-gray-300 text-sm">
        <span className="bg-black/50 rounded-lg px-3 py-1.5">{cover.name}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="bg-black/50 hover:bg-black/70 rounded-lg p-2 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <img
        src={cover.imageUrl}
        alt={cover.name}
        className="max-h-[80vh] max-w-full rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// Full-screen lightbox for browsing one sketch example's full image sequence
// (each example is ~30 images, one per spread) -- prev/next + counter.
function SketchExampleLightbox({ example, imageIndex, onClose, onPrev, onNext }) {
  if (!example) return null;
  const images = example.images || [];
  const total = images.length;
  const current = images[imageIndex];

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onPrev();
      if (e.key === "ArrowLeft") onNext();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageIndex]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-3"
      dir="rtl"
      onClick={onClose}
    >
      <div className="absolute top-3 inset-x-3 flex items-center justify-between text-gray-300 text-sm">
        <span className="bg-black/50 rounded-lg px-3 py-1.5">
          {example.title || "דוגמת סקיצה"} — עמוד {imageIndex + 1} מתוך {total}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="bg-black/50 hover:bg-black/70 rounded-lg p-2 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {current && (
        <img
          src={current.imageUrl}
          alt={`עמוד ${imageIndex + 1}`}
          className="max-h-[80vh] max-w-full rounded-lg object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      )}

      <div className="absolute inset-y-0 right-2 flex items-center">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          disabled={imageIndex <= 0}
          className="bg-black/50 hover:bg-black/70 disabled:opacity-30 disabled:cursor-not-allowed rounded-full p-2 transition-colors"
        >
          <ChevronRight className="w-6 h-6 text-white" />
        </button>
      </div>
      <div className="absolute inset-y-0 left-2 flex items-center">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          disabled={imageIndex >= total - 1}
          className="bg-black/50 hover:bg-black/70 disabled:opacity-30 disabled:cursor-not-allowed rounded-full p-2 transition-colors"
        >
          <ChevronLeft className="w-6 h-6 text-white" />
        </button>
      </div>
    </div>
  );
}

export default function AlbumGuide() {
  const { tenantId } = useParams();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [activeExampleIdx, setActiveExampleIdx] = useState(null); // index into sketchExamples, null = closed
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [activeCoverId, setActiveCoverId] = useState(null); // cover id shown in the image lightbox, null = closed

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!tenantId) {
        setError("קישור לא תקין");
        setIsLoading(false);
        return;
      }
      try {
        const res = await base44.functions.invoke("getAlbumGuidePublic", { tenantId });
        if (!cancelled) setData(res?.data || null);
      } catch (e) {
        if (!cancelled) setError(e?.message || "אירעה שגיאה בטעינת המדריך");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center" dir="rtl">
        <Loader2 className="w-10 h-10 text-yellow-400 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6" dir="rtl">
        <div className="max-w-md w-full bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center space-y-3">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto" />
          <h1 className="text-lg font-bold text-white">לא ניתן לטעון את המדריך</h1>
          <p className="text-gray-400 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const studioName = data?.studioDisplayName || "הסטודיו";
  const guide = data?.guide || null;
  const faqItems = data?.faqItems || [];
  const products = data?.catalog?.products || [];
  const covers = data?.catalog?.covers || [];
  const addons = data?.catalog?.addons || [];
  const sketchExamples = data?.sketchExamples || [];

  const activeExample =
    activeExampleIdx !== null && sketchExamples[activeExampleIdx] ? sketchExamples[activeExampleIdx] : null;
  const activeCover = activeCoverId ? covers.find((c) => c.id === activeCoverId) || null : null;

  const openExample = (idx) => {
    setActiveExampleIdx(idx);
    setActiveImageIdx(0);
  };
  const closeExample = () => {
    setActiveExampleIdx(null);
    setActiveImageIdx(0);
  };
  const prevImage = () => setActiveImageIdx((i) => Math.max(0, i - 1));
  const nextImage = () =>
    setActiveImageIdx((i) => (activeExample ? Math.min((activeExample.images || []).length - 1, i + 1) : i));

  return (
    <div className="min-h-screen bg-gray-950 py-8 px-4" dir="rtl">
      <div className="max-w-2xl mx-auto space-y-5">
        {/* Header */}
        <div className="bg-gradient-to-l from-yellow-500/10 via-gray-900 to-gray-900 border border-gray-800 rounded-2xl p-5 sm:p-6 text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-yellow-400/15 flex items-center justify-center mx-auto">
            <BookImage className="w-6 h-6 text-yellow-400" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">מדריך להזמנת אלבום</h1>
          <p className="text-gray-400 text-sm">{studioName}</p>
        </div>

        {!guide ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center space-y-2">
            <Camera className="w-8 h-8 text-gray-600 mx-auto" />
            <p className="text-gray-400 text-sm">המדריך עדיין לא זמין כרגע — נעדכן אתכם בקרוב.</p>
          </div>
        ) : (
          <>
            {guide.photoSelectionIntro && (
              <SectionCard icon={Camera} title="איך בוחרים תמונות לאלבום">
                {guide.photoSelectionIntro}
              </SectionCard>
            )}

            {guide.submissionInstructions && (
              <SectionCard icon={Send} title="סיימתם לבחור? הנה מה שנשאר לעשות">
                {guide.submissionInstructions}
              </SectionCard>
            )}

            {products.length > 0 && (
              <SectionCard icon={ShoppingBag} title="מחירון אלבומים">
                <div className="space-y-2 not-italic">
                  {products.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-start justify-between gap-3 bg-gray-800/50 border border-gray-700/50 rounded-xl p-3"
                    >
                      <div>
                        <p className="text-white font-semibold text-sm">{p.name}</p>
                        {p.description && (
                          <p className="text-gray-400 text-xs mt-0.5">{p.description}</p>
                        )}
                        {p.albumCount ? (
                          <p className="text-gray-500 text-xs mt-0.5">{p.albumCount} אלבומים בסט</p>
                        ) : null}
                      </div>
                      {formatPrice(p.basePrice) && (
                        <span className="text-yellow-400 font-bold text-sm shrink-0">
                          {formatPrice(p.basePrice)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            {sketchExamples.length > 0 && (
              <SectionCard icon={Images} title="כך נראית סקיצת אלבום לפני ההדפסה">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 not-italic">
                  {sketchExamples.map((ex, idx) => {
                    const count = (ex.images || []).length;
                    const thumb = ex.images?.[0]?.imageUrl;
                    return (
                      <button
                        key={ex.id}
                        type="button"
                        onClick={() => count > 0 && openExample(idx)}
                        disabled={count === 0}
                        className="text-right bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden hover:border-yellow-400/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <div className="aspect-[4/3] bg-gray-900 flex items-center justify-center">
                          {thumb ? (
                            <img src={thumb} alt={ex.title || "דוגמת סקיצה"} className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <ImageIcon className="w-8 h-8 text-gray-700" />
                          )}
                        </div>
                        <div className="p-3">
                          <p className="text-white text-sm font-semibold">{ex.title || `דוגמה ${idx + 1}`}</p>
                          <p className="text-yellow-400 text-xs mt-0.5">
                            {count > 0 ? `צפו בסקיצה המלאה (${count} עמודים)` : "אין עדיין תמונות"}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </SectionCard>
            )}

            {!sketchExamples.length && guide.sketchExampleImageUrl && (
              <SectionCard icon={ImageIcon} title="כך נראית סקיצת אלבום לפני ההדפסה">
                <img
                  src={guide.sketchExampleImageUrl}
                  alt="דוגמה לסקיצת אלבום"
                  className="w-full rounded-xl border border-gray-800"
                  loading="lazy"
                />
              </SectionCard>
            )}

            {guide.cancellationPolicy && (
              <SectionCard icon={Ban} title="מדיניות ביטול">
                {guide.cancellationPolicy}
              </SectionCard>
            )}

            {covers.length > 0 && (
              <SectionCard icon={Layers} title="סוגי כריכות">
                <div className="grid grid-cols-2 gap-3 not-italic">
                  {covers.map((c) => (
                    <CoverCard key={c.id} cover={c} onOpen={() => setActiveCoverId(c.id)} />
                  ))}
                </div>
              </SectionCard>
            )}

            {addons.length > 0 && (
              <SectionCard icon={ImageIcon} title="תוספות אפשריות">
                <div className="space-y-2 not-italic">
                  {addons.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between gap-3 bg-gray-800/50 border border-gray-700/50 rounded-xl p-3"
                    >
                      <span className="text-white text-sm font-medium">{a.name}</span>
                      {formatPrice(a.price) && (
                        <span className="text-gray-300 text-sm shrink-0">{formatPrice(a.price)}</span>
                      )}
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            {faqItems.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 sm:p-6 space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-yellow-400/10 flex items-center justify-center shrink-0">
                    <HelpCircle className="w-4.5 h-4.5 text-yellow-400" />
                  </div>
                  <h2 className="text-base sm:text-lg font-bold text-white">שאלות נפוצות</h2>
                </div>
                <div className="space-y-2">
                  {faqItems.map((item) => (
                    <FaqAccordionItem key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <p className="text-center text-gray-600 text-xs pt-2">{studioName}</p>
      </div>

      {activeExample && (
        <SketchExampleLightbox
          example={activeExample}
          imageIndex={activeImageIdx}
          onClose={closeExample}
          onPrev={prevImage}
          onNext={nextImage}
        />
      )}

      {activeCover && <CoverImageLightbox cover={activeCover} onClose={() => setActiveCoverId(null)} />}
    </div>
  );
}
