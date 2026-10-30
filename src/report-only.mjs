import { GitHub } from './github.mjs';
import { sendDueReport } from './reports.mjs';
import { sendStaleWarning } from './health.mjs';

try {
  const github = new GitHub({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN, key: process.env.STATE_KEY });
  const state = await github.load();
  if (!state) throw new Error('monitor_not_initialized');
  const now = new Date().toISOString();
  const warned = await sendStaleWarning(state, github, now);
  const reported = await sendDueReport(state, github, now);
  if (warned || reported) {
    await github.save(state);
    console.log('Monitoring health or five-day status notification recorded.');
  } else console.log('No monitoring health or five-day notification is due.');
} catch {
  console.error('Could not verify or deliver the five-day report. Check GitHub Actions notifications.');
  process.exitCode = 1;
}
