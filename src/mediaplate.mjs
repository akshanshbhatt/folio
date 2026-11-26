import {spawn} from 'node:child_process';
import {createCanvas,ImageData,loadImage} from '@napi-rs/canvas';

// Import into the stage when shot-level direction must act on the media itself.
// Ordinary untransformed clips can use FFmpeg's cheaper fitted overlay.
export async function directedPlate(media,params,width,height,fps,frames){
  if(media.still){
    const image=await loadImage(media.file);
    const k=Math.min(1000/image.width,820/image.height),w=image.width*k,h=image.height*k;
    return {next:async()=>{},draw:ctx=>ctx.drawImage(image,(1000-w)/2,(820-h)/2,w,h),close(){}};
  }
  const duration=Number(media.video.duration);
  if(params.start && params.start>=duration)throw Error('Media start beyond clip: '+params.file);
  const args=['-nostdin','-loglevel','error','-threads','2'];
  if(params.start)args.push('-ss',String(params.start));
  args.push('-i',media.file,'-an','-filter_threads','2','-vf',
    'fps='+fps+',scale='+width+':'+height+':force_original_aspect_ratio=decrease,format=rgba,pad='+width+':'+height+':(ow-iw)/2:(oh-ih)/2:color=black@0',
    '-frames:v',String(frames),'-pix_fmt','rgba','-f','rawvideo','pipe:1');
  const child=spawn('ffmpeg',args,{stdio:['ignore','pipe','pipe']});
  const stream=child.stdout[Symbol.asyncIterator]();
  const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
  const buffer=Buffer.alloc(width*height*4);
  let rest=Buffer.alloc(0),ended=false,haveFrame=false,diagnostic='';
  child.stderr.on('data',b=>diagnostic=(diagnostic+b.toString()).slice(-1400));
  async function next(){
    if(ended)return;
    let filled=0;
    while(filled<buffer.length){
      if(!rest.length){const part=await stream.next();if(part.done){
        ended=true;if(filled||!haveFrame)throw Error('Incomplete imported video frame: '+diagnostic);return;
      }rest=part.value;}
      const n=Math.min(buffer.length-filled,rest.length);
      rest.copy(buffer,filled,0,n);rest=rest.subarray(n);filled+=n;
    }
    ctx.putImageData(new ImageData(new Uint8ClampedArray(buffer.buffer,buffer.byteOffset,buffer.length),width,height),0,0);
    haveFrame=true;
  }
  return {next,draw:target=>target.drawImage(canvas,0,0,1000,820),close:()=>child.kill(),moving:true};
}
