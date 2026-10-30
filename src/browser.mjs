import { createRequire } from 'node:module';

export function playwright() {
  const require = createRequire(import.meta.url);
  return require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
}

export async function captureSession(context) {
  const storageState = await context.storageState({ indexedDB: true });
  const sessionStorage = {};
  for (const page of context.pages()) for (const frame of page.frames()) {
    try {
      const entry = await frame.evaluate(() => ({ origin: location.origin, values: { ...window.sessionStorage } }));
      if (entry.origin.startsWith('https://')) sessionStorage[entry.origin] = entry.values;
    } catch { /* A frame may detach during navigation. */ }
  }
  return { storageState, sessionStorage };
}

export async function restoreSession(browser, session) {
  const context = await browser.newContext({ storageState: session.storageState, viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(saved => {
    const values = saved[location.origin];
    if (values) for (const [key, value] of Object.entries(values)) sessionStorage.setItem(key, value);
  }, session.sessionStorage || {});
  return context;
}

export async function readPage(context, target) {
  const frames = context.pages().filter(p => new URL(p.url()).protocol === 'https:').flatMap(p => p.frames());
  const documents = [];
  for (const frame of frames) {
    try {
      documents.push(await frame.evaluate(() => ({
        text: document.body?.innerText || '',
        tables: [...document.querySelectorAll('table')].filter(t => t.getClientRects().length).map(table => {
          let scope = table.parentElement;
          // Bind the numbers to their own class-information container, rather than
          // a different class link visible behind the modal.
          while (scope?.parentElement && !/Lecture\s*[-–]\s*\d+/i.test(scope.innerText)) scope = scope.parentElement;
          const group = scope ? [...scope.querySelectorAll('table')] : [table];
          return { scopeText: scope?.innerText || '', rows: group.flatMap(t => [...t.rows].map(row => [...row.cells].map(cell => cell.innerText.replace(/\s+/g, ' ').trim()))).filter(row => row.some(Boolean)) };
        })
      })));
    } catch { /* Detached frames are ignored. */ }
  }
  const visibleText = documents.map(d => d.text).join('\n').replace(/\s+/g, ' ');
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactToken = value => new RegExp(`(?:^|[^A-Za-z0-9])${escape(value).replace(/ /g, '\\s+')}(?=$|[^A-Za-z0-9])`, 'i');
  if (!exactToken(target.term).test(visibleText)) throw new Error('term_not_verified');
  const labels = ['Class Capacity', 'Enrolment Total', 'Available Seats', 'Waitlist Capacity', 'Waitlist Total'];
  for (const doc of documents) {
    if (!exactToken(target.course).test(doc.text) || !new RegExp(`Lecture\\s*[-–]\\s*${escape(target.class_number)}\\b`, 'i').test(doc.text)) continue;
    for (const table of doc.tables) {
      if (!exactToken(target.course).test(table.scopeText)) continue;
      const classNumbers = [...table.scopeText.matchAll(/Lecture\s*[-–]\s*(\d+)\b/gi)].map(m => m[1]);
      if (!classNumbers.length || classNumbers.some(number => number !== target.class_number)) continue;
      const status = table.scopeText.match(/Status\s*:\s*(Closed|Waitlist|Open)\b/i)?.[1];
      if (!status) continue;
      const rows = table.rows;
      for (let i = 0; i < rows.length - 1; i++) {
      const normalize = text => text.toLowerCase().replace('enrollment', 'enrolment');
      const indices = labels.map(label => rows[i].findIndex(cell => normalize(cell) === normalize(label)));
      if (indices.some(index => index < 0)) continue;
      const values = indices.map(index => rows[i + 1][index]);
      if (!values.every(value => /^\d+$/.test(value || ''))) continue;
      return { course: target.course, term: target.term, class_number: target.class_number, status,
        class_capacity: values[0], enrolment_total: values[1], available_seats: values[2], waitlist_capacity: values[3], waitlist_total: values[4] };
      }
    }
  }
  throw new Error('availability_not_verified');
}

async function clickVisible(context, text, linksOnly = false) {
  for (const page of context.pages()) for (const frame of page.frames()) {
    const loc = linksOnly ? frame.getByRole('link', { name: text, exact: true }) : frame.getByText(text, { exact: true });
    for (let i = 0; i < await loc.count(); i++) {
      if (await loc.nth(i).isVisible()) { await loc.nth(i).click({ timeout: 8000 }); return true; }
    }
  }
  return false;
}

export async function navigateAndRead(context, config) {
  const page = await context.newPage();
  await page.goto(config.entry_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const deadline = Date.now() + (config.navigation_timeout_ms || 60000);
  // Only information links are clicked here. No enrolment controls are used.
  let lastActionAt = 0;
  let authenticationSeenAt = null;
  while (Date.now() < deadline) {
    try { return await readPage(context, config); } catch { /* Wait for loading or open the information modal. */ }
    const urls = context.pages().map(p => p.url());
    if (urls.some(url => /login\.microsoftonline\.com|login\.live\.com/i.test(url))) {
      authenticationSeenAt ??= Date.now();
      // Permit an automatic SSO redirect; never fill credentials or approve MFA.
      if (Date.now() - authenticationSeenAt > 15000) throw new Error('authentication_required');
      await new Promise(resolve => setTimeout(resolve, 500));
      continue;
    }
    authenticationSeenAt = null;
    let termVerified = false;
    for (const candidate of context.pages()) for (const frame of candidate.frames()) {
      const term = frame.getByText(config.term, { exact: true });
      for (let i = 0; i < await term.count(); i++) if (await term.nth(i).isVisible()) termVerified = true;
    }
    if (!termVerified) {
      // Never search or read a different term merely because its class IDs match.
      await new Promise(resolve => setTimeout(resolve, 500));
      continue;
    }
    // PeopleSoft can display links before its loading handlers are ready. A
    // successful click is not proof of navigation; retry only after a cooldown.
    if (Date.now() - lastActionAt < 3000) {
      await new Promise(resolve => setTimeout(resolve, 500));
      continue;
    }
    const clicked = await clickVisible(context, 'Class Availability') ||
      await clickVisible(context, `Lecture - ${config.class_number}`) ||
      await clickVisible(context, config.course, true);
    if (clicked) lastActionAt = Date.now();
    if (!clicked) {
      for (const candidate of context.pages()) for (const frame of candidate.frames()) {
        const search = frame.getByPlaceholder('Enter keyword e.g. course, subject, class, topic', { exact: true });
        if (await search.count() === 1 && await search.isVisible()) {
          await search.fill(config.course);
          await search.press('Enter');
          lastActionAt = Date.now();
        }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('navigation_not_verified');
}
