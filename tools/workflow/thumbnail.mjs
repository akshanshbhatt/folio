// Produce an editable art brief's measured waveform crop or a directed frame from supplied footage.
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {waveform} from './waveform.mjs';

const req=JSON.parse(readFileSync(0,'utf8'));
const brief=JSON.parse(readFileSync(req.inputs.brief,'utf8'));
const brand=req.brand ? JSON.parse(readFileSync(req.brand,'utf8')) : {};
const canvas=createCanvas(1280,720), ctx=canvas.getContext('2d');
ctx.fillStyle=brand.background ?? '#101820';ctx.fillRect(0,0,1280,720);
function extract(args) {
  const result=spawnSync('ffmpeg',['-nostdin','-v','error',...args],{maxBuffer:32*1024*1024});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error(result.stderr.toString());
  if(!result.stdout.length)throw Error('Selected source interval produced no media');
  return result.stdout;
}
if(brief.mode==='waveform'){
  writeFileSync(req.outputs.cover,await waveform(req.inputs.recording,brief.sourceIn,brief.sourceOut,brand));
}else if(brief.mode==='frame'){
  if(!Number.isFinite(brief.time)||brief.time<0)throw Error('Choose a nonnegative frame time');
  const raw=extract(['-ss',String(brief.time),'-i',req.inputs.recording,'-frames:v','1','-vf','scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720','-f','image2pipe','-c:v','png','pipe:1']);
  ctx.drawImage(await loadImage(raw),0,0);
  writeFileSync(req.outputs.cover,canvas.toBuffer('image/png'));
}else throw Error('Choose waveform or frame');
