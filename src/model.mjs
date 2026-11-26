import {exists,inside,json,safeId} from './common.mjs';
import {readdirSync} from 'node:fs';
import {phrases} from './speech.mjs';
import {basename,join} from 'node:path';
import {fontSources} from './channel-fonts.mjs';

export function validate(e,channel) {
  function must(ok, what){if(!ok) throw Error((e.id || 'episode') + ' • ' + what);}
  function text(v){return typeof v === 'string' && v.trim().length > 0;}
  must(safeId(e.id), 'id needs a lowercase slug');
  must(text(e.title) && text(e.question), 'title and viewer question required');
  must(['short','long'].includes(e.format),'format must be short or long');
  must(Array.isArray(e.sources) && e.sources.length,'add an evidence ledger');
  const refs = new Set();
  for(const s of e.sources) {
    must(safeId(s.id) && !refs.has(s.id),'invalid or duplicate source id ' + s.id);
    must(text(s.title) && text(s.locator) && text(s.support) && /^https?:\/\//.test(s.url),'source needs title, URL, locator and support: ' + s.id);
    refs.add(s.id);
  }
  must(Array.isArray(e.shots) && e.shots.length,'empty shot list');
  const ids = new Set();
  const brand = json(join(channel,'brand.json'));
  if(brand.fonts!==undefined)fontSources(channel,brand.fonts);
  for(const s of e.shots) {
    const at = ' (' + s.id + ')';
    must(safeId(s.id) && !ids.has(s.id),'invalid or repeated shot id' + at);
    ids.add(s.id);
    must(text(s.heading) && text(s.voice) && text(s.direction),'supply heading, voice and scene direction' + at);
    must(Array.isArray(s.refs) && s.refs.length && s.refs.every(k=>refs.has(k)),'unresolved source' + at);
    must(safeId(s.component),'invalid component' + at);
    if(['media','web'].includes(s.component)){
      const a=s.params || {};
      must(text(a.file) && exists(inside(channel,a.file)) && text(a.credit) && text(a.rights),'media needs file, credit and rights' + at);
      must(a.start === undefined || Number.isFinite(a.start) && a.start>=0,'media start' + at);
    }else{
      must(brand.modules.some(dir=>exists(inside(channel,join(dir,s.component+'.mjs')))),'missing component ' + s.component);
    }
    if(s.audioAfter){const a=s.audioAfter;must(text(a.file) && exists(inside(channel,a.file)) && text(a.credit) && text(a.rights) && Number.isFinite(a.gainDb??0),'audioAfter needs file, credit, rights and numeric gain'+at);}
    for(const key of ['hold','motion','lead']) if(s[key] !== undefined) must(Number.isFinite(s[key]) && s[key]>=0 && s[key]<=120,'invalid '+key+at);
    if(s.motionAt !== undefined) {
      const anchor=s.motionAt;
      must(anchor && typeof anchor==='object' && Number.isInteger(anchor.sentence)
        && anchor.sentence>=1 && anchor.sentence<=phrases(s.voice).length
        && ['start','end'].includes(anchor.edge??'start') && Number.isFinite(anchor.offset??0),
        'motionAt needs a measured sentence in this shot'+at);
    }
    if(s.curve) must(['linear','smooth','smoother','out-cubic'].includes(s.curve)||brand.plugins?.curve?.[s.curve],'unknown curve'+at);
    if(s.transition) must(['cut','fade','match'].includes(s.transition)||brand.plugins?.transition?.[s.transition],'unknown transition'+at);
    if(s.camera) {
      for(const key of ['from','to']) if(s.camera[key]) {
        const pose=s.camera[key]; must(Array.isArray(pose)&&pose.length===3&&pose.every(Number.isFinite)&&pose[2]>0,'camera pose [panX,panY,zoom]'+at);
      }
    }
  }
  return e;
}
export function library(channel) {
  const db = new Map();
  for(const name of readdirSync(join(channel,'episodes')).sort().filter(f=>f.endsWith('.json'))) {
    const e=json(join(channel,'episodes',name));
    if(basename(name,'.json')!==e.id || db.has(e.id)) throw Error('Episode/file id mismatch: '+name);
    db.set(e.id,e);
  }
  return db;
}
