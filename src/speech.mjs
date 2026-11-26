import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,renameSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {speechSegments} from './cues.mjs';
import {ROOT,digest,exists,ff,json,safeId} from './common.mjs';

export function phrases(text) {
  return [...new Intl.Segmenter('en',{granularity:'sentence'}).segment(text)].map(s=>s.segment.trim()).filter(Boolean);
}
export function pcm(file) {
  const data=readFileSync(file);
  if(data.toString('ascii',0,4)!=='RIFF' || data.toString('ascii',8,12)!=='WAVE') throw Error('Invalid PCM WAV: '+file);
  let rate,body,channels,bits,codec;
  for(let i=12;i+8<=data.length;) {
    const key=data.toString('ascii',i,i+4), len=data.readUInt32LE(i+4);
    if(key==='fmt ') {codec=data.readUInt16LE(i+8);channels=data.readUInt16LE(i+10);rate=data.readUInt32LE(i+12);bits=data.readUInt16LE(i+22);}
    if(key==='data') body=data.subarray(i+8,i+8+len);
    i+=8+len+(len%2);
  }
  if(codec!==1 || bits!==16 || channels!==1 || !body || !rate || !body.length) throw Error('Expected PCM16 mono WAV: '+file);
  return {bytes:body,rate,duration:body.length/2/rate};
}
export function wav(bytes,rate=24000) {
  const h=Buffer.alloc(44); h.write('RIFF');h.writeUInt32LE(bytes.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);
  h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*2,28);h.writeUInt16LE(2,32);
  h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(bytes.length,40);return Buffer.concat([h,bytes]);
}
export function validateTimings(timing, duration, name) {
  function valid(row) {
    return row && Number.isFinite(row.start) && Number.isFinite(row.end) &&
      row.start >= 0 && row.end > row.start && row.end <= duration+.001;
  }
  if (!timing || !Array.isArray(timing.spans) || !timing.spans.length)
    throw Error('Empty recording timings: '+name);
  for (const key of ['spans','words']) {
    if (key === 'words' && timing.words === undefined) continue;
    if (!Array.isArray(timing[key]) || !timing[key].length) throw Error('Empty recording '+key+': '+name);
    let end = 0;
    for (const row of timing[key]) {
      if (!valid(row) || row.start < end || typeof row.text !== 'string' || !row.text.trim())
        throw Error('Invalid recording timings in '+key+': '+name);
      end = row.end;
    }
  }
  if (timing.marks !== undefined) {
    if (!Array.isArray(timing.marks)) throw Error('Invalid recording marks: '+name);
    const seen = new Set();
    for (const row of timing.marks) {
      if (!valid(row) || !safeId(row.id) || seen.has(row.id)) throw Error('Invalid or duplicate recording mark: '+name);
      seen.add(row.id);
    }
  }
}

class Worker {
  constructor(command) {
    this.child=spawn(command[0],command.slice(1),{stdio:['pipe','pipe','inherit']});
    const reader=createInterface({input:this.child.stdout});
    this.lines=reader[Symbol.asyncIterator]();
    this.exitError=new Promise((_,reject)=>this.child.once('error',reject));
    this.exitError.catch(()=>{});
  }
  async render(request) {
    this.child.stdin.write(JSON.stringify(request)+'\n');
    const line=await Promise.race([this.lines.next(),this.exitError]);
    if(line.done) throw Error('Speech worker exited before returning a response');
    const result=JSON.parse(line.value);
    if(!result.ok) throw Error('Speech worker: '+result.error);
  }
  close(){this.child.stdin.end();}
}
export function voiceSession({cache,recordings,brand,workerConfig}) {
  mkdirSync(cache,{recursive:true});
  let worker;
  const config=workerConfig ? json(workerConfig) : null;
  if(config && (!Array.isArray(config.command)||!config.command.length||!config.version)) throw Error('Voice config needs command array and version');
  const fingerprint=config ? digest(config.command,config.version,config.identity||null) : digest(readFileSync(join(ROOT,'tools/kokoro_voice.py')),'kokoro-v1-int8');
  async function get(text,spec) {
    const key=digest(fingerprint,text,spec), file=join(cache,key+'.wav');
    if(!exists(file)){
      if(!worker){
        const cmd=config?.command || [join(ROOT,process.platform==='win32'?'.voice/Scripts/python.exe':'.voice/bin/python'),join(ROOT,'tools/kokoro_voice.py')];
        if(!config && !exists(cmd[0])) throw Error('Run python3 tools/setup_voice.py or supply --recordings or --voice-worker.');
        worker=new Worker(cmd);
      }
      const tmp=join(cache,randomUUID()+'.wav');
      try {
        await worker.render({text,output:tmp,voice:spec.name,speed:spec.speed,lang:spec.lang});
        if(pcm(tmp).rate!==24000) throw Error('Speech workers must emit 24 kHz PCM16 mono');
        renameSync(tmp,file);
      }finally{rmSync(tmp,{force:true});}
    }
    return pcm(file);
  }
  async function cue(episode,shot) {
    if(recordings) {
      const base=resolve(recordings,episode.id), input=join(base,shot.id+'.wav');
      if(!exists(input)) throw Error('Missing recorded cue: '+input);
      const file=join(cache,digest(readFileSync(input),'pcm-24k-mono')+'.wav');
      if(!exists(file)){
        const tmp=join(cache,randomUUID()+'.wav');
        try{ff(['-i',input,'-ac','1','-ar','24000','-c:a','pcm_s16le',tmp]);renameSync(tmp,file);}finally{rmSync(tmp,{force:true});}
      }
      const audio=pcm(file), timingFile=join(base,shot.id+'.json');
      if (shot.actions?.length && !exists(timingFile)) throw Error(shot.id + ': supply recorded phrase/word timings or named marks beside the WAV');
      const timing = exists(timingFile) ? json(timingFile) : [{start:0,end:audio.duration,text:shot.voice}];
      const measured = Array.isArray(timing) ? {spans:timing} : timing;
      validateTimings(measured, audio.duration, timingFile);
      return {bytes:audio.bytes, ...measured};
    }
    const spec = {...brand.voice,...shot.speaker};
    const captions = phrases(shot.voice), spoken = phrases(shot.spoken || shot.voice);
    if (spoken.length !== captions.length) throw Error('Pronunciation override needs the same number of sentences: '+shot.id);
    const groups = speechSegments(shot,captions);
    let samples=0;
    const spans=[], words=[], buffers=[];
    for (const [i,parts] of groups.entries()) {
      if (i) { const pause=Buffer.alloc(2*3600); buffers.push(pause); samples+=pause.length/2; }
      const start = samples/24000;
      for (const part of parts) {
        if (parts.length > 1 && spoken[i] !== captions[i])
          throw Error(shot.id + ': use a timed recording for an inside-sentence cue with a pronunciation override');
        const audio = await get(parts.length === 1 ? spoken[i] : part,spec);
        const partStart = samples/24000;
        buffers.push(audio.bytes);
        samples += audio.bytes.length/2;
        words.push({start:partStart,end:samples/24000,text:part});
      }
      spans.push({start,end:samples/24000,text:captions[i]});
    }
    return {bytes:Buffer.concat(buffers),spans,...(shot.actions?.length ? {words} : {})};
  }
  return {cue,close:()=>worker?.close()};
}
