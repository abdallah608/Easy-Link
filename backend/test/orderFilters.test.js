import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOrderQueryFilters, collectOrderFilterOptions } from '../src/services/orderFilters.js';

const rows = [
  { status: 'underActivation', month: 8, reportingYear: 2026, stage: 'Pending FP', statusText: 'Pending', companyName: 'A' },
  { status: 'underActivation', month: 10, reportingYear: 2026, stage: 'Pending SDM', statusText: 'Pending', companyName: 'B' },
  { status: 'applied', month: 10, reportingYear: 2026, stage: '', statusText: 'Applied', companyName: 'C' },
];

test('underActivation with month=all returns every open row', () => {
  const out = applyOrderQueryFilters(rows, { status: 'underActivation', month: 'all' }, 2026);
  assert.equal(out.length, 2);
});

test('underActivation with explicit month filters that month only', () => {
  const out = applyOrderQueryFilters(rows, { status: 'underActivation', month: '8' }, 2026);
  assert.equal(out.length, 1);
  assert.equal(out[0].month, 8);
});

test('applied still respects month filter', () => {
  const out = applyOrderQueryFilters(rows, { status: 'applied', month: '10' }, 2026);
  assert.equal(out.length, 1);
  assert.equal(out[0].status, 'applied');
});

test('filter options for underActivation month=all include all stages', () => {
  const opts = collectOrderFilterOptions(rows, {
    status: 'underActivation',
    month: 'all',
    reportingYear: 2026,
  });
  assert.equal(opts.stageOptions.length, 2);
});
