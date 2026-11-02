import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decrypt } from '../src/crypto.mjs';

test('local setup accepts embedded-browser posts, rejects forged forms, and saves only encrypted credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solus-setup-test-'));
  const child = spawn(process.execPath, ['src/auth-setup.mjs', directory], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const url = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('helper_start_timeout')), 10000);
      child.once('error', reject);
      child.once('exit', code => { clearTimeout(timeout); reject(new Error('helper_exit_' + code)); });
      child.stdout.once('data', data => { clearTimeout(timeout); resolve(JSON.parse(String(data)).setup_url); });
    });
    const page = await fetch(url);
    assert.equal(page.status, 200);
    const html = await page.text();
    const csrf = html.match(/name="csrf" value="([a-f0-9]+)"/)[1];
    const post = (values, origin) => fetch(url, { method: 'POST', headers: origin === undefined ? {} : { Origin: origin }, body: new URLSearchParams(values) });
    assert.equal((await post({ refresh: 'yes' }, 'null')).status, 403);
    assert.equal((await post({ refresh: 'yes' }, 'https://unrelated.example')).status, 403);
    assert.equal((await post({ csrf, refresh: 'yes' })).status, 400);
    const fake = { csrf, consent: 'yes', username: 'dummy@example.test', password: 'dummy-password-not-real', seed: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' };
    const result = await post(fake, 'null');
    assert.equal(result.status, 200);
    const resultHtml = await result.text();
    assert.match(resultHtml, /class="code">\d{6}</);
    assert.ok(!resultHtml.includes(fake.password) && !resultHtml.includes(fake.seed));
    const vault = await readFile(join(directory, 'auth-test.enc'), 'utf8');
    assert.ok(!vault.includes(fake.password) && !vault.includes(fake.seed));
    const key = await readFile(join(directory, 'auth-test.key'), 'utf8');
    assert.equal(decrypt(vault, key).password, fake.password);
    for (const name of ['auth-test.enc', 'auth-test.key']) assert.equal((await stat(join(directory, name))).mode & 0o777, 0o600);
    assert.equal((await post({ csrf, refresh: 'yes' })).status, 200);
    assert.equal((await post({ csrf, refresh: 'yes' }, 'https://embedded-browser.example')).status, 200);
  } finally {
    child.kill();
    await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
