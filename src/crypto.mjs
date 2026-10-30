import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

function keyBytes(secret) {
  const key = Buffer.from(secret || '', 'base64');
  if (key.length !== 32) throw new Error('invalid_encryption_key');
  return key;
}

export function encrypt(data, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(secret), iv);
  cipher.setAAD(Buffer.from('course-monitor-state-v1'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') });
}

export function decrypt(text, secret) {
  const envelope = JSON.parse(text);
  if (envelope.version !== 1) throw new Error('unsupported_state_version');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(secret), Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from('course-monitor-state-v1'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'));
}
