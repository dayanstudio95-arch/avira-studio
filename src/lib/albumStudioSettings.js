// Studio-wide settings the album editor reads (2026-10-08):
//  - branding for the opening spread: logo + a QR to the studio's Instagram + phone — taken from
//    Settings → studio details (tenants.logo_url / instagram_url / phone), nothing typed twice;
//  - layout presets ("⭐ שמור כפריסט"): saved sketch layouts, in app_settings 'album_layout_presets';
//  - the album's chapters (2026-11-05): the studio's list in its order, each with an importance, and how many photos
//    a page holds for each importance — in app_settings 'album_chapters' (albumChapters.js has the defaults).
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { supabase } from "@/api/supabaseClient";
import { base44 } from "@/api/base44Client";
import { DEFAULT_CHAPTERS, DEFAULT_PER_PAGE } from "./albumChapters";

export async function brandingFor({ logoUrl, instagramUrl, phone }) {
  let qrDataUrl = null;
  if (instagramUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(instagramUrl, { margin: 0, width: 600, errorCorrectionLevel: "M", color: { dark: "#333333", light: "#ffffff00" } });
    } catch {
      qrDataUrl = null;
    }
  }
  return { logoUrl: logoUrl || null, qrDataUrl, phone: phone || null };
}

export function useStudioBranding(tenantId) {
  const [state, setState] = useState({ data: null, ready: false });
  useEffect(() => {
    if (!tenantId) return;
    let alive = true;
    supabase
      .from("tenants")
      .select("logo_url, instagram_url, phone")
      .eq("id", tenantId)
      .maybeSingle()
      .then(async ({ data }) => {
        if (!alive || !data) return;
        const b = await brandingFor({ logoUrl: data.logo_url, instagramUrl: data.instagram_url, phone: data.phone });
        if (alive) setState({ data: b, ready: Boolean(b.logoUrl && b.qrDataUrl && b.phone) });
      });
    return () => {
      alive = false;
    };
  }, [tenantId]);
  return state;
}

const PRESETS_KEY = "album_layout_presets";

export async function loadPresets() {
  const rows = await base44.entities.AppSetting.filter({ key: PRESETS_KEY }).catch(() => []);
  try {
    const list = JSON.parse(rows?.[0]?.value || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function savePresetToSettings(preset) {
  const rows = await base44.entities.AppSetting.filter({ key: PRESETS_KEY });
  let list = [];
  try {
    list = JSON.parse(rows?.[0]?.value || "[]");
  } catch {
    list = [];
  }
  const next = JSON.stringify([...list.filter((p) => p.name !== preset.name), preset].slice(-30));
  if (rows?.[0]) await base44.entities.AppSetting.update(rows[0].id, { value: next });
  else await base44.entities.AppSetting.create({ key: PRESETS_KEY, value: next });
}

const CHAPTERS_KEY = "album_chapters";

// → { chapters: [{ id, label, importance }], perPage: { high, mid, low } } — the defaults until the studio changes them
export function parseChapterSettings(value) {
  let v = null;
  try {
    v = JSON.parse(value || "null");
  } catch {
    v = null;
  }
  const chapters = Array.isArray(v?.chapters)
    ? v.chapters.filter((c) => c && typeof c.id === "string" && typeof c.label === "string" && c.label.trim()).map((c) => ({ id: c.id, label: c.label.trim().slice(0, 40), importance: ["low", "mid", "high"].includes(c.importance) ? c.importance : "mid" }))
    : [];
  const perPage = { ...DEFAULT_PER_PAGE };
  for (const k of ["high", "mid", "low"]) {
    const n = Number(v?.perPage?.[k]);
    if (n >= 1 && n <= 12) perPage[k] = n;
  }
  return { chapters: chapters.length ? chapters : DEFAULT_CHAPTERS, perPage };
}

export function useChapterSettings() {
  const [state, setState] = useState({ chapters: DEFAULT_CHAPTERS, perPage: DEFAULT_PER_PAGE, loaded: false });
  const current = useRef(state);
  current.current = state;
  useEffect(() => {
    let alive = true;
    base44.entities.AppSetting.filter({ key: CHAPTERS_KEY })
      .then((rows) => alive && setState({ ...parseChapterSettings(rows?.[0]?.value), loaded: true }))
      .catch(() => alive && setState((s) => ({ ...s, loaded: true })));
    return () => {
      alive = false;
    };
  }, []);
  // save({ chapters?, perPage? }) — shown at once, written to the studio's settings
  const save = useCallback(async (patch) => {
    const next = { ...current.current, ...patch };
    current.current = next;
    setState(next);
    const value = JSON.stringify({ chapters: next.chapters, perPage: next.perPage });
    const rows = await base44.entities.AppSetting.filter({ key: CHAPTERS_KEY });
    if (rows?.[0]) await base44.entities.AppSetting.update(rows[0].id, { value });
    else await base44.entities.AppSetting.create({ key: CHAPTERS_KEY, value });
  }, []);
  return { ...state, save };
}
