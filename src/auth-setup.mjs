import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { encrypt, decrypt } from './crypto.mjs';
import { normalizeKey, totp } from './totp.mjs';

process.umask(0o077);
const directory = resolve(process.argv[2] || 'private');
await mkdir(directory, { recursive: true, mode: 0o700 });
const keyPath = join(directory, 'auth-test.key');
const vaultPath = join(directory, 'auth-test.enc');
const route = process.argv[4] || '/' + randomUUID();
if (!/^\/[a-f0-9-]{36}$/.test(route)) throw new Error('invalid_setup_route');
const csrf = randomBytes(32).toString('hex');
const protectedForm = '<form method="POST"><input type="hidden" name="csrf" value="' + csrf + '">';
let origin;
let saved = false;
const document = (title, body) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{font:18px system-ui;max-width:680px;margin:45px auto;padding:20px;line-height:1.5}input:not([type=checkbox]):not([type=hidden]){display:block;width:95%;font:inherit;padding:8px;margin:5px 0 20px}button{font:inherit;padding:12px}label{display:block;margin:15px 0}strong.code{font:48px monospace;letter-spacing:6px}</style><h1>${title}</h1>${body.replaceAll('<form method="POST">', protectedForm)}`;
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.url !== route || `http://${req.headers.host}` !== origin) { res.writeHead(404).end(); return; }
  if (req.method === 'GET') {
    res.end(document('Private SOLUS login test setup', saved ? '<p>Credentials saved locally. Use the button to display a fresh verification code.</p><form method="POST"><input type="hidden" name="refresh" value="yes"><button>Show verification code</button></form>' : `<p>In Microsoft Security info, choose <b>Set up a different authentication app</b>. Continue until the QR code appears, then use the option to show the manual setup key. Keep that QR code and key private.</p><form method="POST"><label>Queen’s sign-in email<input name="username" type="email" required autocomplete="username"></label><label>Queen’s password<input name="password" type="password" required autocomplete="off"></label><label>New authenticator setup key (not a six-digit code)<input name="seed" type="password" required autocomplete="off" spellcheck="false"></label><label><input type="checkbox" name="consent" value="yes" required> I authorize saving these credentials privately on this Mac and using them for one automated SOLUS login test. These credentials can sign in to my broader Queen’s account. Nothing will be uploaded to GitHub by this form.</label><button>Save locally and show verification code</button></form><p>Your current phone authenticator should remain in place.</p>`));
    return;
  }
  // The embedded browser can proxy Origin. Require the unguessable form token
  // and exact local Host instead of depending on browser-specific headers.
  if (req.method !== 'POST' || !/^application\/x-www-form-urlencoded(?:;|$)/i.test(req.headers['content-type'] || '')) { res.writeHead(403).end('Request rejected.'); return; }
  try {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 8192) throw new Error('request_too_large');
    }
    const form = new URLSearchParams(body);
    if (form.get('csrf') !== csrf) { res.writeHead(403).end('This form expired. Reload the setup page and try again.'); return; }
    if (form.get('refresh') !== 'yes') {
      if (saved || form.get('consent') !== 'yes') throw new Error('consent_required');
      const username = (form.get('username') || '').trim();
      const password = form.get('password') || '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username) || !password) throw new Error('invalid_credentials');
      const seed = normalizeKey(form.get('seed'));
      const key = randomBytes(32).toString('base64');
      // A distinct key keeps this local test separate from the existing cloud state.
      // Exclusive creation prevents silently replacing an earlier credential setup.
      await writeFile(keyPath, key, { mode: 0o600, flag: 'wx' });
      await writeFile(vaultPath, encrypt({ username, password, seed, consent: 'one-local-login-test', saved_at: new Date().toISOString() }, key), { mode: 0o600, flag: 'wx' });
      saved = true;
      console.log('Local credentials saved with user consent. No credentials uploaded.');
    }
    if (!saved) throw new Error('not_saved');
    const credentials = decrypt(await readFile(vaultPath, 'utf8'), await readFile(keyPath, 'utf8'));
    const code = totp(credentials.seed);
    res.end(document('Finish authenticator setup', `<p>Enter this code on Microsoft’s verification screen:</p><p><strong class="code">${code}</strong></p><p>The code changes every 30 seconds. If it is rejected or expires, use the button below.</p><form method="POST"><input type="hidden" name="refresh" value="yes"><button>Show a fresh code</button></form><p>Once Microsoft confirms the new method was added, return to Codex and say <b>Authenticator added</b>. The login test and cloud setup have not run yet.</p>`));
  } catch {
    res.writeHead(400).end(document('Setup not completed', '<p>Check that you entered the manual authenticator key rather than a QR image or six-digit code, and selected the consent checkbox. If the form was already saved, return to Codex rather than saving a second time.</p>'));
  }
});
await new Promise(resolve => server.listen(Number(process.argv[3] || 0), '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;
console.log(JSON.stringify({ setup_url: origin + route, expires_in_minutes: 45 }));
setTimeout(() => server.close(), 45 * 60 * 1000).unref();
