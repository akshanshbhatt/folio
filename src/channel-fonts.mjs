import {GlobalFonts} from '@napi-rs/canvas';
import {statSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {digest,inside} from './common.mjs';

const loadedFamilies=new Set();

function fontAsset(channel,value,field) {
  if(typeof value!=='string'||!value.trim()||isAbsolute(value)) {
    throw Error('Channel font '+field+' must be a channel-relative file');
  }
  const file=inside(channel,value);
  if(!statSync(file,{throwIfNoEntry:false})?.isFile())throw Error('Missing channel font '+field+': '+value);
  return file;
}

export function fontSources(channel,fonts) {
  if(!Array.isArray(fonts))throw Error('brand.fonts must be an array');
  return fonts.map(font=>{
    if(!font||typeof font.family!=='string'||!font.family.trim())throw Error('Each channel font needs a family name');
    if(font.credit!==undefined&&typeof font.credit!=='string')throw Error('Channel font credit must be text');
    return {
      family:font.family.trim(),
      file:fontAsset(channel,font.file,'file'),
      license:font.license===undefined?null:fontAsset(channel,font.license,'license')
    };
  });
}

export function stageBrand(channel,brand,inputs) {
  if(!brand.fonts?.length)return brand;
  const filesByFamily=new Map();
  for(const font of fontSources(channel,brand.fonts)) {
    if(font.license)inputs.digestFiles([font.license]);
    if(!filesByFamily.has(font.family))filesByFamily.set(font.family,[]);
    const files=filesByFamily.get(font.family);
    if(!files.includes(font.file))files.push(font.file);
  }
  const families=Object.create(null);
  for(const [family,files] of filesByFamily) {
    // Two channels can use different fonts under the same editorial name in
    // the same process. Keep the public name in the exported brand manifest.
    const faces=files.map(file=>inputs.bytes(file));
    const alias='Foliofont '+digest(family,...faces).slice(0,32);
    if(!loadedFamilies.has(alias)) {
      const keys=[];
      try{
        for(const [index,face] of faces.entries()) {
          // Skia caches registrations by filename. Register the measured bytes
          // so replacing a font in place also takes effect in a warm process.
          const key=GlobalFonts.register(face,alias);
          if(!key)throw Error('Canvas could not load font: '+files[index]);
          keys.push(key);
        }
      }catch(error){
        if(keys.length)GlobalFonts.removeBatch(keys);
        throw error;
      }
      loadedFamilies.add(alias);
    }
    families[family]=alias;
  }
  const theme={...brand.theme,fonts:families};
  for(const role of ['display','sans'])if(families[theme[role]])theme[role]=families[theme[role]];
  return {...brand,theme};
}
