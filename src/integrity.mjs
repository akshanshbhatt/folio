import {createHash,randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import {join,dirname,relative,sep} from 'node:path';
import {openSync,readSync,closeSync,readdirSync,statSync,writeFileSync,mkdirSync,linkSync,unlinkSync,renameSync,rmSync,readFileSync} from 'node:fs';
import {setTimeout as wait} from 'node:timers/promises';
import {exists,inside,json,probe,ff,write} from './common.mjs';
import {subtitleText} from './subtitles.mjs';

function stamp(file) {
  const hash=createHash('sha256'), block=Buffer.allocUnsafe(1024*1024), fd=openSync(file,'r');
  let bytes=0;
  try {
    for(let n;(n=readSync(fd,block,0,block.length,null));){hash.update(block.subarray(0,n));bytes+=n;}
  }finally{closeSync(fd);}
  return {bytes,sha256:hash.digest('hex')};
}
function paths(root,relative=''){
  return readdirSync(join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>{
    if(['.DS_Store','Thumbs.db','desktop.ini'].includes(entry.name))return [];
    const name=relative?relative+'/'+entry.name:entry.name;
    if(entry.isDirectory())return paths(root,name);
    if(!entry.isFile())throw Error('Unexpected non-file inside bundle: '+name);
    return name==='receipt.json'?[]:[name];
  });
}
function required(bundle,q,files) {
  const required=['film.mp4','poster.png','narration.wav','script.md','direction.md','sources.md','timeline.json','qc.json','project/brand.json'];
  const episodes=files.filter(f=>/^project\/episodes\/[^/]+\.json$/.test(f));
  if(episodes.length!==1)throw Error('Bundle needs exactly one source episode');
  const e=json(join(bundle,episodes[0])),b=json(join(bundle,'project/brand.json')),t=json(join(bundle,'timeline.json'));
  const master=q.profile==='master',short=e.format==='short';
  if(!['master','review'].includes(q.profile)||!['short','long'].includes(e.format)||q.fps!==(master?60:30)||q.width!==(short?(master?1440:720):(master?2560:1280))||q.height!==(short?(master?2560:1280):(master?1440:720)))throw Error('Bundle profile geometry mismatch');
  if(t.revision!==q.revision||t.fps!==q.fps||t.shots.length!==e.shots.length||!Array.isArray(t.captions))throw Error('Bundle timeline and technical receipt disagree');
  let next=0;
  for(const [i,s] of t.shots.entries()){
    if(s.id!==e.shots[i].id||s.startFrame!==next||!Number.isSafeInteger(s.frames)||s.frames<1)throw Error('Invalid shot interval in bundle: '+s.id);
    next+=s.frames;
  }
  if(next!==q.frames)throw Error('Bundle timeline and frame count disagree');
  if(!['none','burn','both','sidecar'].includes(q.subtitleMode))throw Error('Unknown subtitle mode in bundle');
  let end=0;
  for(const c of t.captions){
    if(typeof c.text!=='string'||!c.text.trim()||!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<end-.00001||c.end<=c.start||c.end>next/q.fps+.001)throw Error('Invalid caption interval in bundle');
    end=c.end;
  }
  const side=['sidecar','both'].includes(q.subtitleMode);
  for(const f of ['captions.srt','captions.vtt']){
    if(side)required.push(f);
    else if(files.includes(f))throw Error('Unexpected sidecar for '+q.subtitleMode+': '+f);
  }
  if(q.narration==='recorded'||q.narration==='custom worker') {
    for(const s of e.shots){const base='project/takes/'+e.id+'/'+s.id;required.push(base+'.wav',base+'.json');}
  }
  const project=join(bundle,'project');
  for(const font of b.fonts||[])for(const f of [font.file,font.license].filter(Boolean))required.push('project/'+relative(project,inside(project,f)).split(sep).join('/'));
  for(const f of Object.values(b.plugins||{}).flatMap(r=>Object.values(r)))required.push('project/'+f);
  for(const s of e.shots){
    if(['media','web'].includes(s.component))required.push('project/'+s.params.file);
    else if(!b.modules.some(dir=>files.includes('project/'+dir+'/'+s.component+'.mjs')))throw Error('Missing source component: '+s.component);
    if(s.audioAfter)required.push('project/'+s.audioAfter.file);
    for(const asset of s.params?.dependencies||[])required.push('project/'+asset);
  }
  for(const f of required)if(!files.includes(f)||statSync(inside(bundle,f)).size===0)throw Error('Missing or empty bundle file: '+f);
  if(side)for(const ext of ['srt','vtt']){
    if(readFileSync(join(bundle,'captions.'+ext),'utf8')!==subtitleText(t.captions,ext==='vtt'))throw Error('Caption file differs from measured timeline: '+ext);
  }
}
export function sealBundle(bundle,projectHashes={}){
  const q=json(join(bundle,'qc.json')),files=paths(bundle);required(bundle,q,files);
  const hashes=Object.fromEntries(files.map(f=>[f,stamp(join(bundle,f))]));
  for(const [f,expected] of Object.entries(projectHashes))if(hashes[f]?.sha256!==expected)throw Error('Packaged source differs from render input: '+f);
  write(join(bundle,'receipt.json'),{version:1,revision:q.revision,algorithm:'sha256',files:hashes});
}
export function inspectBundle(bundle,expected={}){
  const receipt=json(join(bundle,'receipt.json')), q=json(join(bundle,'qc.json')),files=paths(bundle);
  if(receipt.version!==1||receipt.algorithm!=='sha256'||receipt.revision!==q.revision||!receipt.files)throw Error('Invalid integrity receipt: '+bundle);
  for(const [k,v] of Object.entries(expected))if(q[k]!==v)throw Error('Wrong bundle '+k);
  required(bundle,q,files);
  if(files.length!==Object.keys(receipt.files).length)throw Error('Bundle file inventory changed');
  for(const f of files){
    const r=receipt.files[f];
    if(!r||statSync(join(bundle,f)).size!==r.bytes||stamp(join(bundle,f)).sha256!==r.sha256)throw Error('Bundle failed SHA-256 check: '+f);
  }
  return q;
}
const revPattern=/^[0-9a-f]{20}$/;
export function findBundle(folder,input,expected) {
  const index=join(folder,'.by-input',input+'.json'), names=[];
  try{const r=json(index).revision;if(revPattern.test(r))names.push(r);}catch{}
  if(!names.includes(input))names.push(input);
  for(const revision of names){
    const file=join(folder,revision);
    if(!exists(join(file,'receipt.json')))continue;
    try{inspectBundle(file,{revision,inputDigest:input,...expected});return {revision,file};}catch{}
  }
  return null;
}
function alive(pid){
  try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}
}
// Use an atomic hard link to a fully written token. A second lock elects one
// reaper if an owner dies. A different host's active lock is always respected.
export async function withLock(lock,task) {
  mkdirSync(dirname(lock),{recursive:true});
  const owner={host:hostname(),pid:process.pid,id:randomUUID()}, token=lock+'.claim-'+owner.id;
  writeFileSync(token,JSON.stringify(owner));let held=false;
  const deadline=Date.now()+30*60*1000;
  try{
    while(!held) {
      try{linkSync(token,lock);held=true;continue;}
      catch(e){if(e.code!=='EEXIST')throw e;}
      let previous;
      try{previous=json(lock);}catch(e){if(e.code==='ENOENT')continue;throw e;}
      if(previous.host===owner.host&&Number.isSafeInteger(previous.pid)&&!alive(previous.pid)){
        await withLock(lock+'.reap-'+previous.id,()=>{
          try{if(json(lock).id===previous.id)unlinkSync(lock);}catch(e){if(e.code!=='ENOENT')throw e;}
        });
        continue;
      }
      if(Date.now()>deadline)throw Error('Timed out waiting for another writer: '+lock);
      await wait(150);
    }
    return await task();
  }finally{
    if(held)unlinkSync(lock);
    rmSync(token,{force:true});
  }
}
export async function publishBundle({folder,input,tmp,expected,checkInputs=()=>{},projectHashes={}}) {
  return withLock(join(folder,'.publish.lock'),()=>{
    checkInputs();
    let result=findBundle(folder,input,expected);
    if(!result){
      if(!tmp)return null;
      const revision=exists(join(folder,input))?randomUUID().replaceAll('-','').slice(0,20):input;
      const file=join(folder,revision);
      for(const name of ['timeline.json','qc.json']){
        const f=join(tmp,name);write(f,{...json(f),revision});
      }
      sealBundle(tmp,projectHashes);checkInputs();renameSync(tmp,file);result={revision,file};
    }
    const pointer={revision:result.revision,inputDigest:input,profile:expected.profile,subtitles:expected.subtitleMode};
    write(join(folder,'.by-input',input+'.json'),pointer);write(join(folder,'latest.json'),pointer);
    return result.file;
  });
}
// Cached pictures are immutable once signed. Old caches get a one-time decode
// before adoption. A damaged picture is retained and replaced by atomic rename.
export async function ensureShot(options,encode) {
  const target=options.output,receipt=target+'.sha256.json';
  function intact(){
    try{const r=json(receipt);return statSync(target).size===r.bytes&&stamp(target).sha256===r.sha256;}catch{return false;}
  }
  if(intact())return;
  await withLock(target+'.lock',async ()=>{
    if(intact())return;
    if(exists(target)&&!exists(receipt)){
      try{
        const v=probe(target).streams.find(s=>s.codec_type==='video');
        if(v?.codec_name!=='h264'||v.width!==options.width||v.height!==options.height||Number(v.nb_frames)!==options.frames||Math.abs(Number(v.duration)-options.frames/options.fps)>.025)throw Error('Legacy shot format mismatch');
        ff(['-xerror','-i',target,'-map','0:v:0','-f','null','-']);
        write(receipt,stamp(target));return;
      }catch{}
    }
    const fresh=target+'.candidate-'+randomUUID()+'.mp4';
    try {
      await encode({...options,output:fresh});
      if(exists(target))linkSync(target,target+'.damaged-'+randomUUID());
      renameSync(fresh,target);write(receipt,stamp(target));
    }finally{rmSync(fresh,{force:true});}
  });
}
