import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHub } from '../src/github.mjs';
import { decrypt } from '../src/crypto.mjs';

const key = Buffer.alloc(32, 4).toString('base64');
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('notification retry is idempotent and exposes only generic text', async () => {
  const issues = [];
  const github = new GitHub({ repository: 'fixture/monitor', token: 'placeholder', key, fetchImpl: async (url, request) => {
    if (request.method === 'GET') return response(issues);
    const issue = JSON.parse(request.body); issues.unshift(issue); return response(issue, 201);
  } });
  const notice = { kind: 'availability', generation: 5, fingerprint: 'sensitive-course-and-counts-placeholder' };
  assert.equal(await github.notify(notice), true);
  assert.equal(await github.notify(notice), false);
  assert.equal(issues.length, 1);
  assert(!JSON.stringify(issues).includes('sensitive-course-and-counts-placeholder'));
  assert.deepEqual(issues[0].assignees, ['fixture']);
  assert.equal(await github.notify({ ...notice, generation: 6 }), true);
});

test('remote rolling session is encrypted before it leaves the process', async () => {
  const writes = [];
  const state = { session: { cookie: 'private-cookie-placeholder' } };
  const github = new GitHub({ repository: 'fixture/monitor', token: 'placeholder', key, fetchImpl: async (url, request) => {
    if (url.includes('/contents/state.enc?')) return response({}, 404);
    if (url.endsWith('/git/ref/heads/monitor-state')) return response({}, 404);
    if (url.endsWith('/repos/fixture/monitor')) return response({ default_branch: 'main' });
    if (url.endsWith('/git/ref/heads/main')) return response({ object: { sha: 'fixture-sha' } });
    if (request.method === 'POST') return response({}, 201);
    if (request.method === 'PUT') { writes.push(JSON.parse(request.body)); return response({ content: { sha: 'new-sha' } }, 201); }
    throw new Error('Unexpected fixture request');
  } });
  assert.equal(await github.load(), null);
  await github.save(state);
  const ciphertext = Buffer.from(writes[0].content, 'base64').toString('utf8');
  assert(!ciphertext.includes('private-cookie-placeholder'));
  assert.deepEqual(decrypt(ciphertext, key), state);
  assert.equal(writes[0].branch, 'monitor-state');
});

test('GitHub HTTP errors never copy response bodies into logs', async () => {
  const github = new GitHub({ repository: 'fixture/monitor', token: 'placeholder', key, fetchImpl: async () => response({ secret: 'do-not-log' }, 403) });
  await assert.rejects(() => github.load(), error => error.message === 'github_request_failed');
});

test('temporary GitHub read failures retry without repeating writes', async () => {
  let reads = 0;
  const waits = [];
  const github = new GitHub({ repository: 'fixture/monitor', token: 'placeholder', key,
    sleep: async ms => waits.push(ms), fetchImpl: async () => {
      reads++;
      if (reads === 1) throw new Error('private transport details');
      if (reads === 2) return response({ private: 'never log' }, 503);
      return response({}, 404);
    } });
  assert.equal(await github.load(), null);
  assert.equal(reads, 3);
  assert.deepEqual(waits, [1000, 2000]);
  let writes = 0;
  github.fetch = async () => { writes++; return response({}, 503); };
  await assert.rejects(() => github.request('/issues', { method: 'POST', body: {} }), /github_request_failed/);
  assert.equal(writes, 1);
});
