import {createCanvas,GlobalFonts,Path2D,ImageData} from '@napi-rs/canvas';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,exists,inside} from './common.mjs';
import {progress,camera} from './motion.mjs';
import {cueState,applyCueCamera} from './cues.mjs';

GlobalFonts.registerFromPath(join(ROOT,'assets/fonts/DMSerifText-Regular.ttf'),'DM Serif Text');
GlobalFonts.registerFromPath(join(ROOT,'assets/fonts/DMSans.ttf'),'DM Sans');

export function sizes(format,profile) {
  const s=profile==='master'?1440:720, l=profile==='master'?2560:1280;
  return format==='short' ? [s,l] : [l,s];
}
export function figureBox(short) {
  const width = short ? 1080 : 1920;
  const height = short ? 1920 : 1080;
  const scale = Math.min(width * 0.92 / 1000, height * 0.75 / 820);
  const w = 1000 * scale, h = 820 * scale;
  return {x: (width - w) / 2, y: (height - h) / 2, w, h};
}
export function wrap(ctx,text,max) {
  const lines=[];let line='';
  for(const w of text.split(/\s+/)){
    if(line && ctx.measureText(line+' '+w).width>max){lines.push(line);line='';}
    line+=(line?' ':'')+w;
  }
  if(line) lines.push(line);return lines;
}
export async function loadComponent(channel,brand,id) {
  if(id==='media'||id==='web') return ()=>{};
  const file=brand.modules.map(dir=>inside(channel,join(dir,id+'.mjs'))).find(exists);
  if(!file) throw Error('Component missing: '+id);
  const {default:draw}=await import(pathToFileURL(file));
  if(typeof draw!=='function') throw Error('Component must export a draw function: '+id);
  return draw;
}
export function stage({brand, e, shot, draw, width, height, duration, plugins = {}}) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const theme = brand.theme;
  const portrait = e.format === 'short';
  const W = portrait ? 1080 : 1920, H = portrait ? 1920 : 1080;
  const box = figureBox(portrait);

  return function frame(time, subtitle = '') {
    ctx.save();
    ctx.scale(width / W, height / H);
    ctx.fillStyle = theme.paper;
    ctx.fillRect(0, 0, W, H);

    const elapsed = time - (shot.motionStart ?? 0);
    const fraction = shot.motion === 0 ? Number(elapsed >= 0) : Math.max(0, Math.min(1, elapsed / (shot.motion ?? 2)));
    const p = plugins.curve ? plugins.curve(fraction) : progress(fraction, shot.curve);
    ctx.save();
    ctx.translate(box.x, box.y);
    ctx.scale(box.w / 1000, box.h / 820);
    ctx.beginPath();
    ctx.rect(0, 0, 1000, 820);
    ctx.clip();
    (plugins.camera || camera)(ctx, shot.camera, p);
    const directed = cueState(shot,time);
    if (shot.resolvedActions?.length) applyCueCamera(ctx,directed.camera);
    const drawObject = (id,paint) => {
      const object = directed.objects[id];
      if (!Object.hasOwn(directed.objects,id)) throw Error(shot.id + ': undeclared drawing object ' + id);
      if (object.opacity === 0) return;
      ctx.save();
      try { ctx.globalAlpha *= object.opacity; paint(ctx,object); }
      finally { ctx.restore(); }
    };
    draw(ctx, {p, params: shot.params || {}, theme, time, duration, ...directed, drawObject, graphics: {createCanvas, Path2D, ImageData}});
    ctx.restore();

    const view = {theme, portrait, width: W, height: H, time};
    if (e.proofOf) {
      ctx.fillStyle = theme.ink;
      ctx.font = '26px "' + theme.sans + '"';
      ctx.fillText('Shot proof · ' + shot.id, W * 0.04, H * 0.055);
    }
    if (plugins.stage) plugins.stage(ctx, {...view, shot, episode: e, p});
    if (subtitle) {
      if (plugins.captions) {
        plugins.captions(ctx, {...view, text: subtitle});
      } else {
        const size = portrait ? 46 : 38, lineHeight = size * 1.25;
        ctx.font = '500 ' + size + 'px "' + theme.sans + '"';
        ctx.fillStyle = theme.ink;
        ctx.textAlign = 'center';
        const lines = wrap(ctx, subtitle, W * 0.88);
        lines.forEach((line, i) => ctx.fillText(line, W / 2, H * 0.95 - (lines.length - 1 - i) * lineHeight));
      }
    }
    if (shot.transition === 'fade' && time < 0.35) {
      ctx.save();
      ctx.globalAlpha = 1 - progress(time / 0.35);
      ctx.fillStyle = theme.paper;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    if (plugins.transition) plugins.transition(ctx, {...view, duration});
    ctx.restore();
    return canvas;
  };
}
