import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

process.umask(0o077);
const [configPath, sessionPath, outputDirectory] = process.argv.slice(2);
if (!outputDirectory) throw new Error('Usage: node src/prepare-secrets.mjs CONFIG_PATH SESSION_PATH PRIVATE_OUTPUT_DIRECTORY');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const initial = JSON.parse(await readFile(sessionPath, 'utf8'));
if (!initial.session?.storageState || !initial.saved_at) throw new Error('invalid_saved_session');
const session = gzipSync(JSON.stringify(initial)).toString('base64');
if (Buffer.byteLength(session) > 47000) throw new Error('saved_session_exceeds_github_secret_limit');
await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
try { await writeFile(join(outputDirectory, 'STATE_KEY'), randomBytes(32).toString('base64'), { flag: 'wx', mode: 0o600 }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
await writeFile(join(outputDirectory, 'SESSION_INITIAL'), session, { mode: 0o600 });
await writeFile(join(outputDirectory, 'MONITOR_CONFIG'), JSON.stringify(config), { mode: 0o600 });
console.log('Prepared three private secret files. Their contents were not printed.');
