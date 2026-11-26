// Optional regeneration. The checked-in performance is sufficient for an ordinary run.
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {parseArgs} from 'node:util';
import {voiceSession,wav} from '../../src/speech.mjs';
import {ff,json,write} from '../../src/common.mjs';
import {spawnSync} from 'node:child_process';
const {values}=parseArgs({options:{script:{type:'string'},out:{type:'string'},'voice-worker':{type:'string'}}});
if(!values.script||!values.out||existsSync(values.out))throw Error('Supply --script script.json --out NEW_DIR [--voice-worker config.json]');
const script=json(values.script),scratch=mkdtempSync(join(tmpdir(),'folio-history-voice-'));
const spec={name:'af_bella',speed:1,lang:'en-us'};
const session=voiceSession({cache:join(scratch,'cache'),brand:{voice:spec},workerConfig:values['voice-worker']});
try{
  const buffers=[],beats=[],rate=24000;
  let samples=0;
  function silence(n){buffers.push(Buffer.alloc(n*2));samples+=n;}
  for(const [i,beat] of script.beats.entries()){
    if(i)silence(9600);
    const startSample=samples;silence(4800);
    const offset=samples;
    const take=await session.cue({id:'paper-sneeze'},beat);
    buffers.push(take.bytes);samples+=take.bytes.length/2;
    silence(7200);
    const spans=take.spans.map(s=>({start:(offset+Math.round(rate*s.start))/rate,end:(offset+Math.round(rate*s.end))/rate,text:s.text}));
    beats.push({id:beat.id,startSample,endSample:samples,spans});
  }
  const raw=join(scratch,'voice.wav');writeFileSync(raw,wav(Buffer.concat(buffers)));
  const probe=spawnSync('ffmpeg',['-hide_banner','-nostats','-i',raw,'-af','loudnorm=I=-17:TP=-2.3:LRA=8:print_format=json','-f','null','-'],{encoding:'utf8'});
  if(probe.status!==0)throw Error(probe.stderr);
  const level=JSON.parse(probe.stderr.match(/\{\s*"input_i"[^}]+\}/)[0]);
  const filter='loudnorm=I=-17:TP=-2.3:LRA=8:linear=true:measured_I='+level.input_i+
    ':measured_TP='+level.input_tp+':measured_LRA='+level.input_lra+':measured_thresh='+level.input_thresh+
    ':offset='+level.target_offset+',aresample=24000,apad,atrim=end_sample='+samples;
  mkdirSync(values.out);
  ff(['-i',raw,'-af',filter,'-ar','24000','-sample_fmt','s16','-c:a','flac','-compression_level','8',join(values.out,'voice.flac')]);
  write(join(values.out,'timing.json'),{generation:'Kokoro v1.0 · af_bella · 1.0× · measured foreground reading',rate,samples,mastering:{targetLufs:-17,peakCeilingDbtp:-2.3},beats,referenceSha256:createHash('sha256').update(readFileSync(join(values.out,'voice.flac'))).digest('hex')});
  console.log(resolve(values.out));
}finally{session.close();rmSync(scratch,{recursive:true,force:true});}
