import { GitHub } from './github.mjs';
import { sendDueReport } from './reports.mjs';

try {
  const github = new GitHub({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN, key: process.env.STATE_KEY });
  const state = await github.load();
  if (!state) throw new Error('monitor_not_initialized');
  if (await sendDueReport(state, github, new Date().toISOString())) {
    await github.save(state);
    console.log('Five-day status notification recorded.');
  } else console.log('Five-day report is not due yet.');
} catch {
  console.error('Could not verify or deliver the five-day report. Check GitHub Actions notifications.');
  process.exitCode = 1;
}
