import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowDown, ArrowUp, Copy, ExternalLink, Eye, ImagePlus, Loader2, Plus, RefreshCw, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { copyText, filmsApi, filmsConfigured, FILMS_BASE_URL } from "@/lib/filmsApi";
import { readAllGalleries } from "@/lib/filmsBatch";
import { eventsInfo } from "@/lib/gallerySend";
import { generateRawToken } from "@/lib/albumTokens";
import { compressImageForThumb } from "@/lib/imageCompress";
import { formatDateShort } from "@/lib/dates";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import FilmsNotConfigured from "@/components/films/FilmsNotConfigured";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// "דפי צלמים" (Avira, 2026-11-02, the owner's request; 0102). A page per photographer of the team, sent to a couple who
// asks to see his work: his photo and a few words, the weddings he shot that the studio starred ★ (each shows its
// teaser; "גלריה מלאה" opens the whole gallery for one wedding), and what couples said — typed, or a screenshot of
// their WhatsApp message. The gallery Worker serves /photographer/<token>; this screen edits photographer_pages and
// photographer_testimonials (the studio's own rows, RLS) and the photographer-pages bucket.

const BUCKET = "photographer-pages";
const inputCls = "bg-gray-800 border-gray-700 text-white";
const btn = "border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700";
const same = (a, b) => String(a || "").replace(/\s+/g, " ").trim().toLowerCase() === String(b || "").replace(/\s+/g, " ").trim().toLowerCase();
const pageLink = (token) => `${FILMS_BASE_URL}/photographer/${token}`;

/** A private file of the page, shown here through a short-lived signed address. */
function useSigned(path) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!path) {
      setUrl("");
      return;
    }
    supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, 3600)
      .then(({ data }) => setUrl(data?.signedUrl || ""));
  }, [path]);
  return url;
}

function Thumb({ path, className }) {
  const url = useSigned(path);
  return url ? <img src={url} alt="" className={className} /> : <div className={`${className} bg-gray-800`} />;
}

