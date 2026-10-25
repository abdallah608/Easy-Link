import fs from 'fs/promises';
import path from 'path';
import { paths, commentsConfig } from '../config.js';
import { atomicWriteJson, readJson, ensureDir } from '../utils/atomicWrite.js';
import { normalizeOrderNo } from '../utils/normalize.js';

/** @typedef {{ id: number, order_no: string, comment: string, author: string, author_username: string, created_at: string, edited_at: string|null, deleted: number }} CommentRow */

let lock = Promise.resolve();

function withLock(fn) {
  const run = lock.then(fn);
  lock = run.catch(() => {});
  return run;
}

async function loadStore() {
  const data = await readJson(paths.orderComments, { comments: [], nextId: 1 });
  if (!Array.isArray(data.comments)) data.comments = [];
  if (!data.nextId) data.nextId = 1;
  return data;
}

async function saveStore(data) {
  await ensureDir(path.dirname(paths.orderComments));
  await atomicWriteJson(paths.orderComments, data);
}

export function validateCommentText(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return { ok: false, code: 'COMMENT_EMPTY' };
  if (trimmed.length > 1000) return { ok: false, code: 'COMMENT_TOO_LONG' };
  return { ok: true, value: trimmed };
}

export async function initCommentsDb() {
  await ensureDir(paths.data);
  await ensureDir(path.dirname(paths.orderComments));
  const store = await loadStore();
  await saveStore(store);
}

export async function addComment(orderNo, text, author, authorUsername) {
  const key = normalizeOrderNo(orderNo);
  const v = validateCommentText(text);
  if (!v.ok) throw Object.assign(new Error(v.code), { code: v.code });
  if (!key) throw Object.assign(new Error('INVALID_ORDER'), { code: 'INVALID_ORDER' });

  return withLock(async () => {
    const store = await loadStore();
    const id = store.nextId++;
    /** @type {CommentRow} */
    const row = {
      id,
      order_no: key,
      comment: v.value,
      author: String(author || '').trim() || authorUsername,
      author_username: String(authorUsername || '').trim(),
      created_at: new Date().toISOString(),
      edited_at: null,
      deleted: 0,
    };
    store.comments.push(row);
    await saveStore(store);
    return row;
  });
}

function activeComments(comments, orderNo) {
  const key = normalizeOrderNo(orderNo);
  return comments
    .filter((c) => c.deleted === 0 && c.order_no === key)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function getComments(orderNo) {
  const store = await loadStore();
  return activeComments(store.comments, orderNo);
}

export async function getCommentById(id) {
  const store = await loadStore();
  return store.comments.find((c) => c.id === Number(id) && c.deleted === 0) || null;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function getCommentCounts(orderNos) {
  const keys = [...new Set(orderNos.map(normalizeOrderNo).filter(Boolean))];
  const counts = Object.fromEntries(keys.map((k) => [k, 0]));
  if (!keys.length) return counts;

  const store = await loadStore();
  for (const part of chunk(keys, 500)) {
    const set = new Set(part);
    for (const c of store.comments) {
      if (c.deleted === 0 && set.has(c.order_no)) {
        counts[c.order_no] = (counts[c.order_no] || 0) + 1;
      }
    }
  }
  return counts;
}

export async function getLatestComments(orderNos) {
  const keys = [...new Set(orderNos.map(normalizeOrderNo).filter(Boolean))];
  /** @type {Record<string, { text: string, created_at: string, author: string, edited_at: string|null }>} */
  const latest = {};
  if (!keys.length) return latest;

  const store = await loadStore();
  const keySet = new Set(keys);
  const byOrder = new Map();
  for (const c of store.comments) {
    if (c.deleted !== 0 || !keySet.has(c.order_no)) continue;
    const prev = byOrder.get(c.order_no);
    if (!prev || c.created_at > prev.created_at) {
      byOrder.set(c.order_no, c);
    }
  }
  for (const [k, c] of byOrder) {
    latest[k] = {
      text: c.comment,
      created_at: c.created_at,
      author: c.author,
      edited_at: c.edited_at,
    };
  }
  return latest;
}

export async function updateComment(id, newText, _actor) {
  const v = validateCommentText(newText);
  if (!v.ok) throw Object.assign(new Error(v.code), { code: v.code });

  return withLock(async () => {
    const store = await loadStore();
    const row = store.comments.find((c) => c.id === Number(id) && c.deleted === 0);
    if (!row) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    row.comment = v.value;
    row.edited_at = new Date().toISOString();
    await saveStore(store);
    return row;
  });
}

export async function deleteComment(id, _actor) {
  return withLock(async () => {
    const store = await loadStore();
    const row = store.comments.find((c) => c.id === Number(id) && c.deleted === 0);
    if (!row) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    row.deleted = 1;
    row.edited_at = new Date().toISOString();
    await saveStore(store);
    return row;
  });
}

export async function countOrdersWithComments(orderNos) {
  const keys = [...new Set(orderNos.map(normalizeOrderNo).filter(Boolean))];
  if (!keys.length) return 0;
  const counts = await getCommentCounts(keys);
  return keys.filter((k) => (counts[k] || 0) > 0).length;
}

export async function totalActiveComments() {
  const store = await loadStore();
  return store.comments.filter((c) => c.deleted === 0).length;
}

export async function countCommentsNotInOrderSet(orderNos) {
  const keySet = new Set(orderNos.map(normalizeOrderNo).filter(Boolean));
  const store = await loadStore();
  const ordersWithHidden = new Set();
  for (const c of store.comments) {
    if (c.deleted === 0 && !keySet.has(c.order_no)) ordersWithHidden.add(c.order_no);
  }
  let commentRows = 0;
  for (const c of store.comments) {
    if (c.deleted === 0 && !keySet.has(c.order_no)) commentRows += 1;
  }
  return { orders: ordersWithHidden.size, comments: commentRows };
}

export async function backupCommentsStore() {
  await ensureDir(paths.commentsBackups);
  try {
    await fs.access(paths.orderComments);
  } catch {
    return null;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(paths.commentsBackups, `order_comments-${stamp}.json`);
  await fs.copyFile(paths.orderComments, dest);
  await pruneBackups();
  return dest;
}

async function pruneBackups() {
  const keep = commentsConfig.backupKeepDays;
  let files = [];
  try {
    files = await fs.readdir(paths.commentsBackups);
  } catch {
    return;
  }
  const sorted = files
    .filter((f) => f.startsWith('order_comments-') && f.endsWith('.json'))
    .sort()
    .reverse();
  for (const f of sorted.slice(keep)) {
    await fs.unlink(path.join(paths.commentsBackups, f)).catch(() => {});
  }
}

export async function getCommentsStorageInfo() {
  let writable = false;
  try {
    await ensureDir(paths.data);
    const probe = path.join(paths.data, '.write-probe');
    await fs.writeFile(probe, 'ok');
    await fs.unlink(probe);
    writable = true;
  } catch {
    writable = false;
  }
  const ephemeral =
    paths.data.includes('/tmp') ||
    paths.data.includes('\\tmp') ||
    paths.data.includes('Temp');
  return {
    backend: 'json',
    path: paths.orderComments,
    dataDir: paths.data,
    writable,
    ephemeralWarning: ephemeral,
    appTz: commentsConfig.appTz,
    totalComments: await totalActiveComments(),
  };
}
