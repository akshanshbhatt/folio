import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inside} from './common.mjs';

// Each channel may register its own named motion, camera and transition functions.
// Code runs locally with normal Node permissions, just like a custom drawing component.
export async function plugins(channel,brand,shot){
  const specs=brand.plugins||{}, result={};
  for(const [type,name] of Object.entries({curve:shot.curve,camera:shot.camera?.type,transition:shot.transition,captions:brand.captions,stage:brand.stage})){
    const file=specs[type]?.[name];
    if(!file) continue;
    const mod=await import(pathToFileURL(inside(channel,file)));
    if(typeof mod.default!=='function')throw Error('Expected a function in '+file);
    result[type]=mod.default;
  }return result;
}
