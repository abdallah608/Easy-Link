import { matchSearch } from './permissions.js';
import { isGarbageStatusLabel } from '../utils/normalize.js';

function buildCountedOptions(rows, pick, limit = 20) {
  const map = new Map();
  for (const row of rows) {
    const value = String(pick(row) ?? '').trim();
    if (!value || isGarbageStatusLabel(value)) continue;
    map.set(value, (map.get(value) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

export function filterByMonth(rows, month, reportingYear) {
  if (!month || month === 'all') return rows;
  const m = Number(month);
  if (!Number.isFinite(m)) return rows;
  return rows.filter((r) => r.month === m && r.reportingYear === reportingYear);
}

function parseListParam(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const SORT_KEYS = {
  companyName: (r) => r.companyName,
  orderIdentifier: (r) => r.orderIdentifier,
  revenue: (r) => r.revenue || 0,
  month: (r) => r.month || 0,
  stage: (r) => r.stage,
  statusText: (r) => r.statusText,
  kamName: (r) => r.kamNameOriginal,
};

export function sortRows(rows, sortBy, sortDir) {
  if (!sortBy || !SORT_KEYS[sortBy]) return rows;
  const pick = SORT_KEYS[sortBy];
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = pick(a);
    const bv = pick(b);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

export function applyOrderQueryFilters(rows, query, reportingYear) {
  let visible = rows;

  const status = query.status ? String(query.status) : null;
  if (status && ['applied', 'underActivation', 'lost'].includes(status)) {
    visible = visible.filter((r) => r.status === status);
  }

  // Under Activation = open backlog: month filter only when user picks a month (not "all").
  const monthParam = query.month ? String(query.month) : 'all';
  const skipMonthForOpenBacklog =
    status === 'underActivation' && (!monthParam || monthParam === 'all');
  if (!skipMonthForOpenBacklog && monthParam && monthParam !== 'all') {
    visible = filterByMonth(visible, monthParam, reportingYear);
  }

  const company = query.company ? String(query.company) : '';
  if (company) {
    visible = visible.filter((r) => r.companyName === company);
  }

  let statusTexts = parseListParam(query.statusTexts);
  if (!statusTexts.length && query.statusText) statusTexts = [String(query.statusText)];
  if (statusTexts.length) {
    visible = visible.filter((r) => statusTexts.includes(r.statusText));
  }

  let stages = parseListParam(query.stages);
  if (!stages.length && query.stage) stages = [String(query.stage)];
  if (stages.length) {
    visible = visible.filter((r) => stages.includes(r.stage));
  }

  const search = query.search ? String(query.search) : '';
  if (search) visible = visible.filter((r) => matchSearch(r, search));

  return sortRows(visible, query.sortBy, query.sortDir);
}

export function collectOrderFilterOptions(rows, { status, month, reportingYear }) {
  let base = rows;
  if (status && ['applied', 'underActivation', 'lost'].includes(status)) {
    base = base.filter((r) => r.status === status);
  }
  const monthParam = month ? String(month) : 'all';
  const skipMonthForOpenBacklog =
    status === 'underActivation' && (!monthParam || monthParam === 'all');
  if (!skipMonthForOpenBacklog && monthParam && monthParam !== 'all') {
    base = filterByMonth(base, monthParam, reportingYear);
  }

  const companies = [...new Set(base.map((r) => r.companyName).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  const statusOptions = buildCountedOptions(base, (r) => r.statusText);
  const stageOptions = buildCountedOptions(base, (r) => r.stage);
  const statusTexts = statusOptions.map((o) => o.value);
  const stages = stageOptions.map((o) => o.value);

  return { companies, statusTexts, stages, statusOptions, stageOptions };
}

export function buildOrderIndexes(rows) {
  const byMonth = new Map();
  const byCompany = new Map();
  const byPerson = new Map();
  for (const row of rows) {
    const mk = `${row.reportingYear}-${row.month ?? 'x'}`;
    if (!byMonth.has(mk)) byMonth.set(mk, []);
    byMonth.get(mk).push(row);
    if (row.companyName) {
      if (!byCompany.has(row.companyName)) byCompany.set(row.companyName, []);
      byCompany.get(row.companyName).push(row);
    }
    if (row.personId) {
      if (!byPerson.has(row.personId)) byPerson.set(row.personId, []);
      byPerson.get(row.personId).push(row);
    }
  }
  return { byMonth, byCompany, byPerson };
}
