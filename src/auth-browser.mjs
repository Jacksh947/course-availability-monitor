import { normalizeKey, totp } from './totp.mjs';

async function visible(locator) {
  for (let i = 0; i < await locator.count(); i++) if (await locator.nth(i).isVisible()) return locator.nth(i);
  return null;
}
async function clickName(page, pattern) {
  for (const role of ['button', 'link']) {
    const locator = await visible(page.getByRole(role, { name: pattern }));
    if (locator) { await locator.click({ timeout: 5000 }); return true; }
  }
  const text = await visible(page.getByText(pattern, { exact: true }));
  if (text) { await text.click({ timeout: 5000 }); return true; }
  return false;
}

export async function authenticateMicrosoft(context, config, credentials, { onStage = () => {} } = {}) {
  if (!credentials?.username || !credentials?.password) throw new Error('authentication_credentials_missing');
  normalizeKey(credentials.seed);
  let lastProgressAt = Date.now();
  let lastStage;
  const stage = name => { if (lastStage !== name) { lastStage = name; lastProgressAt = Date.now(); onStage(name); } };
  const page = await context.newPage();
  await page.goto(config.entry_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  stage('fresh_browser_started');
  let usernameSent = false, passwordSent = false, codeSent = false, methodChosen = false, authenticated = false;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (Date.now() - lastProgressAt > 15000) throw new Error('unrecognized_sign_in_prompt');
    const active = context.pages().at(-1);
    const host = new URL(active.url()).hostname;
    if (host === new URL(config.entry_url).hostname && passwordSent) {
      authenticated = true;
      stage('returned_to_solus');
      break;
    }
    // Never submit credentials to an arbitrary redirect or unfamiliar host.
    if (host !== 'login.microsoftonline.com') {
      await active.waitForTimeout(500);
      continue;
    }
    const username = await visible(active.locator('input[name="loginfmt"]'));
    if (username && !usernameSent) {
      await username.fill(credentials.username);
      usernameSent = true;
      await username.press('Enter');
      stage('username_submitted');
      await active.waitForTimeout(1500);
      continue;
    }
    const password = await visible(active.locator('input[name="passwd"]'));
    if (password && !passwordSent) {
      await password.fill(credentials.password);
      passwordSent = true;
      await password.press('Enter');
      stage('password_submitted_once');
      await active.waitForTimeout(1500);
      continue;
    }
    if (!passwordSent && await clickName(active, /^Use my password$/i)) {
      stage('password_sign_in_selected');
      await active.waitForTimeout(1000);
      continue;
    }
    const code = await visible(active.locator('input[name="otc"], input[id="idTxtBx_SAOTCC_OTC"]'));
    if (code && !codeSent) {
      // Avoid presenting a code just as it expires.
      const remaining = 30000 - Date.now() % 30000;
      if (remaining < 5000) await active.waitForTimeout(remaining + 100);
      await code.fill(totp(credentials.seed));
      codeSent = true;
      await code.press('Enter');
      stage('authenticator_submitted_once');
      await active.waitForTimeout(1500);
      continue;
    }
    if (!methodChosen && await clickName(active, /^Use a verification code(?: from (?:my|your) (?:mobile|authenticator) app)?$/i)) {
      methodChosen = true;
      stage('authenticator_code_selected');
      await active.waitForTimeout(1000);
      continue;
    }
    if (await clickName(active, /^(Sign in another way|I can.t use my Microsoft Authenticator app right now|Use a different verification option)$/i)) {
      stage('verification_options_opened');
      await active.waitForTimeout(1000);
      continue;
    }
    if (await visible(active.getByText('Stay signed in?', { exact: true }))) {
      await clickName(active, /^No$/);
      stage('stay_signed_in_declined');
      await active.waitForTimeout(1000);
      continue;
    }
    const passwordError = await visible(active.locator('#passwordError, #idSpan_SAOTCC_Error_OTC'));
    if (passwordError && (await passwordError.innerText()).trim()) throw new Error('login_or_verification_rejected');
    await active.waitForTimeout(500);
  }
  if (!authenticated) throw new Error('fresh_login_not_completed');
  return { authenticatorUsed: codeSent };
}
