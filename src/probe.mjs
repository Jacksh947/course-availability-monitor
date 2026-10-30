import { playwright, restoreSession, captureSession, navigateAndRead } from './browser.mjs';
import { validateSnapshot } from './rules.mjs';

async function diagnostic(context, config) {
  const result = [];
  for (const page of context.pages()) for (const frame of page.frames()) {
    try {
      const url = new URL(frame.url());
      const sameSite = url.hostname === new URL(config.entry_url).hostname;
      result.push({ origin: url.origin, path: url.pathname,
        text: sameSite ? (await frame.locator('body').innerText({ timeout: 3000 })).slice(0, 8000) : '' });
    } catch { /* Ignore detached frames; diagnostic text stays encrypted. */ }
  }
  return result;
}

export async function probeAvailability(config, session, {
  launch = () => playwright().chromium.launch({ headless: true }),
  navigate = navigateAndRead,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  onRetry = () => {},
  backoffs = [5000, 15000]
} = {}) {
  let failure;
  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    let browser;
    let context;
    try {
      browser = await launch();
      // Each attempt starts from the last verified session, never a failed page.
      context = await restoreSession(browser, session);
      const snapshot = validateSnapshot(await navigate(context, config), config);
      const refreshedSession = await captureSession(context);
      return { snapshot, session: refreshedSession, attempts: attempt + 1 };
    } catch (error) {
      failure = error;
      failure.diagnostic = context ? await diagnostic(context, config) : [];
      failure.attempts = attempt + 1;
    } finally {
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }
    if (attempt < backoffs.length) {
      onRetry(attempt + 1);
      await sleep(backoffs[attempt]);
    }
  }
  throw failure;
}
