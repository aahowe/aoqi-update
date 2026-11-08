import fs from 'node:fs';
import path from 'node:path';
import { createPublicKey, verify } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { indexPath, objectPath, openIndex, objects, checkObject, platforms as patchPlatforms } from './patches.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keys = JSON.parse(fs.readFileSync(path.join(root, 'config/manifest-keys.json'), 'utf8'));
const source = path.join(root, 'update/v1');
const output = path.join(root, 'public');
const manifests = [];
for (const product of fs.readdirSync(source, { withFileTypes: true })) {
  if (!product.isDirectory()) continue;
  for (const platform of fs.readdirSync(path.join(source, product.name), { withFileTypes: true })) {
    if (!platform.isDirectory()) continue;
    const relative = `${product.name}/${platform.name}/stable.json`;
    const file = path.join(source, relative);
    if (!fs.existsSync(file)) continue;
    const bytes = fs.readFileSync(file);
    if (bytes.length > 65536) throw new Error(`Manifest too large: ${relative}`);
    const envelope = JSON.parse(bytes);
    if (envelope.format !== 1 || envelope.alg !== 'ES256' || !keys[envelope.kid])
      throw new Error(`Untrusted envelope: ${relative}`);
    const payload = Buffer.from(envelope.payload, 'base64');
    const key = createPublicKey({ key: Buffer.from(keys[envelope.kid], 'base64'), format: 'der', type: 'spki' });
    if (!verify('sha256', payload, key, Buffer.from(envelope.sig, 'base64')))
      throw new Error(`Signature rejected: ${relative}`);
    const manifest = JSON.parse(payload);
    if (manifest.product !== product.name || manifest.platform !== platform.name || manifest.channel !== 'stable')
      throw new Error(`Wrong manifest target: ${relative}`);
    manifests.push({ relative, bytes, version: manifest.latest.version, serial: manifest.serial });
  }
}
if (!manifests.length) throw new Error('No verified stable manifests');
// Signed SWF patch sets: published only with every object they name, each matching its digest.
const patchFiles = [];
for (const platform of patchPlatforms) {
  const file = path.join(root, indexPath(platform));
  if (!fs.existsSync(file)) continue;
  const bytes = fs.readFileSync(file);
  const index = openIndex(bytes, platform);
  for (const object of objects(index)) {
    const body = fs.readFileSync(path.join(root, objectPath(object.sha)));
    checkObject(body, object);
    patchFiles.push({ relative: objectPath(object.sha), bytes: body });
  }
  patchFiles.push({ relative: indexPath(platform), bytes, serial: index.serial });
}
// Validate everything before replacing the generated deployment directory.
fs.rmSync(output, { recursive: true, force: true });
for (const { relative, bytes, version, serial } of manifests) {
  const target = path.join(output, 'update/v1', relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  console.log(`${relative}: ${version}, serial ${serial}`);
}
for (const { relative, bytes, serial } of patchFiles) {
  const target = path.join(output, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  if (serial) console.log(`${relative}: patch serial ${serial}`);
}
fs.writeFileSync(path.join(output, '_headers'), `/update/v1/*\n  Cache-Control: public, max-age=0, s-maxage=60, must-revalidate\n  Content-Type: application/json; charset=utf-8\n  Access-Control-Allow-Origin: *\n  X-Content-Type-Options: nosniff\n  X-Robots-Tag: noindex\n/patches/v1/*\n  Cache-Control: public, max-age=0, s-maxage=60, must-revalidate\n  Content-Type: application/json; charset=utf-8\n  Access-Control-Allow-Origin: *\n  X-Content-Type-Options: nosniff\n  X-Robots-Tag: noindex\n/patches/objects/*\n  Cache-Control: public, max-age=31536000, immutable\n  Content-Type: application/x-shockwave-flash\n  X-Content-Type-Options: nosniff\n  X-Robots-Tag: noindex\n`);
fs.writeFileSync(path.join(output, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="robots" content="noindex"><title>Air 奥奇传说更新节点</title><p>Air 奥奇传说更新节点</p></html>\n');
fs.writeFileSync(path.join(output, '404.html'), '<!doctype html><title>Not found</title>Not found\n');
console.log('Prepared public signed manifests; test channels, history and credentials are excluded.');
