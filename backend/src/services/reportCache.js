import fs from 'fs/promises';
import { paths } from '../config.js';
import { validateAndParseFile } from './excelImport.js';
import { buildAliasMap, resolveKamPersonId, isIctRow } from './identity.js';
import { loadConfig, loadPeople, saveMetadata, withImportLock } from './store.js';
import { atomicWriteBuffer } from '../utils/atomicWrite.js';
import { buildOrderIndexes } from './orderFilters.js';

/** @typedef {'applied'|'underActivation'|'lost'} OrderStatus */

/**
 * @typedef {Object} OrderRow
 * @property {string} id
 * @property {OrderStatus} status
 * @property {string} sourceSheet
 * @property {number} sourceRow
 * @property {string} kamNameOriginal
 * @property {string} kamName
 * @property {string} kamStatus
 * @property {string} companyName
 * @property {string} authorizedName
 * @property {string} authorizedMobile
 * @property {string} orderIdentifier
 * @property {string} msisdn
 * @property {string} packageName
 * @property {number} mrc
 * @property {string} type
 * @property {string} sfa
 * @property {string} statusText
 * @property {string} stage
 * @property {number} revenue
 * @property {number|null} month
 * @property {number} reportingYear
 * @property {string|null} [personId]
 * @property {boolean} [ict]
 */

let cache = {
  loaded: false,
  rows: /** @type {OrderRow[]} */ ([]),
  unassignedNames: /** @type {string[]} */ ([]),
  rowCounts: { applied: 0, underActivation: 0, lost: 0 },
  lastUploadAt: null,
  reportMeta: /** @type {null | { reportNumber: string, reportStatus: string, fileName: string }} */ (null),
  indexes: /** @type {ReturnType<typeof buildOrderIndexes> | null} */ (null),
};

function extractReportNumber(fileName) {
  const base = String(fileName || '')
    .replace(/\.xlsx$/i, '')
    .trim();
  const m = base.match(/report[_\s-]?(\d{4}[_\s-]?\d{1,2}[_\s-]?\d{1,2})/i);
  if (m) return m[1].replace(/[_\s-]+/g, '-');
  return base || 'unknown';
}

export function getReportCache() {
  return cache;
}

function enrichRows(rows, people, config) {
  const aliasMap = buildAliasMap(people, config.kamAliases);
  const unassigned = new Map();

  const enriched = rows.map((row) => {
    const personId = resolveKamPersonId(row.kamNameOriginal, aliasMap);
    if (!personId) {
      unassigned.set(normalizeName(row.kamNameOriginal), row.kamNameOriginal);
    }
    return {
      ...row,
      personId,
      ict: isIctRow(row, config.ictTypes || []),
    };
  });

  return {
    rows: enriched,
    unassignedNames: [...unassigned.values()].sort((a, b) => a.localeCompare(b)),
  };
}

function normalizeName(v) {
  return String(v).trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildIndexes(rows) {
  const counts = { applied: 0, underActivation: 0, lost: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

export async function rebuildCacheFromDisk() {
  const config = await loadConfig();
  const people = await loadPeople();
  try {
    await fs.access(paths.currentXlsx);
  } catch {
    cache = {
      loaded: true,
      rows: [],
      unassignedNames: [],
      rowCounts: { applied: 0, underActivation: 0, lost: 0 },
      lastUploadAt: null,
    };
    return cache;
  }

  const parsed = await validateAndParseFile(paths.currentXlsx, config.reportingYear);
  const allRows = [...parsed.applied, ...parsed.underActivation, ...parsed.lost];
  const { rows, unassignedNames } = enrichRows(allRows, people, config);
  const metadata = await (await import('./store.js')).loadMetadata();
  cache = {
    loaded: true,
    rows,
    unassignedNames,
    rowCounts: buildIndexes(rows),
    lastUploadAt: metadata.lastUploadAt,
    reportMeta: metadata.reportNumber
      ? {
          reportNumber: metadata.reportNumber,
          reportStatus: metadata.reportStatus || 'active',
          fileName: metadata.fileName || 'current.xlsx',
        }
      : null,
    indexes: buildOrderIndexes(rows),
  };
  return cache;
}

export async function commitWorkbookReplacement(tempPath, { originalFileName } = {}) {
  return withImportLock(async () => {
    const config = await loadConfig();
    const people = await loadPeople();
    const parsed = await validateAndParseFile(tempPath, config.reportingYear);
    const allRows = [...parsed.applied, ...parsed.underActivation, ...parsed.lost];
    const { rows, unassignedNames } = enrichRows(allRows, people, config);

    const buffer = await fs.readFile(tempPath);
    await atomicWriteBuffer(paths.currentXlsx, buffer);

    const now = new Date().toISOString();
    const prevMeta = await (await import('./store.js')).loadMetadata();
    const reportNumber = extractReportNumber(originalFileName || 'current.xlsx');
    const history = Array.isArray(prevMeta.uploadHistory) ? [...prevMeta.uploadHistory] : [];
    history.unshift({
      at: now,
      fileName: originalFileName || 'upload.xlsx',
      reportNumber,
      rowCounts: buildIndexes(rows),
      action: 'replace',
    });
    await saveMetadata({
      lastUploadAt: now,
      rowCounts: buildIndexes(rows),
      reportingYear: config.reportingYear,
      reportNumber,
      reportStatus: 'active',
      fileName: originalFileName || 'current.xlsx',
      uploadHistory: history.slice(0, 30),
    });

    cache = {
      loaded: true,
      rows,
      unassignedNames,
      rowCounts: buildIndexes(rows),
      lastUploadAt: now,
      reportMeta: {
        reportNumber,
        reportStatus: 'active',
        fileName: originalFileName || 'current.xlsx',
      },
      indexes: buildOrderIndexes(rows),
    };

    try {
      await fs.unlink(tempPath);
    } catch {
      /* ignore */
    }

    let commentStats = null;
    try {
      const { pendingSdmCommentStatsAfterUpload } = await import('./commentsService.js');
      commentStats = await pendingSdmCommentStatsAfterUpload();
    } catch {
      commentStats = null;
    }

    return {
      rowCounts: cache.rowCounts,
      lastUploadAt: now,
      unassignedCount: unassignedNames.length,
      reportNumber,
      importedRows: rows.length,
      commentStats,
    };
  });
}

export function refreshIdentityOnPeopleChange(people, config) {
  if (!cache.loaded) return;
  const { rows, unassignedNames } = enrichRows(cache.rows, people, config);
  cache = { ...cache, rows, unassignedNames };
}
