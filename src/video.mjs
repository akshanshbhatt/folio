import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {once} from 'node:events';
import {rmSync,renameSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {exists,inside,probe,run} from './common.mjs';
import {directedPlate} from './mediaplate.mjs';
import {webPlate} from './webplate.mjs';
import {progress} from './motion.mjs';
import {cueState} from './cues.mjs';
import {stage,figureBox} from './stage.mjs';

export function samples(frames,fps,shot,captions,burn) {
  if(shot.continuous) return Array.from({length:frames},(_,i)=>i);
  const selected=new Set([frames-1]);
  selected.add(0);
  const start=Math.max(0,Math.floor((shot.motionStart || 0)*fps));
  const end=Math.min(frames-1,Math.ceil(((shot.motionStart || 0)+(shot.motion??2))*fps));
  for(let f=start;f<=end;f++) selected.add(f);
  for(const action of shot.resolvedActions ?? []) {
    for(let f=action.startFrame;f<=Math.min(frames-1,action.endFrame);f++) selected.add(f);
  }
  if(shot.transition==='fade') for(let f=0;f<=Math.min(frames-1,Math.ceil(.35*fps));f++) selected.add(f);
  if(burn) for(const cue of captions) for(const v of [cue.start,cue.end]) selected.add(Math.min(frames-1,Math.max(0,Math.ceil(v*fps))));
  return [...selected].sort((a,b)=>a-b);
}
export function presentationTimes(frames){
  let offset=0;const terms=['N'];
  frames.forEach((f,i)=>{const gap=f-i-offset;if(gap){terms.push('gte(N,'+i+')*'+gap);offset+=gap;}});
  return terms.join('+');
}
export function imageMedia(channel,params) {
  const file=inside(channel,params.file);
  const streams=probe(file).streams, video=streams.find(x=>x.codec_type==='video');
  if(!video) throw Error('Imported asset has no picture: '+file);
  const still=/\.(png|jpe?g|webp|bmp|tiff?)$/i.test(file);
  return {file,still,video};
}
export async function encodeShot(o) {
  if(exists(o.output)) return;
  const tmp=o.output+'.'+randomUUID()+'.mp4';
  const {width,height,fps,shot,frames}=o;
  const box=figureBox(o.e.format==='short'),scale=width/(o.e.format==='short'?1080:1920);
  const needsDirection=shot.camera || (shot.component==='media' && shot.params.object) || shot.resolvedActions?.length || (shot.transition&&!['cut','match'].includes(shot.transition)) || o.plugins?.stage || o.plugins?.transition;
  const media=shot.component==='media'&&needsDirection
    ? await directedPlate(imageMedia(o.channel,shot.params),shot.params,Math.round(box.w*scale),Math.round(box.h*scale),fps,frames)
    : null;
  const sequence=samples(frames,fps,media?.moving?{...shot,continuous:true}:shot,o.cues,o.burn);
  let web,webImage,lastProgress;
  if(shot.component==='web') web=await webPlate(o.channel,shot,o.brand.theme,width/(o.e.format==='short'?1080:1920)*figureBox(o.e.format==='short').w);
  let draw=o.draw;
  if(web)draw=ctx=>ctx.drawImage(webImage,0,0,1000,820);
  if(media)draw=shot.params.object
    ? (ctx,state)=>state.drawObject(shot.params.object,()=>media.draw(ctx))
    : media.draw;
  const paint=stage({...o,draw,duration:frames/fps});
  const args=['-nostdin','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',width+'x'+height,'-framerate',String(fps),'-i','pipe:0'];
  const fastOverlay=shot.component==='media'&&!media;
  // Convert each authored picture once. The fps stage can reuse that YUV frame for a teaching hold.
  const colour='scale=out_color_matrix=bt709:out_range=tv,format=yuv420p';
  const filters=['[0:v]'+(fastOverlay?'':colour+',')+"setpts='"+presentationTimes(sequence)+"',fps="+fps+':round=near,setsar=1[base]'];
  let source='[base]';
  if(fastOverlay){
    const a=shot.params, m=imageMedia(o.channel,a), portrait=o.e.format==='short', scale=width/(portrait?1080:1920), box=figureBox(portrait);
    if(m.still) args.push('-loop','1','-framerate',String(fps));
    if(a.start) args.push('-ss',String(a.start));
    args.push('-i',m.file);
    if(!m.still && a.start && a.start>=Number(m.video.duration)) throw Error('Media start beyond clip: '+a.file);
    const w=2*Math.floor(box.w*scale/2),h=2*Math.floor(box.h*scale/2);
    filters.push('[1:v]setpts=PTS-STARTPTS,fps='+fps+',scale='+w+':'+h+':force_original_aspect_ratio=decrease,setsar=1[asset]');
    filters.push('[base][asset]overlay=x='+Math.round(box.x*scale)+'+('+w+'-w)/2:y='+Math.round(box.y*scale)+'+('+h+'-h)/2:eof_action=repeat[v]');
    source='[v]';
  }
  args.push('-filter_complex_threads','2','-filter_complex',filters.join(';'),'-map',source,'-frames:v',String(frames),'-an');
  args.push('-c:v','libx264','-preset',o.profile==='master'?'ultrafast':'veryfast','-crf',o.profile==='master'?'15':'18','-threads','4','-pix_fmt','yuv420p','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709',tmp);
  // Specify the RGB→YUV matrix explicitly, independently from the stream metadata.
  const pos=args.indexOf('-filter_complex')+1;
  if(fastOverlay){args[pos]+=';'+source+colour+'[out]';args[args.indexOf('-map')+1]='[out]';}
  const child=spawn('ffmpeg',args,{stdio:['pipe','ignore','pipe']});let error='';
  child.stderr.on('data',b=>error=(error+b.toString()).slice(-2400));
  child.stdin.on('error',()=>{});
  const done=once(child,'close').then(([code])=>{if(code!==0)throw Error('FFmpeg shot '+shot.id+': '+error);});
  done.catch(()=>{});
  try{
    for(const f of sequence) {
      const t=f/fps, sub=o.burn?o.cues.find(c=>t>=c.start&&t<c.end)?.text:'';
      if(web){
        const elapsed=t-(shot.motionStart||0);
        const fraction=shot.motion===0?Number(elapsed>=0):Math.max(0,Math.min(1,elapsed/(shot.motion??2)));
        const p=o.plugins?.curve ? o.plugins.curve(fraction) : progress(fraction,shot.curve);
        if(p!==lastProgress||shot.continuous||shot.resolvedActions?.length){
          webImage=await web.paint(p,t,cueState(shot,t));lastProgress=p;
        }
      }
      if(media)await media.next();
      const frame=paint(t,sub).data();
      if(!child.stdin.write(frame)) await Promise.race([once(child.stdin,'drain'),done.then(()=>{throw Error('FFmpeg ended early');})]);
    }
    child.stdin.end();await done;
    const stream=probe(tmp).streams[0];
    if(Number(stream.nb_frames)!==frames) throw Error(shot.id+': expected '+frames+' frames, got '+stream.nb_frames);
    renameSync(tmp,o.output);
  }finally{media?.close();if(web)await web.close();if(child.exitCode===null) child.kill();rmSync(tmp,{force:true});}
}
