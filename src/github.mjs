import { createHash } from 'node:crypto';
import { encrypt, decrypt } from './crypto.mjs';

export class GitHub {
  constructor({ repository, token, key, fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) throw new Error('invalid_repository');
    this.repository = repository;
    this.token = token;
    this.key = key;
    this.fetch = fetchImpl;
    this.sleep = sleep;
    this.root = `https://api.github.com/repos/${repository}`;
  }

  async request(path, { method = 'GET', body, allow404 = false } = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await this.fetch(`${this.root}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    } catch {
      if (method === 'GET' && attempt < 2) { await this.sleep(1000 * (attempt + 1)); continue; }
      throw new Error('github_request_failed');
    }
    if (allow404 && response.status === 404) return null;
    if (method === 'GET' && (response.status >= 500 || response.status === 429) && attempt < 2) {
      const retryAfter = Number(response.headers.get('Retry-After')) * 1000;
      // Never ignore a long rate-limit backoff or retry a write blindly.
      if (retryAfter > 10000) throw new Error('github_request_failed');
      await this.sleep(Math.max(1000 * (attempt + 1), retryAfter || 0));
      continue;
    }
    if (!response.ok) throw new Error('github_request_failed');
    return response.status === 204 ? null : response.json();
    }
  }

  async load() {
    const file = await this.request('/contents/state.enc?ref=monitor-state', { allow404: true });
    this.fileSha = file?.sha;
    return file ? decrypt(Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8'), this.key) : null;
  }

  async save(state) {
    if (!this.fileSha) {
      const branch = await this.request('/git/ref/heads/monitor-state', { allow404: true });
      if (!branch) {
        const repo = await this.request('');
        const head = await this.request(`/git/ref/heads/${encodeURIComponent(repo.default_branch)}`);
        await this.request('/git/refs', { method: 'POST', body: { ref: 'refs/heads/monitor-state', sha: head.object.sha } });
      }
    }
    const response = await this.request('/contents/state.enc', { method: 'PUT', body: {
      branch: 'monitor-state', message: 'Update encrypted monitor state [skip ci]',
      content: Buffer.from(encrypt(state, this.key)).toString('base64'), ...(this.fileSha ? { sha: this.fileSha } : {})
    } });
    this.fileSha = response.content.sha;
  }

  async notify({ kind, generation, fingerprint }) {
    const id = createHash('sha256').update(JSON.stringify({ kind, generation, fingerprint })).digest('hex');
    const marker = `<!-- monitor-event:${id} -->`;
    // Handles a successful notification followed by a failed state save without sending it again.
    const existing = await this.request('/issues?state=all&sort=created&direction=desc&per_page=100');
    if (existing.some(issue => issue.body?.includes(marker))) return false;
    const messages = {
      availability: ['Course availability changed', 'An availability or capacity change was detected for your privately configured course. Sign in to your student portal and check the class. Availability can change again before you act.'],
      interruption: ['Course monitor needs attention', 'The monitor could not verify fresh availability after automatic retries in fresh browsers. The portal may be temporarily unavailable or its layout may have changed. It will continue retrying on subsequent checks and will not present old counts as current. If the interruption persists, ask Codex to inspect the failed run.'],
      authentication: ['Course monitor: sign-in needs attention', 'Automatic sign-in could not be completed. If credentials were rejected or an unfamiliar verification prompt appeared, further automatic login attempts are paused to avoid repeatedly submitting credentials. Ask Codex to inspect the failed run before requesting a fresh_check to resume. Current availability could not be confirmed.'],
      stale: ['Course monitor: checks are delayed', 'No successful availability check has been recorded within the monitoring grace period. This may be a scheduling or hosting problem; it does not establish that your sign-in expired. The monitor cannot confirm current availability. Review the Actions dashboard or ask Codex to investigate.'],
      recovered: ['Course monitoring resumed', 'The monitor can verify fresh availability again.'],
      report_clear: ['Five-day update: no openings detected', 'The successful checks in the last five-day reporting period detected no waitlist or course-seat openings. Monitoring continues. Brief openings between checks can still be missed.'],
      report_openings: ['Five-day update: openings were detected', 'Waitlist or course-seat availability was detected during the last five-day reporting period. Opening alerts were handled separately. Sign in to your student portal for current availability; a previous opening may already be filled. Monitoring continues.'],
      report_openings_with_gaps: ['Five-day update: openings detected; monitoring had gaps', 'Waitlist or course-seat availability was detected during this reporting period, and some checks failed or were missed. Sign in for current availability and review the monitoring interruption alerts.'],
      report_incomplete: ['Five-day update: monitoring had gaps', 'Some availability checks failed or were missed during this reporting period. No opening was recorded in the successful checks, but the monitor cannot confirm an uninterrupted five days without openings. Review the monitoring interruption alerts.'],
      test: ['Course monitor: test notification', 'This is a delivery test. It does not indicate that a place is available.']
    };
    const [title, body] = messages[kind];
    await this.request('/issues', { method: 'POST', body: { title, body: `${body}\n\n${marker}`, assignees: [this.repository.split('/')[0]] } });
    return true;
  }
}
