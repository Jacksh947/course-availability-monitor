import { playwright, restoreSession, captureSession, navigateAndRead } from './browser.mjs';
import { validateSnapshot } from './rules.mjs';
import { authenticateMicrosoft } from './auth-browser.mjs';

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
  backoffs = [5000, 15000],
  credentials = null,
  authenticate = authenticateMicrosoft,
  forceFreshLogin = false
} = {}) {
  let failure;
  let authAttempted = false;
  let verifiedSession = session;
  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    let browser;
    let context;
    try {
      browser = await launch();
      // Each attempt starts from the last verified session, never a failed page.
      context = forceFreshLogin && !authAttempted
        ? await browser.newContext({ viewport: { width: 1440, height: 1000 } })
        : await restoreSession(browser, verifiedSession);
      if (forceFreshLogin && !authAttempted) {
        authAttempted = true;
        await authenticate(context, config, credentials);
        verifiedSession = await captureSession(context);
      }
      let observation;
      try { observation = await navigate(context, config); }
      catch (error) {
        if (error.message !== 'authentication_required' || !credentials || authAttempted) throw error;
        authAttempted = true;
        // Exactly one credential submission sequence per run; read-only page
        // retries must never cause repeated password or code attempts.
        console.log('Saved sign-in expired; renewing with the dedicated authenticator.');
        await authenticate(context, config, credentials);
        verifiedSession = await captureSession(context);
        observation = await navigate(context, config);
      }
      const snapshot = validateSnapshot(observation, config);
      const refreshedSession = await captureSession(context);
      return { snapshot, session: refreshedSession, attempts: attempt + 1 };
    } catch (error) {
      failure = error;
      failure.diagnostic = context ? await diagnostic(context, config) : [];
      failure.attempts = attempt + 1;
      if (authAttempted && /login_or_verification_rejected|unrecognized_sign_in_prompt|fresh_login_not_completed|authentication_credentials_missing|invalid_authenticator_key/.test(error.message)) break;
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
