import { supabase } from './supabaseClient';

// Drop-in replacement for the Base44 SDK's `base44.entities.X` interface,
// backed by Supabase tables instead of Base44's hosted entity storage.
//
// Base44 entities used camelCase field names (defaultRate, phoneNumber, ...)
// while the Postgres schema uses snake_case columns — these two maps convert
// between them so page/component code using the old field names keeps working.
const CASE_OVERRIDES = { created_date: 'created_at', updated_date: 'updated_at' };
const CASE_OVERRIDES_REVERSE = { created_at: 'created_date', updated_at: 'updated_date' };
const FILTER_OPERATORS = { $gte: 'gte', $lte: 'lte', $gt: 'gt', $lt: 'lt', $ne: 'neq', $in: 'in' };

const camelToSnake = (key) => key.replace(/([A-Z])/g, '_$1').toLowerCase();
const snakeToCamel = (key) => key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

function toColumn(field) {
  if (field === 'id') return 'id';
  const snake = camelToSnake(field);
  return CASE_OVERRIDES[snake] || snake;
}

function toField(column) {
  return CASE_OVERRIDES_REVERSE[column] || snakeToCamel(column);
}

// Only top-level keys are mapped — jsonb columns (e.g. events.team) keep
// whatever key casing the caller already used inside the nested objects.
function rowToRecord(row) {
  if (!row) return row;
  const record = {};
  for (const [column, value] of Object.entries(row)) record[toField(column)] = value;
  return record;
}

function recordToRow(record) {
  const row = {};
  for (const [field, value] of Object.entries(record)) row[toColumn(field)] = value;
  return row;
}

function parseSort(sort) {
  if (!sort) return null;
  const descending = sort.startsWith('-');
  const field = descending ? sort.slice(1) : sort;
  return { column: toColumn(field), ascending: !descending };
}

function applyFilters(query, filters = {}) {
  for (const [field, value] of Object.entries(filters)) {
    const column = toColumn(field);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [op, opValue] of Object.entries(value)) {
        const method = FILTER_OPERATORS[op];
        if (!method) throw new Error(`Unsupported filter operator "${op}" on "${field}"`);
        query = query[method](column, opValue);
      }
    } else {
      query = query.eq(column, value);
    }
  }
  return query;
}

export function createEntity(table) {
  const runList = async (query) => {
    const { data, error } = await query;
    if (error) throw error;
    return data.map(rowToRecord);
  };

  return {
    async list(sort, limit) {
      let query = supabase.from(table).select('*');
      const parsedSort = parseSort(sort);
      if (parsedSort) query = query.order(parsedSort.column, { ascending: parsedSort.ascending });
      if (limit) query = query.limit(limit);
      return runList(query);
    },
    async filter(filters, sort, limit) {
      let query = applyFilters(supabase.from(table).select('*'), filters);
      const parsedSort = parseSort(sort);
      if (parsedSort) query = query.order(parsedSort.column, { ascending: parsedSort.ascending });
      if (limit) query = query.limit(limit);
      return runList(query);
    },
    async get(id) {
      const { data, error } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return rowToRecord(data);
    },
    async create(record) {
      const { data, error } = await supabase.from(table).insert(recordToRow(record)).select().single();
      if (error) throw error;
      return rowToRecord(data);
    },
    async update(id, record) {
      const { data, error } = await supabase.from(table).update(recordToRow(record)).eq('id', id).select().single();
      if (error) throw error;
      return rowToRecord(data);
    },
    async delete(id) {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw error;
      return true;
    },
  };
}

