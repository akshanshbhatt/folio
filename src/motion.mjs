export const clamp = n => Math.max(0,Math.min(1,n));
export function progress(f,curve='smoother') {
  const t=clamp(f);
  if(curve==='linear') return t;
  if(curve==='smooth') return t*t*(3-2*t);
  if(curve==='out-cubic') return 1-(1-t)**3;
  return t*t*t*(t*(t*6-15)+10);
}
export function camera(ctx, spec={}, p=0) {
  const a=spec.from || [0,0,1], b=spec.to || a;
  const [x,y,z]=a.map((n,i)=>n+(b[i]-n)*p);
  ctx.translate(500+x,410+y); ctx.scale(z,z); ctx.translate(-500,-410);
}
// Rotate model coordinates before projecting. Orthographic views preserve a common scale.
export function project([x,y,z],{yaw=0,pitch=0,distance=0}={}) {
  const u=x*Math.cos(yaw)+z*Math.sin(yaw), d=z*Math.cos(yaw)-x*Math.sin(yaw);
  const v=y*Math.cos(pitch)-d*Math.sin(pitch), depth=y*Math.sin(pitch)+d*Math.cos(pitch);
  const scale=distance ? distance/(distance-depth) : 1;
  return [u*scale,v*scale,depth];
}
