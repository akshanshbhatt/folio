import {createHash} from 'node:crypto';
import {closeSync,openSync,readFileSync,readSync,statSync} from 'node:fs';
import {relative,sep} from 'node:path';
import {inside} from './common.mjs';

const rawDigest=bytes=>createHash('sha256').update(bytes).digest('hex');
const signature=file=>{
  const s=statSync(file,{bigint:true});
  return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
};
function readChunks(file,onChunk){
  const fd=openSync(file,'r'),block=Buffer.allocUnsafe(1024*1024);
  try{for(let n;(n=readSync(fd,block,0,block.length,null));)onChunk(block.subarray(0,n));}
  finally{closeSync(fd);}
}
// Preserve the existing length-prefixed picture keys while hashing even a
// multi-gigabyte video without allocating a buffer the size of the video.
export function inputFiles(channel){
  const known=new Map(),groups=new Map(),texts=new Map(),definitions=new Map();
  function name(file){const rel=relative(channel,file);inside(channel,rel);return rel.split(sep).join('/');}
  function remember(file,before,hash){
    if(signature(file)!==before||known.has(file)&&known.get(file).hash!==hash)throw Error('Source changed while reading: '+name(file));
    known.set(file,{signature:before,hash,name:name(file)});
  }
  function bytes(file){
    const before=signature(file),data=readFileSync(file);
    remember(file,before,rawDigest(data));
    return data;
  }
  function text(file){
    if(!texts.has(file))texts.set(file,bytes(file).toString('utf8'));
    return texts.get(file);
  }
  function digestFiles(files){
    const key=JSON.stringify(files);
    if(!groups.has(key)){
      const hash=createHash('sha256');
      for(const file of files){
        const before=signature(file),raw=createHash('sha256');
        hash.update(String(statSync(file).size)+':');
        readChunks(file,bytes=>{hash.update(bytes);raw.update(bytes);});
        remember(file,before,raw.digest('hex'));
      }
      groups.set(key,hash.digest('hex'));
    }
    return groups.get(key);
  }
  function watchJSON(file,expected){
    const serial=JSON.stringify(expected),before=signature(file);
    if(JSON.stringify(JSON.parse(readFileSync(file,'utf8')))!==serial||signature(file)!==before)throw Error('Source changed before render: '+name(file));
    definitions.set(file,{signature:before,serial});
  }
  function check(){
    for(const [file,ref] of definitions){
      const now=signature(file);
      if(now!==ref.signature){
        if(JSON.stringify(JSON.parse(readFileSync(file,'utf8')))!==ref.serial||signature(file)!==now)throw Error('Source changed during render: '+name(file));
        ref.signature=now;
      }
    }
    for(const [path,old] of known){
      const now=signature(path);
      if(now===old.signature)continue;
      const raw=createHash('sha256');readChunks(path,bytes=>raw.update(bytes));
      if(raw.digest('hex')!==old.hash||signature(path)!==now)throw Error('Source changed during render: '+old.name);
      old.signature=now;
    }
  }
  function projectHashes(prefix='project/'){
    return Object.fromEntries([...known.values()].map(ref=>[prefix+ref.name,ref.hash]).sort(([a],[b])=>a.localeCompare(b)));
  }
  return {bytes,text,digestFiles,check,watchJSON,projectHashes};
}
