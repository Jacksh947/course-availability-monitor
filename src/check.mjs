import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { probeAvailability } from './probe.mjs';
import { changes } from './rules.mjs';
import { GitHub } from './github.mjs';
import { recordAttempt, sendDueReport } from './reports.mjs';

process.umask(0o077);
const local = process.argv.includes('--local');
let github;
let state;
let attemptRecorded = false;
try {
  let config;
  if (local) {
    config = JSON.parse(await readFile(process.env.MONITOR_CONFIG_PATH, 'utf8'));
    const initial = JSON.parse(await readFile(process.env.MONITOR_SESSION_PATH, 'utf8'));
    state = { session: initial.session, previous: initial.snapshot, generation: 0 };
  } else {
    github = new GitHub({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN, key: process.env.STATE_KEY });
    if (process.env.MONITOR_MODE === 'test_alert') {
      await github.notify({ kind: 'test', generation: process.env.GITHUB_RUN_ID, fingerprint: 'delivery-test' });
      console.log('Test notification created. Confirm receipt before enabling monitoring.');
      process.exit(0);
    }
    config = JSON.parse(process.env.MONITOR_CONFIG);
    state = await github.load();
    const initial = JSON.parse(gunzipSync(Buffer.from(process.env.SESSION_INITIAL, 'base64')).toString('utf8'));
    if (!state) {
      state = { session: initial.session, previous: initial.snapshot, generation: 0, session_bootstrap_at: initial.saved_at };
    } else if (Date.parse(initial.saved_at) > Date.parse(state.session_bootstrap_at || '1970-01-01')) {
      // A freshly saved manual login replaces an expired rolling session.
      state.session = initial.session;
      state.session_bootstrap_at = initial.saved_at;
    }
  }
  if (!config.entry_url?.startsWith('https://')) throw new Error('invalid_config');
  const probe = await probeAvailability(config, state.session, {
    onRetry: attempt => console.log(`Availability attempt ${attempt} was inconclusive; retrying in a fresh browser.`)
  });
  const current = probe.snapshot;
  recordAttempt(state, { now: new Date().toISOString(), snapshot: current });
  attemptRecorded = true;
  const events = changes(state.previous, current);
  if (github && events.length) await github.notify({ kind: 'availability', generation: state.generation, fingerprint: JSON.stringify({ events, current }) });
  if (github && (state.error || state.stale_alert_for)) await github.notify({ kind: 'recovered', generation: state.generation, fingerprint: 'recovered' });
  state.session = probe.session;
  state.previous = current;
  state.error = null;
  delete state.diagnostic;
  delete state.failed_attempts;
  delete state.stale_alert_for;
  state.generation += 1;
  state.checked_at = new Date().toISOString();
  if (github) await sendDueReport(state, github, state.checked_at);
  if (github) await github.save(state);
  if (local) {
    console.log(JSON.stringify({ verified: true, snapshot: current, events }));
    // A successful local test renews the private bootstrap session.
    await writeFile(process.env.MONITOR_SESSION_PATH, JSON.stringify({ session: state.session, snapshot: current, saved_at: state.checked_at }), { mode: 0o600 });
  } else console.log(events.length ? 'Check completed; an availability notification was recorded.' : 'Check completed; no new availability signal.');
} catch (error) {
  const known = new Set(['authentication_required', 'navigation_not_verified', 'availability_not_verified', 'term_not_verified', 'target_not_verified', 'invalid_availability', 'unrecognized_status']);
  const code = known.has(error.message) ? error.message : 'monitor_check_failed';
  if (github && state) {
    try {
      if (!attemptRecorded) recordAttempt(state, { now: new Date().toISOString() });
      if (state.error !== code) await github.notify({ kind: code === 'authentication_required' ? 'authentication' : 'interruption', generation: state.generation, fingerprint: code });
      state.error = code;
      // Troubleshooting stays inside the encrypted state, never public logs.
      state.diagnostic = error.diagnostic || [];
      state.failed_attempts = error.attempts || 0;
      await sendDueReport(state, github, new Date().toISOString());
      // Keep the last verified session; never overwrite it with a signed-out page.
      await github.save(state);
    } catch { console.error('Could not persist state or deliver the interruption notification.'); }
  }
  console.error(`Monitoring interrupted: ${code}.`);
  process.exitCode = 1;
}
