import test from 'node:test';
import assert from 'node:assert/strict';
import { playwright } from '../src/browser.mjs';
import { probeAvailability } from '../src/probe.mjs';
import { sendStaleWarning } from '../src/health.mjs';

const config = { course: 'TEST 100', term: '2027 Winter', class_number: '1234', entry_url: 'https://portal.example/course' };
const snapshot = { ...config, status: 'Closed', class_capacity: 55, enrolment_total: 55, available_seats: 0, waitlist_capacity: 5, waitlist_total: 5 };
const session = { storageState: { cookies: [{ name: 'fixture', value: 'last-verified', domain: 'portal.example', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax' }], origins: [] }, sessionStorage: {} };

test('a transient failure recovers using a fresh browser and the last verified session', async () => {
  const browsers = [];
  let attempts = 0;
  const waits = [];
  const result = await probeAvailability(config, session, {
    launch: async () => { const b = await playwright().chromium.launch({ headless: true }); browsers.push(b); return b; },
    sleep: async ms => waits.push(ms),
    navigate: async context => {
      attempts++;
      assert.equal((await context.cookies())[0].value, 'last-verified');
      if (attempts === 1) {
        await context.addCookies([{ ...session.storageState.cookies[0], value: 'failed-session' }]);
        throw new Error('navigation_not_verified');
      }
      return snapshot;
    }
  });
  assert.equal(result.attempts, 2);
  assert.equal(result.snapshot.class_number, '1234');
  assert.deepEqual(waits, [5000]);
  assert(browsers.every(b => !b.isConnected()));
  assert.equal(session.storageState.cookies[0].value, 'last-verified');
});

test('persistent sign-in failure exhausts bounded retries without inventing availability', async () => {
  const browsers = [];
  const waits = [];
  await assert.rejects(() => probeAvailability(config, session, {
    launch: async () => { const b = await playwright().chromium.launch({ headless: true }); browsers.push(b); return b; },
    sleep: async ms => waits.push(ms),
    navigate: async () => { throw new Error('authentication_required'); }
  }), error => error.message === 'authentication_required' && error.attempts === 3);
  assert.deepEqual(waits, [5000, 15000]);
  assert.equal(browsers.length, 3);
  assert(browsers.every(b => !b.isConnected()));
});

test('expired sessions are renewed once and then availability is verified', async () => {
  let authenticated = false, loginCalls = 0;
  const result = await probeAvailability(config, session, {
    credentials: { username: 'fixture', password: 'fixture', seed: 'fixture' },
    authenticate: async () => { authenticated = true; loginCalls++; },
    navigate: async () => { if (!authenticated) throw new Error('authentication_required'); return snapshot; },
    sleep: async () => {}
  });
  assert.equal(loginCalls, 1);
  assert.equal(result.snapshot.class_number, '1234');
});

test('rejected credentials stop without further browser or password attempts', async () => {
  let loginCalls = 0;
  await assert.rejects(() => probeAvailability(config, session, {
    credentials: { username: 'fixture', password: 'fixture', seed: 'fixture' },
    authenticate: async () => { loginCalls++; throw new Error('login_or_verification_rejected'); },
    navigate: async () => { throw new Error('authentication_required'); },
    sleep: async () => { throw new Error('must_not_retry'); }
  }), error => error.message === 'login_or_verification_rejected' && error.attempts === 1);
  assert.equal(loginCalls, 1);
});

test('missing checks warn early, once per gap, without claiming expired sign-in', async () => {
  const notices = [];
  const github = { notify: async n => notices.push(n) };
  const state = { checked_at: '2026-10-30T12:00:00Z' };
  assert.equal(await sendStaleWarning(state, github, '2026-10-30T12:30:00Z'), false);
  assert.equal(await sendStaleWarning(state, github, '2026-10-30T12:31:00Z'), true);
  assert.equal(await sendStaleWarning(state, github, '2026-10-30T13:31:00Z'), false);
  assert.equal(notices[0].kind, 'stale');
  assert.equal(notices.length, 1);
  const slower = { checked_at: '2026-10-30T12:00:00Z', check_interval_minutes: 30 };
  assert.equal(await sendStaleWarning(slower, github, '2026-10-30T12:45:00Z'), false);
  assert.equal(await sendStaleWarning(slower, github, '2026-10-30T13:01:00Z'), true);
  const knownFailure = { checked_at: state.checked_at, error: 'authentication_required' };
  assert.equal(await sendStaleWarning(knownFailure, github, '2026-10-30T14:00:00Z'), false);
});

test('failed gap-warning delivery is retried rather than marked delivered', async () => {
  const state = { checked_at: '2026-10-30T12:00:00Z' };
  await assert.rejects(() => sendStaleWarning(state, { notify: async () => { throw new Error('offline'); } }, '2026-10-30T13:00:00Z'));
  assert.equal(state.stale_alert_for, undefined);
});
