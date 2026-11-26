import {spawn} from 'node:child_process';
import {createCanvas} from '@napi-rs/canvas';

// Reduce a potentially long interval to one peak per column without retaining the audio buffer.
export async function waveform(file, start, end, brand, {width=1280,height=720}={}) {
  if (!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start) throw Error('Choose an increasing waveform interval');
  const rate=8000, columns=Math.max(100,Math.round(width/3)), peaks=new Float32Array(columns);
  const total=Math.round((end-start)*rate);
  const proc=spawn('ffmpeg',['-nostdin','-v','error','-ss',String(start),'-t',String(end-start),'-i',file,
    '-map','0:a:0','-ac','1','-ar',String(rate),'-f','f32le','pipe:1'],{stdio:['ignore','pipe','inherit']});
  const ended=new Promise((resolve,reject)=>{proc.once('error',reject);proc.once('close',resolve);});
  ended.catch(()=>{});
  let count=0, rest=Buffer.alloc(0);
  for await(const chunk of proc.stdout){
    const data=rest.length?Buffer.concat([rest,chunk]):chunk;
    let offset=0;
    for(;offset+4<=data.length;offset+=4,count++){
      const bin=Math.min(columns-1,Math.floor(count*columns/total));
      peaks[bin]=Math.max(peaks[bin],Math.abs(data.readFloatLE(offset)));
    }
    rest=data.subarray(offset);
  }
  if(await ended!==0||count===0)throw Error('Could not read the selected audio');
  const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
  ctx.fillStyle=brand.background??'#101820';ctx.fillRect(0,0,width,height);
  const x0=width*.06,span=width*.88,mid=height*.5,peak=Math.max(.00001,...peaks);
  ctx.fillStyle=brand.waveform??'#d4d5d9';ctx.fillRect(x0,mid-1,span,2);
  peaks.forEach((value,i)=>{
    const h=value/peak*height*.34;
    ctx.fillStyle=value>.7*peak?(brand.focus??'#f8aa4b'):(brand.waveform??'#d4d5d9');
    ctx.fillRect(x0+i*span/columns,mid-h,Math.max(1,span/columns*.88),Math.max(1,2*h));
  });
  return canvas.toBuffer('image/png');
}
