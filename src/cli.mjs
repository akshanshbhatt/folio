#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {join,resolve} from 'node:path';
import {ROOT,json,write} from './common.mjs';
import {validate,library} from './model.mjs';
import {render,verifyMovie} from './render.mjs';
import {inspectBundle} from './integrity.mjs';
async function main(){
  if (process.argv[2] === 'workflow' && process.argv[3] === 'design') {
    const {workflowDesignCli} = await import('./workflow-design.mjs');
    return workflowDesignCli(process.argv.slice(4));
  }
  if (process.argv[2] === 'workflow') {
    const {workflowCli} = await import('./workflow.mjs');
    return workflowCli(process.argv.slice(3));
  }
  const {positionals:[action,id],values:o}=parseArgs({allowPositionals:true,options:{
  channel:{type:'string'},shot:{type:'string'},profile:{type:'string',default:'review'},subs:{type:'string',default:'sidecar'},out:{type:'string'},cache:{type:'string'},recordings:{type:'string'},'voice-worker':{type:'string'},quiet:{type:'boolean'},help:{type:'boolean',short:'h'},file:{type:'string'},provider:{type:'string'}
}});
  const channel=resolve(o.channel || join(ROOT,'channels/starter')),out=resolve(o.out||'renders'),cache=resolve(o.cache||'.folio');
  if(!action||o.help){console.log('foliofilm workflow --help (design, plan, run and review a production)\nfoliofilm list | validate [id] | render <id> | proof <id> --shot <id> | batch | verify <bundle> | schedule | status | impact <source> | init <path> | brief <idea> | draft <brief.json>\n--channel PATH  --profile review|master  --subs sidecar|burn|both|none\n--out PATH  --cache PATH  --recordings PATH  --voice-worker CONFIG.json');return;}
  if(action==='init'||action==='brief'||action==='draft'||action==='schedule'||action==='status'||action==='impact'){
    const {editorial}=await import('./editorial.mjs');await editorial({action,id,channel,out,o});return;
  }
  if(action==='proof'){
    const {shotProof}=await import('./proof.mjs');
    console.log(await shotProof({channel,episodeId:id,shotId:o.shot,out,cache,profile:o.profile,subs:o.subs,recordings:o.recordings,voiceWorker:o['voice-worker'],quiet:o.quiet}));
    return;
  }
  if(o.shot)throw Error('--shot selects one shot for the proof command');
  if(action==='verify'){const bundle=resolve(id);const q=inspectBundle(bundle);console.log(JSON.stringify(verifyMovie(join(bundle,'film.mp4'),q),null,2));return;}
  const brand=json(join(channel,'brand.json')),db=library(channel);
  if(action==='list'){for(const [key,e] of db) console.log(e.format.padEnd(5),key,e.title);return;}
  if(id&&!db.has(id)) throw Error('Unknown episode: '+id);
  if(action==='validate'){for(const e of id?[db.get(id)]:db.values()) validate(e,channel);console.log('Validated '+(id?1:db.size)+' episode(s)');return;}
  if(action==='render'&&!id) throw Error('Supply an episode id. See foliofilm list.');
  if(!['render','batch'].includes(action)) throw Error('Unknown command: '+action);
  for(const e of action==='batch'?db.values():[db.get(id)]) console.log(await render({channel,e,brand,out,cache,profile:o.profile,subs:o.subs,recordings:o.recordings,voiceWorker:o['voice-worker'],quiet:o.quiet,trackDefinitions:true}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
