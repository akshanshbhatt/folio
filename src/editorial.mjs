import {readdirSync,cpSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {ROOT,json,write,exists,run} from './common.mjs';
import {library,validate} from './model.mjs';

export function calendar(cfg,items){
  const queues={short:items.filter(i=>i.format==='short'),long:items.filter(i=>i.format==='long')};
  const used={short:0,long:0}, slots=[];
  const first=new Date(cfg.start+'T12:00:00Z');
  if(!Number.isFinite(first.getTime())||!cfg.shortDays?.length||!cfg.shortDays.every(n=>Number.isInteger(n)&&n>=1&&n<=7)||!(cfg.longDay>=1&&cfg.longDay<=7)||!(cfg.longEveryWeeks>=1)) throw Error('Invalid release cadence');
  for(let days=0;used.short<cfg.shortTarget||used.long<cfg.longTarget;days++){
    const date=new Date(first.valueOf()+days*86400000);
    const day=date.getUTCDay()||7;
    for(const kind of ['short','long']){
      const target=cfg[kind+'Target'];
      if(used[kind]>=target) continue;
      if(kind==='short'?!cfg.shortDays.includes(day):day!==cfg.longDay||Math.floor(days/7)%cfg.longEveryWeeks!==0) continue;
      const episode=queues[kind][used[kind]++];
      slots.push({local:date.toISOString().slice(0,10)+'T'+cfg[kind+'Time'],timezone:cfg.timezone,format:kind,id:episode?.id??null,title:episode?.title??null});
    }
  }
  return slots;
}
function contents(channel){
  const db=library(channel), slate=exists(join(channel,'slate.json'))?json(join(channel,'slate.json')):[];
  const ids=new Set();for(const a of slate){if(ids.has(a.id))throw Error('Duplicate slate id '+a.id);ids.add(a.id);}
  // Interleave subject families so a week of releases has different objects and mechanisms.
  const all=[...db.values(),...slate.filter(x=>!db.has(x.id))];
  const groups=new Map();
  const strand=new Map(slate.map(a=>[a.id,a.strand]));
  for(const e of all){
    const key=strand.get(e.id)||e.strand||e.shots?.[0]?.component||'unassigned';
    if(!groups.has(key)) groups.set(key,[]);groups.get(key).push(e);
  }
  const order=[];while(order.length<all.length){for(const list of groups.values()){if(list.length)order.push(list.shift());}}
  const priorities=join(channel,'release-order.json');
  if(!exists(priorities)) return {db,order};
  const idsFirst=json(priorities), byId=new Map(order.map(e=>[e.id,e]));
  if(!Array.isArray(idsFirst)||new Set(idsFirst).size!==idsFirst.length||!idsFirst.every(k=>byId.has(k)))
    throw Error('Release order must use distinct commissioned IDs');
  const first=new Set(idsFirst);
  return {db,order:[...idsFirst.map(k=>byId.get(k)),...order.filter(e=>!first.has(e.id))]};
}
function status(out,id,db){
  if(!id) return 'unassigned';
  for(const profile of ['master','review']){
    const dir=join(out,id,profile);
    if(exists(join(dir,'latest.json'))){
      const p=json(join(dir,'latest.json'));
      if(exists(join(dir,p.revision,'qc.json')) && exists(join(dir,p.revision,'film.mp4'))){
        const e=db.get(id),saved=join(dir,p.revision,'project','episodes',id+'.json');
        if(e && exists(saved)&&JSON.stringify(e)!==JSON.stringify(json(saved))) return 'script revised';
        return profile==='master'?'encoded master · review cut':'encoded review cut';
      }
    }
  }
  return db.has(id)?'authored':'pitch';
}
const csvCell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
export async function editorial({action,id,channel,out,o}){
  if(action==='init'){
    if(!id) throw Error('Supply a new channel directory');
    const dest=resolve(id);if(exists(dest)&&readdirSync(dest).length) throw Error('Choose an empty channel directory');
    const starter=join(ROOT,'channels/starter');
    const brand=json(join(starter,'brand.json'));
    const today=new Date(),day=today.getDay()||7;
    const localDate=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
    brand.schedule={...brand.schedule,start:localDate,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,shortDays:[day],longDay:day};
    cpSync(starter,dest,{recursive:true});
    write(join(dest,'brand.json'),brand);
    console.log(dest);return;
  }
  if(action==='schedule'||action==='status'){
    const cfg=json(join(channel,'brand.json')).schedule, {db,order}=contents(channel);
    const slots=calendar(cfg,order).map(s=>({...s,state:status(out,s.id,db)}));
    if(action==='status'){
      const counts={};for(const s of slots){const k=s.format+' · '+s.state;counts[k]=(counts[k]||0)+1;}
      console.log(JSON.stringify({counts,reserveWeeks:cfg.reserveWeeks,shortsToReserve:Math.min(cfg.shortTarget,cfg.shortDays.length*cfg.reserveWeeks),longsToReserve:Math.min(cfg.longTarget,Math.ceil(cfg.reserveWeeks/cfg.longEveryWeeks))},null,2));return;
    }
    const keys=['local','timezone','format','id','title','state'];
    const csv=[keys,...slots.map(s=>keys.map(k=>s[k]))].map(row=>row.map(csvCell).join(',')).join('\n')+'\n';
    if(o.file){write(resolve(o.file),csv);console.log(resolve(o.file));}else process.stdout.write(csv);return;
  }
  if(action==='impact'){
    if(!id) throw Error('Supply a source ID, full URL or part of a source title');
    const term=id.toLowerCase(), entries=[];
    for(const e of library(channel).values()){
      const matches=e.sources.filter(s=>[s.id,s.url,s.title].some(v=>v.toLowerCase().includes(term)));
      for(const s of e.shots){
        const refs=matches.filter(m=>s.refs.includes(m.id)).map(m=>m.id);
        if(refs.length) entries.push({episode:e.id,shot:s.id,heading:s.heading,voice:s.voice,direction:s.direction,refs});
      }
    }console.log(JSON.stringify(entries,null,2));return;
  }
  if(action==='brief'){
    if(!id?.trim()) throw Error('Supply a viewer question in quotes');
    const brand=json(join(channel,'brand.json'));
    const {channelBrief}=await import('./brief.mjs');
    const brief=channelBrief(channel,brand,id);
    if(o.file)write(resolve(o.file),brief);else console.log(JSON.stringify(brief,null,2));return;
  }
  if(action==='draft'){
    if(!id||!o.provider||!o.file) throw Error('draft BRIEF.json --provider PROVIDER.json --file NEW_EPISODE.json');
    if(exists(resolve(o.file))) throw Error('Choose a new filename for the draft');
    const brief=json(resolve(id)), provider=json(resolve(o.provider)),cmd=provider.command;
    if(!Array.isArray(cmd)||!cmd.length||!cmd.every(a=>typeof a==='string')) throw Error('Provider config needs an executable and argument array');
    if(!brief.sourceNotes?.length) throw Error('Add inspected source notes before drafting');
    const prompt=[
      'Return one episode JSON object for this brief.',
      'Follow the episode schema and the channel settings. The example and componentGuide describe the local component interface.',
      'Use the approved sourceNotes as evidence. Every cited source URL must appear in sourceNotes.',
      JSON.stringify(brief)
    ].join('\n');
    const result=run(cmd[0],cmd.slice(1),{input:prompt,stdio:['pipe','pipe','pipe']});
    const draft=validate(JSON.parse(result.trim().replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/g,'')),channel);
    const allowed=new Set(brief.sourceNotes.map(s=>s.url));
    if(draft.sources.some(s=>!allowed.has(s.url))) throw Error('Draft introduced a URL beyond the supplied research notes');
    write(resolve(o.file),draft);console.log(resolve(o.file));return;
  }
}
