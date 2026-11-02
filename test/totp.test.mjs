import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totp, normalizeKey } from '../src/totp.mjs';

test('standard SHA1 authenticator codes match RFC 6238 vectors truncated to six digits', () => {
  const key = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  for (const [seconds, expected] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']]) {
    assert.equal(totp(key, seconds * 1000), expected);
  }
});

test('manual keys accept grouping and reject codes and URLs', () => {
  assert.equal(normalizeKey('gezd gnbv-gy3t qojq'), 'GEZDGNBVGY3TQOJQ');
  for (const input of ['123456', 'otpauth://totp/account?secret=ABC', '', '<script>']) assert.throws(() => normalizeKey(input));
});
