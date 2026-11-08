// Copies newer signed manifests from the primary OSS bucket into this repository
// (update/v1/... and update/history/...). Manifests are published from the server's admin
// panel to OSS; this keeps jsDelivr, GitHub Pages, raw and Vercel in step without a key here.
// Prints the changed targets; exits 0 when nothing changed.
import fs from 'node:fs';
import path from 'node:path';
import { createPublicKey, verify } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { indexPath, objectPath, openIndex, objects, checkObject, platforms as patchPlatforms } from './patches.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keys = JSON.parse(fs.readFileSync(path.join(root, 'config/manifest-keys.json'), 'utf8'));
const base = process.env.OSS_BASE || 'https://air-aoqi-version.oss-cn-guangzhou.aliyuncs.com/update/v1/';
const product = 'aoqi';
const platforms = ['android', 'macos', 'windows', 'ios'];
const channels = ['stable', 'beta'];

function open(bytes, platform, channel) {
  if (bytes.length > 65536) throw new Error('too large');
  const envelope = JSON.parse(bytes);
  if (envelope.format !== 1 || envelope.alg !== 'ES256' || !keys[envelope.kid]) throw new Error('untrusted envelope');
  const payload = Buffer.from(envelope.payload, 'base64');
  const key = createPublicKey({ key: Buffer.from(keys[envelope.kid], 'base64'), format: 'der', type: 'spki' });
  if (!verify('sha256', payload, key, Buffer.from(envelope.sig, 'base64'))) throw new Error('signature rejected');
  const manifest = JSON.parse(payload);
  if (manifest.product !== product || manifest.platform !== platform || manifest.channel !== channel)
    throw new Error('wrong target');
  return manifest;
}

let failed = false;
const changed = [];
for (const platform of platforms) {
  for (const channel of channels) {
    const relative = `${product}/${platform}/${channel}.json`;
    let response;
    try {
      response = await fetch(`${base}${relative}?sync=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' }, redirect: 'error' });
    } catch (error) {
      console.error(`${relative}: ${error.message}`);
      failed = true;
      continue;
    }
    if (response.status === 404 || response.status === 403) continue; // not published
    if (!response.ok) {
      console.error(`${relative}: HTTP ${response.status}`);
      failed = true;
      continue;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    let remote;
    try {
      remote = open(bytes, platform, channel);
    } catch (error) {
      console.error(`${relative}: ${error.message}`);
      failed = true;
      continue;
    }
    const file = path.join(root, 'update/v1', relative);
    const local = fs.existsSync(file) ? open(fs.readFileSync(file), platform, channel) : null;
    if (local && remote.serial <= local.serial) continue;
    const history = path.join(root, 'update/history', product, platform, channel, `${String(remote.serial).padStart(6, '0')}.json`);
    for (const target of [file, history]) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    }
    changed.push(`${relative} serial ${remote.serial} (${remote.latest.version})`);
  }
}
// SWF patch sets: objects first, the index last, so a mirror never names an object it does not have.
const ossRoot = base.replace(/update\/v1\/$/, '');
for (const platform of patchPlatforms) {
  const relative = indexPath(platform);
  try {
    const response = await fetch(`${ossRoot}${relative}?sync=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' }, redirect: 'error' });
    if (response.status === 404 || response.status === 403) continue; // not published
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const remote = openIndex(bytes, platform);
    const file = path.join(root, relative);
    const local = fs.existsSync(file) ? openIndex(fs.readFileSync(file), platform) : null;
    if (local && remote.serial <= local.serial) continue;
    for (const object of objects(remote)) {
      const target = path.join(root, objectPath(object.sha));
      if (fs.existsSync(target)) { checkObject(fs.readFileSync(target), object); continue; }
      const reply = await fetch(`${ossRoot}${objectPath(object.sha)}`, { redirect: 'error' });
      if (!reply.ok) throw new Error(`object ${object.sha}: HTTP ${reply.status}`);
      const body = Buffer.from(await reply.arrayBuffer());
      checkObject(body, object);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    changed.push(`${relative} serial ${remote.serial}`);
  } catch (error) {
    console.error(`${relative}: ${error.message}`);
    failed = true;
  }
}
// Objects no current index names are dropped from the tree (Git history keeps them).
const named = new Set();
for (const platform of patchPlatforms) {
  const file = path.join(root, indexPath(platform));
  if (fs.existsSync(file)) for (const { sha } of objects(openIndex(fs.readFileSync(file), platform))) named.add(sha);
}
const objectDir = path.join(root, 'patches/objects');
if (fs.existsSync(objectDir)) for (const name of fs.readdirSync(objectDir)) {
  if (!named.has(name.replace(/\.swf$/, ''))) { fs.rmSync(path.join(objectDir, name)); changed.push(`removed ${name}`); }
}
for (const line of changed) console.log(line);
if (failed) process.exitCode = 1;
