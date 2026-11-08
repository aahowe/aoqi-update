// Run the actual sync/build scripts in an isolated mirror tree. No live objects or signing secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('sync and site generation publish a signed index only with verified objects',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aoqi-patch-mirror-'));
 const {privateKey,publicKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const keys={fixture:publicKey.export({type:'spki',format:'der'}).toString('base64')};
 const signed=(value,kid='fixture')=>{
  const body=Buffer.from(JSON.stringify(value));
  return JSON.stringify({format:1,kid,alg:'ES256',payload:body.toString('base64'),sig:crypto.sign('sha256',body,privateKey).toString('base64')});
 };
 const patchPath='patches/v1/aoqi/macos/stable.json';
 let object=Buffer.from('fixture shadow bytes'),serial=1,broken=false,kid='fixture',gets=[];
 const digest=()=>crypto.createHash('sha256').update(object).digest('hex');
 const index=()=>signed({schema:1,purpose:'aoqi-swf-patches',product:'aoqi',platform:'macos',channel:'stable',serial,
  sets:[{patchSerial:serial,routes:[{name:'loader',stage:'loader',object:{sha256:digest(),size:object.length}}]}]},kid);
 const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname.slice(1);gets.push(name);
  if(name===patchPath){res.end(index());return;}
  if(name===`patches/objects/${digest()}.swf`){res.end(broken?Buffer.from('tampered'):object);return;}
  res.statusCode=404;res.end();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const execute=(script)=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(dir,'tools',script)],{cwd:dir,env:{...process.env,OSS_BASE:`http://127.0.0.1:${server.address().port}/update/v1/`}});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  child.on('error',reject);child.on('exit',code=>resolve({code,output}));
 });
 const write=(relative,body)=>{const file=path.join(dir,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);};
 try{
  for(const name of ['patches.mjs','sync-from-oss.mjs','prepare-site.mjs'])write('tools/'+name,fs.readFileSync(path.join(root,'tools',name)));
  write('config/patch-keys.json',JSON.stringify(keys));write('config/manifest-keys.json',JSON.stringify(keys));
  write('update/v1/aoqi/macos/stable.json',signed({product:'aoqi',platform:'macos',channel:'stable',serial:1,latest:{version:'1.0.0'}}));
  let result=await execute('sync-from-oss.mjs');assert.equal(result.code,0,result.output);
  const original=fs.readFileSync(path.join(dir,patchPath),'utf8');
  assert.equal(JSON.parse(original).payload,JSON.parse(index()).payload);assert.equal(gets.filter(n=>n.startsWith('patches/objects/')).length,1);
  gets=[];result=await execute('sync-from-oss.mjs');assert.equal(result.code,0,result.output);
  assert(!gets.some(n=>n.startsWith('patches/objects/')),'same index must not refetch objects');
  result=await execute('prepare-site.mjs');assert.equal(result.code,0,result.output);
  assert.equal(fs.readFileSync(path.join(dir,'public',patchPath),'utf8'),original);
  assert.match(fs.readFileSync(path.join(dir,'public/_headers'),'utf8'),/\/patches\/objects\/\*[\s\S]*immutable/);
  serial++;object=Buffer.from('changed fixture shadow');broken=true;
  result=await execute('sync-from-oss.mjs');assert.notEqual(result.code,0,result.output);
  assert.equal(fs.readFileSync(path.join(dir,patchPath),'utf8'),original,'bad object must not replace index');
  broken=false;kid='untrusted';result=await execute('sync-from-oss.mjs');assert.notEqual(result.code,0,result.output);
  assert.equal(fs.readFileSync(path.join(dir,patchPath),'utf8'),original,'unknown signer must not replace index');
  // A corrupted local object cannot replace a previously generated, valid site either.
  const current=JSON.parse(Buffer.from(JSON.parse(original).payload,'base64'));
  write('patches/objects/'+current.sets[0].routes[0].object.sha256+'.swf','broken');
  result=await execute('prepare-site.mjs');assert.notEqual(result.code,0,result.output);
  assert.equal(fs.readFileSync(path.join(dir,'public',patchPath),'utf8'),original);
 }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});
