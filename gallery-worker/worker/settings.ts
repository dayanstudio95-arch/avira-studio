import { cleanDesign } from '../shared/design';
import { DEFAULT_LABEL_MAP } from '../shared/exif';
import type { Env, Settings } from './types';
import { DROPBOX_SECRET, type FilmsStudio, type Store, type TenantInfo } from './store';
import { openSecretOrNull } from './secretBox';

// Avira (2026-10-30): photo galleries only, so the default speaks of photos (Studio Plan's spoke of films only).
export const DEFAULT_TERMS = `הגלריה מיועדת לצפייה ולשימוש אישי של בני הזוג ומשפחתם בלבד.

הגישה לגלריה מוגבלת בזמן. אנו ממליצים להוריד ולגבות את כל התמונות בהקדם, במחשב האישי ובשירות ענן פרטי. בתום תקופת הזמינות הגלריה תיסגר ולא ניתן יהיה להוריד ממנה את התמונות.

התמונות מוגנות בזכויות יוצרים. אין לעשות בהן שימוש מסחרי ללא אישור בכתב מהסטודיו. שיתוף הקישור עם משפחה וחברים מותר.

הסטודיו אינו אחראי לאובדן קבצים שלא הורדו במועד.`;

/** The accent every studio starts with in the hub; the gallery keeps its own gold for it. */
const HUB_DEFAULT_ACCENT = '#facc15';

/**
 * One studio's settings for this request: branding from `tenants`, films-only
 * fields from films_studio_settings, the Dropbox connection from tenant_secrets,
 * and the platform-level Dropbox app and Google key from Worker secrets.
 * A route that already read the studio passes it (`tenant`), so it is not read again (P62).
 * The Dropbox token is stored sealed (fix plan P16, worker/secretBox.ts); one that does not open reads as
 * "not connected".
 */
export async function getSettings(env: Env, store: Store, tenantId: string, tenant?: TenantInfo | null): Promise<Settings> {
  const [t, films, stored] = await Promise.all([
    tenant !== undefined ? tenant : store.getTenant(tenantId),
    store.getFilmsStudio(tenantId),
    store.getSecret(tenantId, DROPBOX_SECRET),
  ]);
  const refreshToken = await openSecretOrNull(env, tenantId, DROPBOX_SECRET, stored);
  return settingsFrom(env, t, films, refreshToken, tenantId);
}

/** The name couples see: the name for clients, else the studio's name. */
export function studioNameOf(tenant: TenantInfo | null | undefined): string {
  return tenant?.displayName || tenant?.name || '';
}

export function settingsFrom(env: Env, tenant: TenantInfo | null, films: FilmsStudio, refreshToken: string | null, tenantId: string): Settings {
  const accent = (tenant?.accentColor ?? '').toLowerCase();
  return {
    studioName: studioNameOf(tenant),
    logoUrl: tenant?.logoUrl ?? '',
    accentColor: /^#[0-9a-f]{6}$/.test(accent) && accent !== HUB_DEFAULT_ACCENT ? accent : '',
    defaultDays: films.defaultDays ?? 30,
    termsText: films.termsText ?? DEFAULT_TERMS,
    contactLine: films.contactLine ?? '',
    instagram: normalizeInstagram(tenant?.instagramUrl ?? ''),
    phone: normalizePhone(tenant?.phone ?? ''),
    facebook: normalizeSocial(tenant?.facebookUrl ?? '', ['facebook.com', 'fb.com']),
    vimeo: films.vimeo ?? '',
    youtube: films.youtube ?? '',
    headline: films.headline ?? '',
    about: films.about ?? '',
    dropbox: {
      appKey: env.DROPBOX_APP_KEY ?? '',
      appSecret: env.DROPBOX_APP_SECRET ?? '',
      refreshToken: refreshToken ?? undefined,
      accountName: films.dropboxAccountName,
      tokenOwnerId: tenantId,
    },
    googleApiKey: env.GOOGLE_API_KEY ?? '',
  };
}

/** What the hub's films settings screen may see: never secrets. */
export function adminView(s: Settings, films: FilmsStudio) {
  return {
    studioName: s.studioName,
    logoUrl: s.logoUrl,
    defaultDays: s.defaultDays,
    termsText: s.termsText,
    termsIsDefault: films.termsText === null,
    contactLine: s.contactLine,
    instagram: s.instagram,
    phone: s.phone,
    facebook: s.facebook,
    vimeo: s.vimeo,
    youtube: s.youtube,
    headline: s.headline,
    about: s.about,
    dropbox: {
      appConfigured: Boolean(s.dropbox.appKey && s.dropbox.appSecret),
      connected: Boolean(s.dropbox.refreshToken),
      accountName: s.dropbox.accountName ?? '',
    },
    google: { hasKey: Boolean(s.googleApiKey) },
    labelSetsOn: films.labelSetsOn === true,
    labelMap: { ...DEFAULT_LABEL_MAP, ...(films.labelMap ?? {}) },
    music: films.music ?? [],
    musicDefault: films.musicDefault ?? '',
    designDefault: cleanDesign(films.designDefault),
  };
}

/** The song a photo gallery's slideshow plays ('' = silent). */
export function musicUrl(tenantId: string, films: FilmsStudio, choice: string | undefined): string {
  if (choice === 'none') return '';
  const id = choice || films.musicDefault || '';
  return films.music?.some((t) => t.id === id) ? `/api/music/${tenantId}/${id}` : '';
}

/** What the couple's page may see. */
export function publicView(s: Settings) {
  return {
    studioName: s.studioName,
    logoUrl: s.logoUrl,
    accentColor: s.accentColor,
    termsText: s.termsText,
    contactLine: s.contactLine,
    instagram: s.instagram,
  };
}

/** "@My.Studio " / "instagram.com/my.studio" → "my.studio". */
export function normalizeInstagram(input: unknown): string {
  let h = String(input ?? '').trim();
  h = h.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '').replace(/^@/, '').trim();
  if (!/^[A-Za-z0-9._]{1,30}$/.test(h)) return '';
  return h.toLowerCase();
}

/** Israeli phone for display and WhatsApp: keeps digits and a leading +; '' when it doesn't look like a phone. */
export function normalizePhone(input: unknown): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  const digits = raw.replace(/[^\d+]/g, '');
  return /^\+?\d{9,15}$/.test(digits) ? raw.replace(/[^\d+\- ]/g, '').trim() : '';
}

/**
 * 050-123-4567 → 972501234567 (for wa.me links). The hub's rule (fix plan P41,
 * apps/hub/src/lib/phone.js): 00972…, +972 (0)50…, a mobile without its leading 0
 * (501234567) are Israeli; a number written with + or 00 keeps its own country code.
 */
export function whatsappNumber(phone: string): string {
  const s = phone.replace(/\(\s*0\s*\)/g, '').trim();
  let d = s.replace(/\D/g, '');
  if (!d) return '';
  if (s.startsWith('00')) d = d.slice(2);
  if (d.startsWith('972')) return `972${d.slice(3).replace(/^0/, '')}`;
  if (d.startsWith('0')) return `972${d.slice(1)}`;
  if (!s.startsWith('+') && !s.startsWith('00') && d.length === 9) return `972${d}`;
  return d;
}

/** Only real links to the named site (https added when missing); '' otherwise. */
export function normalizeSocial(input: unknown, hosts: string[]): string {
  let raw = String(input ?? '').trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    return hosts.some((h) => host === h || host.endsWith(`.${h}`)) ? u.toString() : '';
  } catch {
    return '';
  }
}
