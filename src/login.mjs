import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { playwright, readPage, captureSession } from './browser.mjs';
import { validateSnapshot } from './rules.mjs';

process.umask(0o077);
const [configPath, outputPath] = process.argv.slice(2);
if (!configPath || !outputPath) throw new Error('Usage: node src/login.mjs CONFIG_PATH PRIVATE_SESSION_PATH');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const browser = await playwright().chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const token = randomUUID();
let saving = false;
let finished;
const done = new Promise(resolve => { finished = resolve; });
const server = createServer(async (req, res) => {
  if (req.url !== `/${token}`) { res.writeHead(404).end(); return; }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>Save monitor sign-in</title><style>body{font:20px system-ui;max-width:650px;margin:70px auto;padding:20px}button{font:inherit;padding:12px 22px}</style><h1>Save your SOLUS sign-in</h1><p>In the other tab, sign in to Queen’s, open your target class, and select <b>Class Availability</b>. Then return here.</p><form method="POST"><button>Save monitor sign-in</button></form><p>Your password stays in the Queen’s sign-in page. This helper saves the signed-in browser session privately on your computer.</p>');
    return;
  }
  if (req.method !== 'POST' || saving) { res.writeHead(405).end(); return; }
  saving = true;
  try {
    const snapshot = validateSnapshot(await readPage(context, config), config);
    const session = await captureSession(context);
    await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
    await writeFile(outputPath, JSON.stringify({ session, snapshot, saved_at: new Date().toISOString() }), { mode: 0o600 });
    console.log(JSON.stringify({ saved: true, snapshot }));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>Saved</title><h1>Sign-in saved</h1><p>You can return to Codex. The cloud monitor is not active yet.</p>');
    finished();
  } catch {
    saving = false;
    res.writeHead(409, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><title>Check the class page</title><p>The expected class and availability table could not be confirmed. Leave Class Availability open in the other tab, then go back and try Save again.</p>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const setup = await context.newPage();
await setup.goto(`http://127.0.0.1:${server.address().port}/${token}`);
const portal = await context.newPage();
await portal.goto(config.login_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
console.log('Sign in in the browser, open Class Availability, then use the Save monitor sign-in tab.');
await Promise.race([done, new Promise(resolve => browser.once('disconnected', resolve))]);
server.close();
await browser.close();
