import test from 'node:test';
import assert from 'node:assert/strict';
import { FIVE_DAYS_MS, recordAttempt, dueReport, sendDueReport } from '../src/reports.mjs';

const start = Date.parse('2026-10-30T15:00:00Z');
const iso = delta => new Date(start + delta).toISOString();
const full = { status: 'closed', waitlist_spaces: 0, available_seats: 0, class_capacity: 55, waitlist_capacity: 5 };
function history({ openingAt = -1, failedAt = -1 } = {}) {
  const state = {};
  for (let i = 0; i <= 720; i++) recordAttempt(state, { now: iso(i * 600000), snapshot: i === failedAt ? null : i === openingAt ? { ...full, waitlist_spaces: 1 } : full });
  return state;
}

test('five-day report is based on elapsed time rather than day of month', () => {
  const state = {}; recordAttempt(state, { now: iso(0), snapshot: full });
  assert.equal(dueReport(state, iso(FIVE_DAYS_MS - 1)), null);
  assert.equal(dueReport(state, iso(FIVE_DAYS_MS)).kind, 'report_incomplete');
});
test('healthy closed checks produce the no-openings update', () => assert.equal(dueReport(history(), iso(FIVE_DAYS_MS)).kind, 'report_clear'));
test('a brief opening remains in the report after the class closes again', () => assert.equal(dueReport(history({ openingAt: 17 }), iso(FIVE_DAYS_MS)).kind, 'report_openings'));
test('failed checks prevent an unqualified no-openings statement', () => assert.equal(dueReport(history({ failedAt: 18 }), iso(FIVE_DAYS_MS)).kind, 'report_incomplete'));
test('openings and failures are both reported', () => assert.equal(dueReport(history({ openingAt: 17, failedAt: 18 }), iso(FIVE_DAYS_MS)).kind, 'report_openings_with_gaps'));
test('a stopped browser job produces a gap report from the independent reporter', () => assert.equal(dueReport(history(), iso(FIVE_DAYS_MS + 3600000)).kind, 'report_incomplete'));
test('five-day cadence continues independently of immediate alerts', async () => {
  const state = history({ openingAt: 17 }); const sent = [];
  const github = { notify: async notice => sent.push(notice) };
  assert.equal(await sendDueReport(state, github, iso(FIVE_DAYS_MS)), true);
  assert.equal(await sendDueReport(state, github, iso(FIVE_DAYS_MS + 600000)), false);
  assert.equal(sent.length, 1);
  assert.equal(state.reporting.started_at, iso(FIVE_DAYS_MS));
});
test('delivery failure preserves the due report for retry', async () => {
  const state = history();
  await assert.rejects(() => sendDueReport(state, { notify: async () => { throw new Error('fixture'); } }, iso(FIVE_DAYS_MS)));
  assert.equal(dueReport(state, iso(FIVE_DAYS_MS)).kind, 'report_clear');
});
