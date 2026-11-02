export async function sendStaleWarning(state, github, now) {
  const lastVerified = state.checked_at || state.reporting?.started_at;
  if (!lastVerified || state.error || state.stale_alert_for === lastVerified) return false;
  const limit = Math.max(30, (state.check_interval_minutes || 10) * 2) * 60 * 1000;
  if (Date.parse(now) - Date.parse(lastVerified) <= limit) return false;
  await github.notify({ kind: 'stale', generation: lastVerified, fingerprint: 'missing-checks' });
  state.stale_alert_for = lastVerified;
  return true;
}