export default function PhotographerPages() {
  const { tenant } = useAuth();
  const [names, setNames] = useState(null);
  const [pages, setPages] = useState([]);
  const [testimonials, setTestimonials] = useState([]);
  const [galleries, setGalleries] = useState([]);
  const [byEvent, setByEvent] = useState({});

  const load = async () => {
    const [staff, p, t, list] = await Promise.all([
      supabase.from("staff_members").select("name, role").eq("role", "photographer").order("order_index"),
      supabase.from("photographer_pages").select("*").order("created_at"),
      supabase.from("photographer_testimonials").select("*").order("sort").order("created_at"),
      readAllGalleries((path) => filmsApi("GET", path)).catch(() => []),
    ]);
    const photoGalleries = (list || []).filter((g) => g.kind === "photos" && !g.deletedAt);
    setPages(p.data || []);
    setTestimonials(t.data || []);
    setGalleries(photoGalleries);
    const info = await eventsInfo(photoGalleries.map((g) => g.eventId).filter(Boolean));
    setByEvent(info);
    // The team's photographers, and anyone already named as a gallery's photographer or with a page.
    const all = [...(staff.data || []).map((s) => s.name), ...(p.data || []).map((x) => x.staff_name), ...photoGalleries.map((g) => g.photographer || info[g.eventId]?.photographer)];
    const unique = [];
    for (const n of all) if (n && !unique.some((u) => same(u, n))) unique.push(String(n).trim());
    setNames(unique);
  };
  useEffect(() => {
    if (filmsConfigured()) load();
  }, []);

  if (!filmsConfigured()) return <FilmsNotConfigured />;

  const create = async (name) => {
    const { data, error } = await supabase.from("photographer_pages").insert({ tenant_id: tenant?.id, staff_name: name, display_name: name, token: generateRawToken() }).select().single();
    if (error) return toast.error(error.message);
    setPages((ps) => [...ps, data]);
    toast.success(`נוצר דף ל${name}`);
  };

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8" dir="rtl">
      <div className="max-w-4xl mx-auto space-y-5">
        <Link to="/photos" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white">
          <ArrowRight className="w-4 h-4" />
          חזרה לגלריות
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">דפי צלמים</h1>
          <p className="text-sm text-gray-400 mt-1">
            דף לכל צלם, לזוג שמבקש לראות עבודות: תמונה, כמה מילים, החתונות שסימנתם ★ ושהוא הצלם שלהן (כל חתונה מציגה את הטיזר), והמלצות. שולחים את הקישור בוואטסאפ, או מהצ'אט עם הליד ("שליחת דף צלם").
          </p>
        </div>
        {names === null ? (
          <div className="p-10 flex justify-center">
            <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
          </div>
        ) : names.length === 0 ? (
          <p className="text-gray-400">אין עדיין צלמים ברשימת אנשי הצוות.</p>
        ) : (
          names.map((name) => {
            const page = pages.find((p) => same(p.staff_name, name));
            return page ? (
              <PageCard
                key={page.id}
                page={page}
                tenantId={tenant?.id}
                testimonials={testimonials.filter((t) => t.page_id === page.id)}
                weddings={galleries.filter((g) => g.studioFavorite && same(g.photographer || byEvent[g.eventId]?.photographer, page.staff_name))}
                onPage={(next) => setPages((ps) => ps.map((p) => (p.id === next.id ? next : p)))}
                onTestimonials={(fn) => setTestimonials(fn)}
              />
            ) : (
              <div key={name} className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 p-4" data-testid="pp-empty">
                <span className="flex items-center gap-2 text-white">
                  <UserRound className="w-5 h-5 text-gray-500" /> {name}
                </span>
                <Button className="bg-brand-400 hover:bg-brand-500 text-brand-fg" onClick={() => create(name)} data-testid="pp-create">
                  <Plus className="w-4 h-4 ml-1" /> יצירת דף
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function PageCard({ page, tenantId, testimonials, weddings, onPage, onTestimonials }) {
  const [busy, setBusy] = useState("");
  const [draft, setDraft] = useState({ display_name: page.display_name || "", bio: page.bio || "" });
  const [newT, setNewT] = useState({ body: "", couple_name: "", file: null });

  const patch = async (fields, ok) => {
    const { data, error } = await supabase.from("photographer_pages").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", page.id).select().single();
    if (error) return toast.error(error.message);
    onPage(data);
    if (ok) toast.success(ok);
  };
  const upload = async (file, name) => {
    const blob = await compressImageForThumb(file, { maxDimension: 1600, quality: 0.86 });
    const path = `${tenantId}/${page.id}/${name}-${Date.now()}.jpg`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
    if (error) throw error;
    return path;
  };
  const setPhoto = async (file) => {
    if (!file) return;
    setBusy("photo");
    try {
      const old = page.photo_path;
      await patch({ photo_path: await upload(file, "photo") }, "התמונה עודכנה");
      if (old) await supabase.storage.from(BUCKET).remove([old]);
    } catch (e) {
      toast.error(e.message);
    }
    setBusy("");
  };
  const toggleIn = (field, id) => {
    const list = page[field] || [];
    patch({ [field]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] });
  };
  const renew = async () => {
    if (!(await confirmDialog("ליצור קישור חדש לדף?\nהקישור הנוכחי יפסיק לעבוד מיד, גם אצל מי שכבר קיבל אותו."))) return;
    patch({ token: generateRawToken() }, "נוצר קישור חדש");
  };
  const addTestimonial = async () => {
    if (!newT.body.trim() && !newT.file) return toast.error("כתבו המלצה או צרפו צילום מסך");
    setBusy("t");
    try {
      const image_path = newT.file ? await upload(newT.file, "shot") : null;
      const sort = testimonials.reduce((m, t) => Math.max(m, t.sort), -1) + 1;
      const { data, error } = await supabase
        .from("photographer_testimonials")
        .insert({ tenant_id: tenantId, page_id: page.id, body: newT.body.trim() || null, couple_name: newT.couple_name.trim() || null, image_path, sort })
        .select()
        .single();
      if (error) throw error;
      onTestimonials((ts) => [...ts, data]);
      setNewT({ body: "", couple_name: "", file: null });
      toast.success("ההמלצה נוספה");
    } catch (e) {
      toast.error(e.message);
    }
    setBusy("");
  };
  const removeTestimonial = async (t) => {
    if (!(await confirmDialog({ title: "למחוק את ההמלצה?", confirmText: "מחק", danger: true }))) return;
    const { error } = await supabase.from("photographer_testimonials").delete().eq("id", t.id);
    if (error) return toast.error(error.message);
    if (t.image_path) await supabase.storage.from(BUCKET).remove([t.image_path]);
    onTestimonials((ts) => ts.filter((x) => x.id !== t.id));
  };
  const move = async (t, dir) => {
    const list = [...testimonials].sort((a, b) => a.sort - b.sort);
    const i = list.findIndex((x) => x.id === t.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const [a, b] = [list[i], list[j]];
    await Promise.all([
      supabase.from("photographer_testimonials").update({ sort: b.sort }).eq("id", a.id),
      supabase.from("photographer_testimonials").update({ sort: a.sort }).eq("id", b.id),
    ]);
    onTestimonials((ts) => ts.map((x) => (x.id === a.id ? { ...x, sort: b.sort } : x.id === b.id ? { ...x, sort: a.sort } : x)));
  };

  const sortedT = useMemo(() => [...testimonials].sort((a, b) => a.sort - b.sort), [testimonials]);
  const link = pageLink(page.token);

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-5" data-testid="pp-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">{page.staff_name}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => patch({ published: !page.published }, page.published ? "הדף הוסתר" : "הדף פעיל")}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${page.published ? "bg-green-600 text-white" : "bg-gray-700 text-gray-300"}`}
            data-testid="pp-published"
          >
            {page.published ? "פעיל" : "מוסתר"}
          </button>
          <span className="text-xs text-gray-500">
            <Eye className="inline w-3.5 h-3.5" /> {page.views || 0} צפיות{page.last_viewed_at ? ` · אחרונה ${formatDateShort(page.last_viewed_at)}` : ""}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button className="bg-brand-400 hover:bg-brand-500 text-brand-fg" onClick={() => copyText(link).then((ok) => ok && toast.success("הקישור הועתק"))} data-testid="pp-copy">
          <Copy className="w-4 h-4 ml-2" /> העתקת הקישור
        </Button>
        <Button asChild variant="outline" className={btn}>
          <a href={link} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-4 h-4 ml-2" /> תצוגה כמו הזוג
          </a>
        </Button>
        <Button variant="outline" className={btn} onClick={renew}>
          <RefreshCw className="w-4 h-4 ml-2" /> קישור חדש
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-4 items-start">
        <label className="cursor-pointer space-y-1 text-center">
          {page.photo_path ? <Thumb path={page.photo_path} className="w-32 h-32 rounded-full object-cover mx-auto" /> : <div className="w-32 h-32 rounded-full bg-gray-800 mx-auto grid place-items-center text-gray-500">{busy === "photo" ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImagePlus className="w-6 h-6" />}</div>}
          <span className="text-xs text-brand-300">{page.photo_path ? "החלפת תמונה" : "העלאת תמונה"}</span>
          <input type="file" accept="image/*" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0])} data-testid="pp-photo-input" />
        </label>
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="text-sm text-gray-300">השם בדף</div>
            <Input value={draft.display_name} maxLength={80} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} onBlur={() => draft.display_name !== (page.display_name || "") && patch({ display_name: draft.display_name.trim() || null })} className={inputCls} />
          </div>
          <div className="space-y-1">
            <div className="text-sm text-gray-300">כמה מילים עליו</div>
            <textarea
              value={draft.bio}
              maxLength={600}
              rows={3}
              onChange={(e) => setDraft({ ...draft, bio: e.target.value })}
              onBlur={() => draft.bio !== (page.bio || "") && patch({ bio: draft.bio.trim() || null }, "נשמר")}
              placeholder="אני מצלם רגעים אמיתיים, בלי פוזות מיותרות…"
              className="w-full rounded-md border border-gray-700 bg-gray-800 p-2 text-sm text-white"
              data-testid="pp-bio"
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm text-gray-300">חתונות בדף — הגלריות שסימנתם ★ ו{page.staff_name} הצלם שלהן</div>
        {weddings.length === 0 ? (
          <p className="text-xs text-gray-500">אין עדיין. ברשימת הגלריות סמנו ★ לחתונות שרוצים להראות (ושהצלם שלהן {page.staff_name}).</p>
        ) : (
          <div className="divide-y divide-gray-800 rounded-lg border border-gray-800">
            {weddings.map((g) => {
              const shown = !(page.hidden_galleries || []).includes(g.id);
              const full = (page.full_galleries || []).includes(g.id);
              return (
                <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" data-testid="pp-wedding-row">
                  <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
                    <input type="checkbox" checked={shown} onChange={() => toggleIn("hidden_galleries", g.id)} data-testid="pp-wedding-shown" />
                    {g.coupleName} <span className="text-xs text-gray-500">{formatDateShort(g.date)}</span>
                  </label>
                  <button
                    type="button"
                    disabled={!shown}
                    onClick={() => toggleIn("full_galleries", g.id)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${full ? "border-brand-400 bg-brand-400/15 text-brand-300" : "border-gray-700 text-gray-400"} disabled:opacity-40`}
                    title="כבוי: רק הטיזר. דלוק: כל הגלריה (בלי הסטים שחסומים לאורחים)"
                    data-testid="pp-wedding-full"
                  >
                    {full ? "גלריה מלאה" : "רק טיזר"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-sm text-gray-300">המלצות</div>
        {sortedT.map((t, i) => (
          <div key={t.id} className="flex gap-3 rounded-lg border border-gray-800 p-3" data-testid="pp-testimonial">
            {t.image_path && <Thumb path={t.image_path} className="w-16 h-24 rounded object-cover" />}
            <div className="min-w-0 flex-1 text-sm">
              {t.body && <p className="text-gray-200 whitespace-pre-line">"{t.body}"</p>}
              {t.couple_name && <p className="text-xs text-gray-500 mt-1">— {t.couple_name}</p>}
            </div>
            <div className="flex flex-col gap-1">
              <button type="button" disabled={i === 0} onClick={() => move(t, -1)} className="text-gray-500 hover:text-white disabled:opacity-30" aria-label="למעלה">
                <ArrowUp className="w-4 h-4" />
              </button>
              <button type="button" disabled={i === sortedT.length - 1} onClick={() => move(t, 1)} className="text-gray-500 hover:text-white disabled:opacity-30" aria-label="למטה">
                <ArrowDown className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => removeTestimonial(t)} className="text-red-400 hover:text-red-300" aria-label="מחיקה">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
        <div className="space-y-2 rounded-lg border border-dashed border-gray-700 p-3">
          <textarea value={newT.body} maxLength={1000} rows={2} onChange={(e) => setNewT({ ...newT, body: e.target.value })} placeholder="מה הזוג כתב (או רק צילום מסך)" className="w-full rounded-md border border-gray-700 bg-gray-800 p-2 text-sm text-white" data-testid="pp-t-body" />
          <div className="flex flex-wrap items-center gap-2">
            <Input value={newT.couple_name} maxLength={80} onChange={(e) => setNewT({ ...newT, couple_name: e.target.value })} placeholder="שם הזוג (דניאלה ודן)" className={`${inputCls} w-48`} data-testid="pp-t-couple" />
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 hover:bg-gray-700">
              <ImagePlus className="w-4 h-4" /> {newT.file ? newT.file.name.slice(0, 24) : "צילום מסך מהוואטסאפ"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => setNewT({ ...newT, file: e.target.files?.[0] || null })} data-testid="pp-t-file" />
            </label>
            <Button className="bg-brand-400 hover:bg-brand-500 text-brand-fg" disabled={busy === "t"} onClick={addTestimonial} data-testid="pp-t-add">
              {busy === "t" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 ml-1" />} הוספת המלצה
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
