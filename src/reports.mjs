import { signal } from './rules.mjs';

export const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
const GAP_LIMIT_MS = 30 * 60 * 1000;

export function recordAttempt(state, { now, snapshot = null }) {
  state.reporting ||= { started_at: now, successes: 0, failures: 0, openings: 0, max_gap_ms: 0 };
  const report = state.reporting;
  const last = report.last_attempt_at || report.started_at;
  report.max_gap_ms = Math.max(report.max_gap_ms, Date.parse(now) - Date.parse(last));
  report.last_attempt_at = now;
  if (snapshot) {
    report.successes++;
    const availability = signal(snapshot);
    if (availability.waitlist || availability.seats) report.openings++;
  } else report.failures++;
}

export function dueReport(state, now) {
  const report = state.reporting;
  if (!report || Date.parse(now) - Date.parse(report.started_at) < FIVE_DAYS_MS) return null;
  const elapsed = Date.parse(now) - Date.parse(report.started_at);
  const lastGap = Date.parse(now) - Date.parse(report.last_attempt_at || report.started_at);
  const expected = Math.floor(elapsed / (10 * 60 * 1000));
  const incomplete = report.failures > 0 || state.error || Math.max(lastGap, report.max_gap_ms) > GAP_LIMIT_MS || report.successes < expected * 0.8;
  // Known openings are reported even if the remaining monitoring had gaps.
  const kind = report.openings > 0 ? (incomplete ? 'report_openings_with_gaps' : 'report_openings') : incomplete ? 'report_incomplete' : 'report_clear';
  return { kind, generation: report.started_at, fingerprint: 'five-day-report' };
}

export async function sendDueReport(state, github, now) {
  const notice = dueReport(state, now);
  if (!notice) return false;
  await github.notify(notice);
  state.reporting = { started_at: now, successes: 0, failures: 0, openings: 0, max_gap_ms: 0, last_attempt_at: now };
  return true;
}
