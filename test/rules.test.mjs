import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSnapshot, changes } from '../src/rules.mjs';
import { encrypt, decrypt } from '../src/crypto.mjs';

const target = { course: 'TEST 100', term: '2027 Winter', class_number: '1234' };
const raw = { ...target, status: 'Closed', class_capacity: '55', enrolment_total: '55', available_seats: '0', waitlist_capacity: '5', waitlist_total: '5' };
const snapshot = (update = {}) => validateSnapshot({ ...raw, ...update }, target);
const baseline = snapshot();

test('full course and full waitlist remain quiet', () => assert.deepEqual(changes(baseline, snapshot()), []));
test('one waitlist space triggers an alert', () => assert.deepEqual(changes(baseline, snapshot({ waitlist_total: 4 })), ['waitlist_available']));
test('several waitlist spaces trigger an alert', () => assert.deepEqual(changes(baseline, snapshot({ waitlist_total: 2 })), ['waitlist_available']));
test('status-only waitlist change triggers an alert', () => assert.deepEqual(changes(baseline, snapshot({ status: 'Waitlist' })), ['waitlist_available']));
test('direct enrolment opening triggers an alert', () => assert.deepEqual(changes(baseline, snapshot({ status: 'Open', available_seats: 3, enrolment_total: 52 })), ['seats_reported_available']));
test('numeric seats with closed status are reported as a possible opportunity', () => assert.deepEqual(changes(baseline, snapshot({ available_seats: 1, enrolment_total: 54 })), ['seats_reported_available']));
test('capacity increase and seats are both recognized', () => assert.deepEqual(changes(baseline, snapshot({ class_capacity: 65, available_seats: 10 })), ['seats_reported_available', 'class_capacity_increased']));
test('capacity increase can be reported without assuming enrolment is possible', () => assert.deepEqual(changes(baseline, snapshot({ class_capacity: 60 })), ['class_capacity_increased']));
test('waitlist capacity is read dynamically', () => assert.deepEqual(changes(baseline, snapshot({ waitlist_capacity: 8 })), ['waitlist_available', 'waitlist_capacity_increased']));
test('unchanged availability does not repeat alerts', () => { const open = snapshot({ status: 'Waitlist', waitlist_total: 4 }); assert.deepEqual(changes(open, open), []); });
test('more availability causes a new alert', () => assert.deepEqual(changes(snapshot({ waitlist_total: 4 }), snapshot({ waitlist_total: 3 })), ['waitlist_available']));
test('waitlist to seats causes a new alert', () => assert.deepEqual(changes(snapshot({ status: 'Waitlist', waitlist_total: 4 }), snapshot({ status: 'Open', waitlist_total: 4, available_seats: 1 })), ['seats_reported_available']));
test('reopening after becoming full alerts again', () => assert.deepEqual(changes(baseline, snapshot({ waitlist_total: 4 })), ['waitlist_available']));
test('an opening on the first run alerts', () => assert.deepEqual(changes(null, snapshot({ available_seats: 2 })), ['seats_reported_available']));
test('wrong class, course, or term is rejected', () => { for (const key of ['class_number', 'course', 'term']) assert.throws(() => snapshot({ [key]: 'wrong' }), /target_not_verified/); });
test('missing, negative and non-numeric fields fail closed', () => { for (const value of [undefined, null, '', -1, '1 of 5', NaN]) assert.throws(() => snapshot({ available_seats: value }), /invalid_availability/); });
test('unknown status fails closed', () => assert.throws(() => snapshot({ status: 'Sign in' }), /unrecognized_status/));
test('overfull counts do not create fake waitlist spaces', () => assert.deepEqual(changes(baseline, snapshot({ waitlist_total: 6 })), []));
test('state encryption is randomized and authenticated', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const data = { session: { cookie: 'private-placeholder' }, previous: baseline };
  const a = encrypt(data, key); const b = encrypt(data, key);
  assert.notEqual(a, b); assert(!a.includes('private-placeholder'));
  assert.deepEqual(decrypt(a, key), data);
  assert.throws(() => decrypt(a, Buffer.alloc(32, 8).toString('base64')));
  const corrupt = JSON.parse(a); corrupt.tag = Buffer.alloc(16).toString('base64');
  assert.throws(() => decrypt(JSON.stringify(corrupt), key));
});
