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
  Automation: createEntity('automations'),
  EventAutomation: createEntity('event_automations'),
  PendingAutomation: createEntity('pending_automations'),
  AutomationRun: createEntity('automation_runs'),
  AutomationMessageLog: createEntity('automation_message_logs'),
};
