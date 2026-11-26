// Workflow handoffs for this specific, reviewed historical experiment.
import {readFileSync,copyFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createCanvas} from '@napi-rs/canvas';
import {json,write,probe} from '../../src/common.mjs';
import {encodeShot} from '../../src/video.mjs';
import {validateTimings,phrases} from '../../src/speech.mjs';
import {captions,subtitleText} from '../../src/subtitles.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fileHash=file=>hash(readFileSync(file));
const stable=value=>Array.isArray(value)?value.map(stable):value && typeof value==='object'
  ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const fingerprint=value=>hash(JSON.stringify(stable(value)));
const need=(ok,message)=>{if(!ok)throw Error(message);};
const req=JSON.parse(readFileSync(0,'utf8')),inputs=req.inputs,outputs=req.outputs;
const get=role=>json(inputs[role]);
const fps=30;

if(req.stage==='narration'){
  const script=get('script'),timing=get('markers'),sound=probe(inputs.recording).streams.find(s=>s.codec_type==='audio');
  need(sound?.codec_name==='flac' && sound.channels===1 && Number(sound.sample_rate)===timing.rate &&
    Number(sound.duration_ts)===timing.samples && timing.rate===24000 && timing.referenceSha256===fileHash(inputs.recording),
    'The measured reference and the supplied 24 kHz mono performance must be the same recording');
  need(timing.beats.length===script.beats.length,'Performance does not cover the script');
  let previous=0;
  for(const [i,beat] of script.beats.entries()){
    const take=timing.beats[i];
    need(take.id===beat.id && Number.isSafeInteger(take.startSample) && Number.isSafeInteger(take.endSample) &&
      take.startSample>=previous && take.endSample>take.startSample && take.endSample<=timing.samples,'Invalid beat sample boundaries');
    need(JSON.stringify(take.spans.map(s=>s.text))===JSON.stringify(phrases(beat.voice)),'Performance text diverges from the accepted script: '+beat.id);
    validateTimings({spans:take.spans},take.endSample/timing.rate,beat.id);
    need(take.spans[0].start>=take.startSample/timing.rate,'Sentence begins before its beat');
    previous=take.endSample;
    take.references=beat.references;
  }
  need(previous===timing.samples,'Last beat must reach the end of the performance');
  copyFileSync(inputs.recording,outputs.voice);
  write(outputs.alignment,timing);
}else if(req.stage==='picture'){
  const {plate,cover}=await import('./tabletop.mjs');
  const script=get('script'),board=get('board'),review=get('review'),timing=get('alignment');
  need(review.decision==='accept' && review.reviewedInputs.script===fingerprint(script) &&
    review.reviewedInputs.board===fingerprint(board) && review.reviewedInputs.brand===fingerprint(json(req.brand)),
    'The supplied signoff must match this script, board and brand');
  need(timing.referenceSha256===fileHash(inputs.voice),'Re-align the replacement performance before drawing the picture');
  const order=board.shots.map(s=>s.beat);
  need(JSON.stringify(order)===JSON.stringify(['count','recover','clocks','limit']) &&
    JSON.stringify(timing.beats.map(b=>b.id))===JSON.stringify(order),'No drawing for this revised beat sequence');
  const clocks=board.shots[2].clocks;
  need(clocks.length===2&&clocks.every(clock=>clock.cards===45&&Number.isInteger(clock.fps)&&clock.fps>0&&
    clock.fps<=fps&&clock.durationSeconds===clock.cards/clock.fps),'Unsupported experiment clock');
  const frames=Math.round(timing.samples/timing.rate*fps);
  const starts=timing.beats.map(b=>Math.round(b.startSample/timing.rate*fps));
  const track=timing.beats.flatMap(b=>b.spans);
  const runs=timing.beats[2].spans.slice(1,3).map(s=>Math.ceil(s.start*fps));
  const windows=runs.map(startFrame=>({startFrame,clocks:clocks.map(k=>({...k,endFrame:startFrame+Math.ceil(k.durationSeconds*fps)}))}));
  need(windows.length===2 && windows[0].clocks.every(c=>c.endFrame<=runs[1]) &&
    windows[1].clocks.every(c=>c.endFrame<starts[3]),'The performance needs space for two complete clock trials');
  const stage=(c,v)=>{
    const frame=Math.round(v.time*fps),i=starts.findLastIndex(origin=>frame>=origin);
    c.save();c.scale(v.width/1280,v.height/720);
    plate(c,{time:v.time,frame,fps,span:timing.beats[i].spans,shot:board.shots[i],clocks});
    c.restore();
  };
  await encodeShot({channel:req.project,brand:{theme:{paper:'#f0e7d4',ink:'#1c2b2c',sans:'DM Sans'}},
    e:{format:'long'},shot:{id:'desk-tableau',component:'desk',continuous:true,motion:0},draw:()=>{},
    width:1280,height:720,fps,frames,profile:'review',cues:[],burn:false,plugins:{stage},output:outputs.plate});
  const coverCanvas=createCanvas(1280,720);cover(coverCanvas.getContext('2d'));
  writeFileSync(outputs.cover,coverCanvas.toBuffer('image/png'));
  const {execFileSync}=await import('node:child_process');
  const raw=execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-i',inputs.voice,'-c:a','pcm_s16le','-f','s16le','pipe:1'],{encoding:null,maxBuffer:32*1024*1024});
  const subs=captions(track,raw);
  write(outputs.edl,{fps,size:[1280,720],selects:[{source:'performance',pictureSource:'plate',in:0,out:timing.samples/timing.rate,captions:subs}]});
  write(outputs.directions,{fps,frames,shotStarts:starts,clockTrials:windows,shots:board.shots});
}else if(req.stage==='edition'){
  const script=get('script'),board=get('board'),review=get('review'),timing=get('alignment'),edl=get('edl');
  const picture=get('directions'),edit=get('timeline'),claims=get('claims'),evidence=get('evidence');
  need(review.decision==='accept'&&review.reviewedInputs.script===fingerprint(script)&&review.reviewedInputs.board===fingerprint(board),
    'Final edit needs a review of this script and board');
  need(picture.frames===edit.frames&&edit.fps===picture.fps,'The edit changed the planned picture timing');
  const v=probe(inputs.movie).streams.find(s=>s.codec_type==='video');
  need(v?.codec_name==='h264'&&Number(v.nb_frames)===edit.frames,'Movie does not match its cut');
  copyFileSync(inputs.movie,outputs.movie);copyFileSync(inputs.cover,outputs.cover);copyFileSync(inputs.captions,outputs.captions);
  write(outputs.srt,subtitleText(edl.selects[0].captions));
  write(outputs.script,'# '+script.title+'\n\n'+script.beats.map(b=>b.voice).join('\n\n')+'\n');
  write(outputs.direction,'# Scene direction\n\n'+board.shots.map((s,i)=>'## '+s.onScreen+'\n\n'+
    (picture.shotStarts[i]/picture.fps).toFixed(2)+' s · '+s.direction).join('\n\n')+'\n');
  write(outputs.sources,{title:script.title,edition:'Original numbered-tile animation and synthetic narration',
    performance:{sha256:timing.referenceSha256,generation:timing.generation,rate:timing.rate,samples:timing.samples},
    sources:get('selection').sources,acceptedClaims:claims.accepted,evidence,review,script,picture,edit,
    beats:timing.beats.map(b=>({id:b.id,firstSample:b.startSample,lastSampleExclusive:b.endSample,spans:b.spans,references:b.references})),
    files:{movie:fileHash(outputs.movie),cover:fileHash(outputs.cover),vtt:fileHash(outputs.captions),srt:fileHash(outputs.srt)}});
}else throw Error('Unknown history edition stage: '+req.stage);
