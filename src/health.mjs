export async function sendStaleWarning(state, github, now) {
  const lastVerified = state.checked_at || state.reporting?.started_at;
  if (!lastVerified || state.error || state.stale_alert_for === lastVerified) return false;
  if (Date.parse(now) - Date.parse(lastVerified) <= 30 * 60 * 1000) return false;
  await github.notify({ kind: 'stale', generation: lastVerified, fingerprint: 'missing-checks' });
  state.stale_alert_for = lastVerified;
  return true;
}
