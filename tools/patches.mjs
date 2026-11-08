// Signed SWF patch sets (air-aoqi-release/docs/swf-patch-protocol.md): only the checks a mirror needs —
// a trusted signature, the right target, and objects that match their digests. No signing key is here.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// PATCH_KEYS_FILE: tests only (a test key's public half); never set in the workflow.
const keys = JSON.parse(fs.readFileSync(process.env.PATCH_KEYS_FILE || path.join(root, 'config/patch-keys.json'), 'utf8'));
export const platforms = ['android', 'macos', 'windows', 'ios'];
export const MAX_ENVELOPE = 256 * 1024;
export const MAX_OBJECT = 8 * 1024 * 1024;

export const indexPath = (platform) => `patches/v1/aoqi/${platform}/stable.json`;
export const objectPath = (sha) => `patches/objects/${sha}.swf`;
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function openIndex(bytes, platform) {
  if (bytes.length > MAX_ENVELOPE) throw new Error('too large');
  const envelope = JSON.parse(bytes);
  if (envelope.format !== 1 || envelope.alg !== 'ES256' || !keys[envelope.kid]) throw new Error('untrusted envelope');
  const payload = Buffer.from(envelope.payload, 'base64');
  const key = createPublicKey({ key: Buffer.from(keys[envelope.kid], 'base64'), format: 'der', type: 'spki' });
  if (!verify('sha256', payload, key, Buffer.from(envelope.sig, 'base64'))) throw new Error('signature rejected');
  const index = JSON.parse(payload);
  if (index.purpose !== 'aoqi-swf-patches' || index.product !== 'aoqi' || index.platform !== platform || index.channel !== 'stable')
    throw new Error('wrong target');
  if (!Number.isInteger(index.serial) || !Array.isArray(index.sets)) throw new Error('payload');
  return index;
}

/** Every object an index names, once. */
export function objects(index) {
  const seen = new Map();
  for (const set of index.sets) for (const route of set.routes || []) {
    const { sha256: sha, size } = route.object || {};
    if (!/^[0-9a-f]{64}$/.test(sha) || !Number.isInteger(size) || size <= 0 || size > MAX_OBJECT) throw new Error('object');
    seen.set(sha, size);
  }
  return [...seen].map(([sha, size]) => ({ sha, size }));
}

export function checkObject(bytes, { sha, size }) {
  if (bytes.length !== size || sha256(bytes) !== sha) throw new Error(`object ${sha} does not match its digest`);
}
