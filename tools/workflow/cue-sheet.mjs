// Compile a director's cues before any picture is rendered.
import {readFileSync,writeFileSync} from 'node:fs';
import {probe,safeId} from '../../src/common.mjs';
import {validateTimings} from '../../src/speech.mjs';
import {validateDirection,resolveActions} from '../../src/cues.mjs';

const read = path => JSON.parse(readFileSync(path,'utf8'));
const req = read(0), shot = read(req.inputs.direction), source = read(req.inputs.alignment);
const timing = Array.isArray(source) ? {spans:source} : source;
const fps = req.settings?.fps ?? 30;
if(!safeId(shot.id)||typeof shot.voice!=='string'||!Number.isInteger(fps)||fps<1||fps>120)
  throw Error('Supply a direction with a shot id, transcript, and a valid output fps');
const media = probe(req.inputs.take);
const audio = media.streams.find(s=>s.codec_type==='audio');
const duration = Number(audio?.duration ?? media.format.duration);
if(!audio||!Number.isFinite(duration)||duration<=0) throw Error('The performance must contain measurable audio');
validateDirection(shot);
validateTimings(timing,duration,'performance alignment');
const normalized = str => str.trim().replace(/\s+/gu,' ');
if(normalized(timing.spans.map(s=>s.text).join(' '))!==normalized(shot.voice))
  throw Error('The supplied timing spans do not transcribe this performance direction');
const lead=shot.lead??0, hold=shot.hold??0;
if(![lead,hold].every(v=>Number.isFinite(v)&&v>=0))throw Error('Lead and hold must be nonnegative seconds');
const frames = Math.ceil((lead+duration+hold)*fps-1e-9);
const actions = resolveActions(shot,timing,{lead,frames,fps}).map(a=>({...a,filmStartFrame:a.startFrame,filmEndFrame:a.endFrame}));
const timeline = {fps,shots:[{id:shot.id,startFrame:0,frames,voiceStart:lead,voiceEnd:lead+duration,objects:shot.objects??{},actions}]};
writeFileSync(req.outputs.cues,JSON.stringify(timeline,null,2)+'\n');

// This optional edit combines a full performance with an independently rendered plate.
if(req.outputs.edl){
  if(lead || hold)throw Error('For padded clips, author an edit with the intended room tone or soundtrack.');
  const edl={fps,size:req.settings?.size ?? [1280,720],selects:[{source:'performance',pictureSource:'plate',frames,in:0,out:duration,captions:timing.spans}]};
  writeFileSync(req.outputs.edl,JSON.stringify(edl,null,2)+'\n');
}
