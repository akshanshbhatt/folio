import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {exists,inside,safeId} from './common.mjs';
import {library} from './model.mjs';

// Example selection is deterministic and local, including for entirely offline channels.
const stopWords=new Set('a an and are as at be by can do does for from how i in is it of on or the they to what when where which why with would'.split(' '));
function terms(value){
  return new Set((value.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).filter(x=>!stopWords.has(x)));
}
function overlap(set,text){
  const words=terms(text);let score=0;
  for(const word of set)if(words.has(word))score++;
  return score;
}

const builtIns={
  media:{use:'Fit a credited local image or video in the evidence area.',requiredParams:{file:'Channel-relative media path',credit:'Creator or source',rights:'Reuse terms'}},
  web:{use:'Render a local HTML plate that exposes window.drawPlate.',requiredParams:{file:'Channel-relative HTML path',credit:'Creator or source',rights:'Reuse terms'},optionalParams:{dependencies:'Channel-relative paths to local scripts, images, fonts or other files'}},
};
function localModules(channel,brand){
  const modules=new Map(),seen=new Set();
  for(const dir of brand.modules||[]){
    const path=inside(channel,dir);
    if(!exists(path))continue;
    for(const entry of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      if(!entry.isFile()||!entry.name.endsWith('.mjs'))continue;
      const id=entry.name.slice(0,-4);
      if(seen.has(id)||Object.hasOwn(builtIns,id)||!safeId(id))continue;
      seen.add(id);
      const file=join(dir,entry.name),code=readFileSync(inside(channel,file),'utf8');
      // Reading the source also works for an unused renderer; constructing a
      // planning brief never needs to execute channel JavaScript or import assets.
      if(/\bexport\s+(?:default\b|\{[^}]*\bdefault\b[^}]*\})/.test(code))modules.set(id,file);
    }
  }
  return modules;
}

function preview(value,depth=0){
  if(typeof value==='string')return value.length>90?value.slice(0,90)+'…':value;
  if(value===null||typeof value!=='object')return value;
  if(depth>=3)return Array.isArray(value)?'[array]':'[object]';
  if(Array.isArray(value))return value.slice(0,2).map(item=>preview(item,depth+1));
  return Object.fromEntries(Object.entries(value).slice(0,8).map(([k,v])=>[k,preview(v,depth+1)]));
}

function exemplar(episode){
  if(!episode)return {example:null,episodeFields:{
    episode:['id','title','format (short or long)','question','sources','shots'],
    source:['id','title','url','locator','support'],
    shot:['id','heading','voice','direction','refs (source IDs)','component','params']
  }};
  const excerpt=episode.shots.length>5||JSON.stringify(episode).length>10000;
  if(!excerpt)return {exampleFile:'episodes/'+episode.id+'.json',example:episode};
  const shots=[];let remaining=6500,previewOnly=false;
  for(const shot of episode.shots){
    const length=JSON.stringify(shot).length;
    if(length>remaining)continue;
    shots.push(shot);remaining-=length;if(shots.length===3)break;
  }
  if(!shots.length){
    const shot=episode.shots[0];shots.push({...shot,params:preview(shot.params||{})});previewOnly=true;
  }
  const refs=new Set(shots.flatMap(s=>s.refs));
  return {exampleFile:'episodes/'+episode.id+'.json',exampleExcerpt:{included:shots.length,total:episode.shots.length,paramsAbbreviated:previewOnly},
    example:{...episode,shots,sources:episode.sources.filter(s=>refs.has(s.id))}};
}

function componentGuide(id,module,shots,question){
  const observed=new Map(),examples=[];
  for(const {shot} of shots){
    for(const [key,value] of Object.entries(shot.params||{})){
      if(!observed.has(key))observed.set(key,new Set());
      observed.get(key).add(Array.isArray(value)?'array':value===null?'null':typeof value);
    }
  }
  // Prefer examples close to the question, then shorter examples. A second
  // distinct parameter shape can illustrate a different use of the component.
  const ranked=shots.map(({episode,shot})=>{
    const params=shot.params||{},size=JSON.stringify(params).length;
    const discriminator=params.view??params.mode??params.kind??params.type??params.variant??Object.keys(params).sort().join(',');
    return {episode,shot,params,size,variant:JSON.stringify(discriminator),
      score:overlap(question,[episode.title,shot.heading,shot.direction].join(' '))};
  }).sort((a,b)=>b.score-a.score||a.size-b.size);
  const seen=new Set();
  for(const a of ranked){
    if(seen.has(a.variant))continue;seen.add(a.variant);
    const item={episode:a.episode.id,shot:a.shot.id,use:a.shot.direction};
    if(a.size<=750)item.params=a.params;
    else{
      item.paramsPreview=preview(a.params);
      item.parameterFile='episodes/'+a.episode.id+'.json (shots[].id = '+a.shot.id+')';
    }
    examples.push(item);if(examples.length===2)break;
  }
  return {...(module?{module}:builtIns[id]),observedParams:Object.fromEntries(
    [...observed].sort(([a],[b])=>a.localeCompare(b)).map(([key,types])=>[key,[...types].sort().join(' | ')])),examples};
}

export function channelBrief(channel,brand,question){
  const modules=localModules(channel,brand),query=terms(question);
  const episodes=exists(join(channel,'episodes'))?[...library(channel).values()].filter(e=>e.shots?.length):[];
  const ranked=episodes.map(episode=>({episode,score:overlap(query,[episode.id,episode.title,episode.question].join(' '))}))
    .sort((a,b)=>b.score-a.score||(a.episode.format==='short'?0:1)-(b.episode.format==='short'?0:1)||a.episode.shots.length-b.episode.shots.length);
  const components=[...new Set([...modules.keys(),...Object.keys(builtIns)])].sort();
  const shots=new Map(components.map(id=>[id,[]]));
  for(const episode of episodes)for(const shot of episode.shots)shots.get(shot.component)?.push({episode,shot});
  return {question,channel:brand.name,promise:brand.description,sourceNotes:[],components,
    componentGuide:Object.fromEntries(components.map(id=>[id,componentGuide(id,modules.get(id),shots.get(id),query)])),
    ...exemplar(ranked[0]?.episode)};
}
