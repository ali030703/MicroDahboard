const SUPPORTED_CHART_TEMPLATES = ['bar', 'bar-horizontal', 'line', 'doughnut', 'polar'];
const SUPPORTED_AGGREGATIONS = new Set(['count', 'sum', 'avg', 'min', 'max']);
const TEMPLATE_FAMILIES = ['compact', 'balanced', 'analytical', 'visual'];
const MAX_LABEL_COLUMNS = 10;
const DEFAULT_CATEGORY_LIMIT = 12;

function clamp(value, min, max) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function toSlug(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAggregation(value) {
  const normalized = String(value || '').trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (['avg', 'average', 'mean'].includes(normalized)) {
    return 'avg';
  }

  if (['sum', 'total', 'totals'].includes(normalized)) {
    return 'sum';
  }

  if (['min', 'minimum', 'lowest', 'smallest'].includes(normalized)) {
    return 'min';
  }

  if (['max', 'maximum', 'highest', 'largest'].includes(normalized)) {
    return 'max';
  }

  if (['count', 'counts', 'number', 'frequency', 'distribution', 'rows'].includes(normalized)) {
    return 'count';
  }

  return SUPPORTED_AGGREGATIONS.has(normalized) ? normalized : null;
}

function normalizeOptionalString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeOptionalSortBy(value) {
  const normalized = String(value ?? '').trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized.includes('label') || normalized.includes('name') || normalized.includes('category')) {
    return 'label';
  }

  if (normalized.includes('value') || normalized.includes('metric') || normalized.includes('measure')) {
    return 'value';
  }

  return null;
}

function normalizeOptionalSortDirection(value) {
  const normalized = String(value ?? '').trim().toLowerCase();

  if (normalized === 'asc' || normalized === 'ascending') {
    return 'asc';
  }

  if (normalized === 'desc' || normalized === 'descending') {
    return 'desc';
  }

  return null;
}

function normalizeOptionalBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function parseOptionalTopLimit(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  return clamp(numeric, 1, 99);
}

function formatFilterValueForSummary(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => formatFilterValueForSummary(entry)).filter(Boolean).join(', ');
  }

  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return String(value);
}

function normalizeName(value) {
  return String(value ?? '')
    .trim()
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatReadableList(values) {
  const items = (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  if (!items.length) {
    return '';
  }

  if (items.length === 1) {
    return items[0];
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

module.exports = {
  clamp,
  toSlug,
  clone,
  isObject,
  normalizeAggregation,
  normalizeOptionalString,
  normalizeOptionalSortBy,
  normalizeOptionalSortDirection,
  normalizeOptionalBoolean,
  parseOptionalTopLimit,
  formatFilterValueForSummary,
  normalizeName,
  normalizeNumber,
  formatReadableList,
  SUPPORTED_AGGREGATIONS,
  SUPPORTED_CHART_TEMPLATES,
  TEMPLATE_FAMILIES,
  MAX_LABEL_COLUMNS,
  DEFAULT_CATEGORY_LIMIT,
};
