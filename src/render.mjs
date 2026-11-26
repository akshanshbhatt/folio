import {resolveActions,measuredSentences} from './cues.mjs';
import {mkdirSync,readFileSync,writeFileSync,rmSync,cpSync,mkdtempSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {ROOT,digest,treeHash,json,exists,write,run,ff,probe,inside} from './common.mjs';
import {validate} from './model.mjs';
import {voiceSession,wav,pcm,phrases} from './speech.mjs';
import {captions,subtitleText} from './subtitles.mjs';
import {loadComponent,sizes} from './stage.mjs';
import {plugins} from './extensions.mjs';
import {encodeShot} from './video.mjs';
import {ensureShot,publishBundle} from './integrity.mjs';
import {inputFiles} from './input-files.mjs';
import {stageBrand} from './channel-fonts.mjs';

import {spawnSync} from 'node:child_process';
function moduleHash(file,inputs) {
  const seen=new Set();
  function scan(path){
    if(seen.has(path)) return '';
    seen.add(path);
    const contents=inputs.text(path);
    const imports=[...contents.matchAll(/(?:from\s+|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)];
    return digest(contents,...imports.map(m=>scan(resolve(dirname(path),m[1]))));
  }
  return scan(file);
}
function measure(file) {
  const r=spawnSync('ffmpeg',['-nostdin','-hide_banner','-nostats','-i',file,'-vn','-af','loudnorm=I=-17:TP=-2:LRA=8:print_format=json','-f','null','-'],{encoding:'utf8',maxBuffer:2e6});
  if(r.status!==0) throw Error('Audio measurement failed: '+r.stderr.slice(-450));
  const match=r.stderr.match(/\{\s*"input_i"\s*:[^}]+\}/);
  if(!match) throw Error('Missing loudness measurement');
  const data=JSON.parse(match[0]);
  return {integratedLUFS:Number(data.input_i),truePeakDBTP:Number(data.input_tp),loudnessRange:Number(data.input_lra),threshold:Number(data.input_thresh),offset:Number(data.target_offset)};
}
const maxTruePeak=-.8;
const targetIntegrated=-17;
const allowedLoudnessError=2;
class EncodedAudioLevelError extends Error {
  constructor(levels) {
    super('Encoded audio outside target: '+JSON.stringify(levels));
    this.levels=levels;
  }
}
export function verifyMovie(file,expected) {
  const info=probe(file), video=info.streams.find(t=>t.codec_type==='video'),audio=info.streams.find(t=>t.codec_type==='audio');
  if(!video||!audio||info.streams.length!==2)throw Error('Expected one video stream and one audio stream');
  const ratio=value=>{const [n,d]=String(value).split('/').map(Number);return n/d;};
  const seconds=expected.frames/expected.fps, pictureSeconds=Number(video.duration), audioSeconds=Number(audio.duration);
  if(!Number.isSafeInteger(expected.frames)||expected.frames<=0||!Number.isSafeInteger(expected.fps)||expected.fps<=0)throw Error('Invalid expected duration');
  if(video.width!==expected.width||video.height!==expected.height||Number(video.nb_frames)!==expected.frames)throw Error('Picture geometry/frame count mismatch');
  if(video.codec_name!=='h264'||video.pix_fmt!=='yuv420p'||audio.codec_name!=='aac'||Number(audio.sample_rate)!==48000||audio.channels!==1)throw Error('Expected H.264 YUV420P and mono 48 kHz AAC');
  const nominal=ratio(video.r_frame_rate), average=ratio(video.avg_frame_rate);
  if(!Number.isFinite(nominal)||!Number.isFinite(average)||Math.abs(nominal-expected.fps)>.01||Math.abs(average-expected.fps)>.01)throw Error('Wrong encoded frame rate');
  if(!Number.isFinite(pictureSeconds)||!Number.isFinite(audioSeconds)||Math.abs(pictureSeconds-seconds)>.5/expected.fps||Math.abs(audioSeconds-seconds)>1/expected.fps+.025)throw Error('Audio/video duration mismatch');
  for(const stream of [video,audio])if(!Number.isFinite(Number(stream.start_time))||Math.abs(Number(stream.start_time))>1/expected.fps)throw Error('Unexpected stream start time');
  ff(['-xerror','-threads','4','-i',file,'-map','0:v:0','-map','0:a:0','-f','null','-']);
  const m=measure(file);
  if(!Number.isFinite(m.integratedLUFS)||!Number.isFinite(m.truePeakDBTP)||m.truePeakDBTP>maxTruePeak||Math.abs(m.integratedLUFS-targetIntegrated)>allowedLoudnessError)throw new EncodedAudioLevelError(m);
  return {...expected,seconds:Number(video.duration),audioSeconds:Number(audio.duration),codec:video.codec_name,...m,fullDecode:true};
}
function masterMovie({movie,list,narration,levels,title,expected}) {
  const {frames,fps}=expected;
  let attenuation=0,ceiling=-2;
  const corrections=[];
  for(;;) {
    const filter='loudnorm=I=-17:TP='+ceiling+':LRA=8:linear=true:measured_I='+levels.integratedLUFS+
      ':measured_TP='+levels.truePeakDBTP+':measured_LRA='+levels.loudnessRange+
      ':measured_thresh='+levels.threshold+':offset='+levels.offset+
      ',aresample=48000,apad,atrim=end_sample='+Math.round(frames/fps*48000)+',asetpts=N/SR/TB'+
      (attenuation?',volume=-'+attenuation+'dB':'');
    ff(['-f','concat','-safe','0','-i',list,'-i',narration,'-map','0:v','-map','1:a','-c:v','copy','-af',filter,'-ar','48000','-c:a','aac','-b:a','160k','-metadata','title='+title,'-movflags','+faststart',movie]);
    try {
      const qc=verifyMovie(movie,expected);
      if(corrections.length)qc.audioRemaster=corrections;
      return qc;
    }catch(error) {
      if(!(error instanceof EncodedAudioLevelError)||corrections.length>=2)throw error;
      const {truePeakDBTP,integratedLUFS}=error.levels;
      if(!Number.isFinite(truePeakDBTP)||truePeakDBTP<=maxTruePeak||!Number.isFinite(integratedLUFS)||
          Math.abs(integratedLUFS-targetIntegrated)>allowedLoudnessError)throw error;
      // Record the overshoot on the decoded AAC. Re-encode from the original
      // PCM with extra headroom; all attempts stream-copy the same H.264 shots.
      const reduction=truePeakDBTP-maxTruePeak+.6;
      const headroom=Math.max(0,integratedLUFS-(targetIntegrated-allowedLoudnessError+.5));
      const trim=Math.min(reduction,headroom);
      attenuation=Number((attenuation+trim).toFixed(2));
      // With a quiet programme, reduce peak transients instead of moving
      // average loudness past its lower bound. FFmpeg's minimum TP is -9.
      ceiling=Math.max(-9,Number((ceiling-(reduction-trim)).toFixed(2)));
      corrections.push({integratedLUFS,truePeakDBTP,attenuationDb:attenuation,pcmCeilingDBTP:ceiling});
    }
  }
}
export async function render({channel,e,brand,profile='review',subs='sidecar',cache,out,recordings,voiceWorker,quiet=false,trackDefinitions=false}) {
  validate(e,channel);
  if(!['master','review'].includes(profile)||!['none','sidecar','burn','both'].includes(subs)) throw Error('Choose master/review and none/sidecar/burn/both');
  const fps=profile==='master'?60:30, [width,height]=sizes(e.format,profile);
  const burn=['burn','both'].includes(subs), side=['sidecar','both'].includes(subs);
  const runtime=inputFiles(ROOT);
  for(const module of ['motion','stage','video','extensions','webplate'])moduleHash(join(ROOT,'src',module+'.mjs'),runtime);
  if(brand.fonts?.length)moduleHash(join(ROOT,'src/channel-fonts.mjs'),runtime);
  const runtimeSources=runtime.projectHashes('');
  const packages=json(join(ROOT,'package-lock.json')).packages;
  const families=digest(treeHash(join(ROOT,'assets/fonts')),packages['node_modules/@napi-rs/canvas'].version,packages['node_modules/playwright-core'].version);
  const pictureCore=digest(runtimeSources,families,run('ffmpeg',['-version']).split('\n')[0]);
  const folder=join(out,e.id,profile), shotCache=join(cache,'shots');mkdirSync(folder,{recursive:true});mkdirSync(shotCache,{recursive:true});
  const archiveTakes=Boolean(recordings||voiceWorker||e.shots.some(s=>s.actions?.length));
  const session=voiceSession({cache:join(cache,'voice'),brand,recordings,workerConfig:voiceWorker});
  const tmp=mkdtempSync(join(folder,'.build-'));
  try{
    const inputs=inputFiles(channel), moduleKeys=new Map();
    if(trackDefinitions){inputs.watchJSON(join(channel,'episodes',e.id+'.json'),e);inputs.watchJSON(join(channel,'brand.json'),brand);}
    const paintedBrand=stageBrand(channel,brand,inputs);
    const checkInputs=()=>{runtime.check();inputs.check();};
    const pluginFiles=Object.values(brand.plugins||{}).flatMap(reg=>Object.values(reg));
    const extKey=digest(...pluginFiles.map(f=>moduleHash(inside(channel,f),inputs)));
    const soundtrack=[], subsAll=[], timeline=[], pictures=[], keys=[], archivedTiming=[];
    const samplesPerFrame=24000/fps; let total=0;
    for(const [index,original] of e.shots.entries()) {
      const shot={...original};
      delete shot.resolvedActions;
      const voice=await session.cue(e,shot), lead=shot.lead??.12, hold=shot.hold??.45;
      if(shot.motionAt){
        const {sentence,edge='start',offset=0}=shot.motionAt;
        const span=measuredSentences(shot,voice,phrases(shot.voice))[sentence-1];
        if(!Number.isInteger(sentence)||!Number.isFinite(span?.[edge])||!['start','end'].includes(edge)||!Number.isFinite(offset))
          throw Error('Invalid measured motion cue: '+shot.id);
        shot.motionStart=Math.max(0,lead+span[edge]+offset);
      }
      if(archiveTakes){
        const take=join(tmp,'project','takes',e.id,shot.id);
        mkdirSync(dirname(take),{recursive:true});
        writeFileSync(take+'.wav',wav(voice.bytes));
        const {bytes,...timing}=voice;
        const sidecar=timing.words || timing.marks ? timing : timing.spans;
        write(take+'.json',sidecar);
        archivedTiming.push(sidecar);
      }
      const leadSamples=Math.round(lead*24000), raw=voice.bytes.length/2;
      let effect=Buffer.alloc(0);
      if(shot.audioAfter){
        const a=shot.audioAfter, clip=inside(channel,a.file), dest=join(tmp,'effect.wav');
        inputs.digestFiles([clip]);
        ff(['-i',clip,'-vn','-af','volume='+(a.gainDb??0)+'dB','-ar','24000','-ac','1','-c:a','pcm_s16le',dest]);
        effect=pcm(dest).bytes;rmSync(dest);
      }
      const frames=Math.ceil((leadSamples+raw+effect.length/2+Math.round(hold*24000))/samplesPerFrame), duration=frames/fps;
      if(shot.actions?.length)shot.resolvedActions=resolveActions(shot,voice,{lead:leadSamples/24000,frames,fps});
      const pad=(frames*samplesPerFrame-leadSamples-raw-effect.length/2)*2;
      soundtrack.push(Buffer.alloc(2*leadSamples),voice.bytes,effect,Buffer.alloc(pad));
      const cues=captions(voice.spans,voice.bytes).map(c=>({...c,start:c.start+lead,end:c.end+lead}));
      if(shot.audioAfter?.caption && effect.length)cues.push({start:lead+raw/24000,end:lead+(raw+effect.length/2)/24000,text:shot.audioAfter.caption});
      subsAll.push(...cues.map(c=>({...c,start:c.start+total/fps,end:c.end+total/fps})));
      const external=['media','web'].includes(shot.component);
      const mediaKey=external?inputs.digestFiles([inside(channel,shot.params.file)]):'';
      if(!external&&!moduleKeys.has(shot.component)) {
        const file=brand.modules.map(dir=>inside(channel,join(dir,shot.component+'.mjs'))).find(exists);
        moduleKeys.set(shot.component,moduleHash(file,inputs));
      }
      const componentKey=external?shot.component:moduleKeys.get(shot.component);
      const assetKey=inputs.digestFiles((shot.params?.dependencies||[]).map(f=>inside(channel,f)));
      const key=digest(pictureCore,componentKey,extKey,assetKey,paintedBrand,e.format,e.shots.length,shot,index,shot.refs.map(k=>e.sources.find(s=>s.id===k).title),width,height,fps,frames,burn?cues:null,mediaKey);
      const output=join(shotCache,key+'.mp4');
      if(!quiet) process.stderr.write(e.id+'  '+(index+1)+'/'+e.shots.length+'  '+shot.heading+'\n');
      const draw=await loadComponent(channel,brand,shot.component);
      await ensureShot({output,channel,brand:paintedBrand,e,shot,index,draw,width,height,fps,profile,frames,cues,burn,plugins:await plugins(channel,brand,shot)},async options=>{await encodeShot(options);checkInputs();});
      const directed = shot.resolvedActions ? {objects:shot.objects ?? {},actions:shot.resolvedActions.map(event => ({
        ...event,filmStartFrame:total+event.startFrame,filmEndFrame:total+event.endFrame
      }))} : {};
      timeline.push({id:shot.id,startFrame:total,frames,...directed,motionStart:total/fps+(shot.motionStart||0),voiceStart:total/fps+lead,voiceEnd:total/fps+lead+raw/24000,heading:shot.heading,direction:shot.direction,component:shot.component,refs:shot.refs});
      pictures.push(output);keys.push(key);total+=frames;
    }
    if(e.format==='short' && total/fps>180) throw Error('Portrait short exceeds three minutes: '+e.id);
    const bytes=Buffer.concat(soundtrack), narration=join(tmp,'narration.wav');
    writeFileSync(narration,wav(bytes));
    const narrationMode=recordings?'recorded':voiceWorker?'custom worker':'Kokoro';
    const projectHashes=inputs.projectHashes();
    const hash=digest(e,brand,profile,subs,narrationMode,projectHashes,keys,digest(bytes),subsAll,archivedTiming,readFileSync(new URL(import.meta.url))).slice(0,20);
    const expected={profile,subtitleMode:subs};
    checkInputs();
    const reusable=await publishBundle({folder,input:hash,expected,checkInputs});
    if(reusable)return reusable;
    // All concat paths are generated hex keys; a workspace directory may contain quotes.
    const quote=p=>"'"+p.replaceAll("'","'\\''")+"'";
    const list=join(tmp,'shots.ffconcat');
    write(list,'ffconcat version 1.0\n'+pictures.map(p=>'file '+quote(p)).join('\n')+'\n');
    const levels=measure(narration);
    if(!Number.isFinite(levels.integratedLUFS)) throw Error('Narration is silent');
    const movie=join(tmp,'film.mp4');
    const qc=masterMovie({movie,list,narration,levels,title:e.title,expected:{width,height,fps,frames:total}});
    rmSync(list);
    ff(['-ss',String(Math.min(1,total/fps/2)),'-i',movie,'-frames:v','1',join(tmp,'poster.png')]);
    if(side) {write(join(tmp,'captions.srt'),subtitleText(subsAll));write(join(tmp,'captions.vtt'),subtitleText(subsAll,true));}
    write(join(tmp,'script.md'),'# '+e.title+'\n\n'+e.shots.map(s=>s.voice).join('\n\n')+'\n');
    write(join(tmp,'direction.md'),'# '+e.title+'\n\n'+timeline.map((s,i)=>'## '+(i+1)+'. '+s.heading+'\n\n'+(s.startFrame/fps).toFixed(2)+' s · '+s.component+'\n\n'+s.direction+'\n\nEvidence · '+s.refs.join(', ')).join('\n\n')+'\n');
    const fontCredits=(brand.fonts||[]).map(f=>[f.family,f.credit,f.license&&'License in project/'+f.license].filter(Boolean).join(' · '));
    write(join(tmp,'sources.md'),'# Evidence and credits\n\n'+e.sources.map(s=>'## '+s.title+'\n\n'+s.support+'\n\n'+s.locator+' · [Source]('+s.url+')').join('\n\n')+'\n\n'+e.shots.flatMap(s=>[...(['media','web'].includes(s.component)?[s.params]:[]),...(s.audioAfter?[s.audioAfter]:[])]).map(a=>a.credit+' · '+a.rights).join('\n')+(fontCredits.length?'\n\n## Channel fonts\n\n'+fontCredits.join('\n')+'\n':''));
    write(join(tmp,'timeline.json'),{fps,revision:hash,shots:timeline,captions:subsAll});
    write(join(tmp,'qc.json'),{revision:hash,inputDigest:hash,runtimeSources,profile,subtitleMode:subs,editorialStatus:'review-cut',narration:narrationMode,...qc});
    const source=join(tmp,'project');write(join(source,'brand.json'),brand);write(join(source,'episodes',e.id+'.json'),e);
    for(const dir of brand.modules)cpSync(inside(channel,dir),inside(source,dir),{recursive:true,dereference:true});
    for(const path of Object.keys(projectHashes)){
      const file=path.slice('project/'.length),dest=inside(source,file);
      if(!exists(dest)){mkdirSync(dirname(dest),{recursive:true});cpSync(inside(channel,file),dest,{dereference:true});}
    }
    return await publishBundle({folder,input:hash,tmp,expected,checkInputs,projectHashes});
  }finally{session.close();rmSync(tmp,{recursive:true,force:true});}
}
