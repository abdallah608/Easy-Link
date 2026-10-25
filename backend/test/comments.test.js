import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { normalizeOrderNo, isPendingSdmStage } from '../src/utils/normalize.js';

test('normalizeOrderNo variants', () => {
  assert.equal(normalizeOrderNo('1-275036737820'), '1-275036737820');
  assert.equal(normalizeOrderNo(' 1-275036737820 '), '1-275036737820');
  assert.equal(normalizeOrderNo(275036737820.0), '275036737820');
  assert.equal(normalizeOrderNo('١-275036737820'), '1-275036737820');
});

test('isPendingSdmStage case insensitive', () => {
  assert.equal(isPendingSdmStage('Pending SDM'), true);
  assert.equal(isPendingSdmStage('  pending sdm  '), true);
  assert.equal(isPendingSdmStage('Pending FP'), false);
});

test('comments CRUD and upload isolation', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'easylink-comments-'));
  process.env.EASYLINK_DATA_DIR = tmp;
  process.env.COMMENTS_STORE_PATH = path.join(tmp, 'data', 'order_comments.json');

  const { paths } = await import('../src/config.js');
  await import('../src/services/store.js').then((m) => m.initDataDirs());
  const { initCommentsDb, addComment, getComments, getCommentCounts, getLatestComments, updateComment, deleteComment } =
    await import('../src/services/commentsDb.js');
  await initCommentsDb();

  const row = await addComment('1-275036737820', 'مرحبا 👋', 'Ali', 'ali');
  assert.ok(row.id);
  assert.equal(row.order_no, '1-275036737820');

  const list = await getComments('1-275036737820');
  assert.equal(list.length, 1);
  assert.equal(list[0].comment, 'مرحبا 👋');

  const counts = await getCommentCounts(['1-275036737820']);
  assert.equal(counts['1-275036737820'], 1);

  const latest = await getLatestComments(['1-275036737820']);
  assert.equal(latest['1-275036737820'].text, 'مرحبا 👋');

  await updateComment(row.id, 'updated', 'ali');
  const afterEdit = await getComments('1-275036737820');
  assert.equal(afterEdit[0].comment, 'updated');
  assert.ok(afterEdit[0].edited_at);

  await deleteComment(row.id, 'ali');
  assert.equal((await getComments('1-275036737820')).length, 0);

  const xlsxBefore = await fs.readFile(paths.currentXlsx).catch(() => null);
  await fs.writeFile(paths.currentXlsx, Buffer.from('fake'));
  const still = await getCommentCounts(['1-275036737820']);
  assert.equal(still['1-275036737820'], 0);
  if (xlsxBefore) await fs.writeFile(paths.currentXlsx, xlsxBefore);

  delete process.env.EASYLINK_DATA_DIR;
  delete process.env.COMMENTS_STORE_PATH;
});

test('comment permission helpers', async () => {
  const { assertOrderVisible, canModifyComment } = await import('../src/services/commentsService.js');
  const visible = [{ orderNo: 'ORDER-A' }];
  assert.equal(assertOrderVisible('ORDER-A', visible), 'ORDER-A');
  assert.throws(() => assertOrderVisible('ORDER-B', visible), (e) => e.code === 'FORBIDDEN');

  const comment = { author_username: 'emp1' };
  const emp = { username: 'emp1' };
  const other = { username: 'other' };
  assert.equal(canModifyComment(comment, emp, 'employee'), true);
  assert.equal(canModifyComment(comment, other, 'employee'), false);
  assert.equal(canModifyComment(comment, other, 'admin'), true);
});