export const entities = {
  Tenant: createEntity('tenants'),
  Event: createEntity('events'),
  Lead: createEntity('leads'),
  StaffMember: createEntity('staff_members'),
  Package: createEntity('packages'),
  DiscountPreset: createEntity('discount_presets'),
  AppSetting: createEntity('app_settings'),
  // True secrets (WhatsApp/Morning API keys) — moved out of app_settings by migration
  // 0019_tenant_secrets.sql (2026-08-17 security audit, Step 4: app_settings' RLS is
  // tenant-only with no role check, so any tenant member could read raw credentials;
  // this table is admin-only at the RLS layer, covering select too).
  TenantSecret: createEntity('tenant_secrets'),
  Automation: createEntity('automations'),
  EventAutomation: createEntity('event_automations'),
  PendingAutomation: createEntity('pending_automations'),
  AutomationRun: createEntity('automation_runs'),
  AutomationMessageLog: createEntity('automation_message_logs'),
  GoogleCalendarAccount: createEntity('google_calendar_accounts'),
  EventCalendarSync: createEntity('event_calendar_syncs'),
  // Read-only from the frontend — rows are only ever written by the log_audit_event()
  // trigger (migration 0024_audit_log.sql), never by app code directly.
  AuditLog: createEntity('audit_logs'),
  // Per-user AI Assistant chat history + pending WhatsApp-action proposals
  // (migration 0025_ai_assistant_chat.sql). RLS scoped to tenant_id AND
  // user_id = auth.uid() — each user only ever sees their own conversation.
  AiAssistantMessage: createEntity('ai_assistant_messages'),
  // In-app + WhatsApp notifications (migration 0026_notifications_trigger.sql), v1
  // scope: contract-signed only. RLS is admin-only (owner/admin/studio_manager),
  // same pattern as tenant_secrets — rows are inserted by the DB trigger, never by
  // frontend code; the frontend only reads/marks-as-read via NotificationBell.jsx.
  Notification: createEntity('notifications'),
  // Wedding Albums module (migration 0031_wedding_albums.sql) — fully separate from
  // the pre-existing simple album marker on `events` (album_status etc.), see
  // CLAUDE.md's "Wedding Albums module" section. RLS: standard tenant-isolation on
  // most of these; album_products/album_covers/album_addons/print_access_links have
  // open SELECT + owner/admin/studio_manager/album_manager-gated writes.
  AlbumOrder: createEntity('album_orders'),
  AlbumVersion: createEntity('album_versions'),
  AlbumSpread: createEntity('album_spreads'),
  AlbumReviewRound: createEntity('album_review_rounds'),
  AlbumSpreadDecision: createEntity('album_spread_decisions'),
  AlbumProduct: createEntity('album_products'),
  AlbumCover: createEntity('album_covers'),
  AlbumAddon: createEntity('album_addons'),
  // Added in 0033_album_catalog_richness.sql — dedicated engraving catalogs
  // (color swatches / font previews), imported from the old system's real data.
  AlbumEngravingColor: createEntity('album_engraving_colors'),
  AlbumEngravingFont: createEntity('album_engraving_fonts'),
  AlbumOrderSelection: createEntity('album_order_selections'),
  AlbumOrderAddon: createEntity('album_order_addons'),
  PrintAccessLink: createEntity('print_access_links'),
  PrintAccessEvent: createEntity('print_access_events'),
  // Album Guide Page (migration 0039_album_guide.sql) — a separate, generic
  // (one row per tenant) couple-facing informational page explaining the album-
  // ordering process, sent as a companion link alongside the gallery link. Fully
  // isolated from the album_orders/... purchase-wizard tables above and from the
  // legacy events.album_status marker — see CLAUDE.md's Wedding Albums module
  // section.
  AlbumGuideContent: createEntity('album_guide_content'),
  AlbumGuideFaqItem: createEntity('album_guide_faq_items'),
  // migration 0040 — per-cover preview image + multi-example sketch
  // galleries for the Album Guide page (see CLAUDE.md, same isolation rule).
  AlbumGuideCoverPreview: createEntity('album_guide_cover_previews'),
  AlbumGuideSketchExample: createEntity('album_guide_sketch_examples'),
  AlbumGuideSketchExampleImage: createEntity('album_guide_sketch_example_images'),
  // Two-way staff availability confirmation (migration 0041) — append-only log of
  // WhatsApp availability-check links sent to staff + their pending/available/declined
  // response. RLS admin-only, same as Notification above. Written by
  // StaffAvailabilityModal.jsx (create, client-side token mint) and read back in
  // UnifiedSidePanel.jsx; the public response page never uses this entity directly --
  // it goes through respond-staff-availability-public with a service-role client.
  StaffAvailabilityRequest: createEntity('staff_availability_requests'),
};
