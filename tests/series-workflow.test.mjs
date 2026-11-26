import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ROOT,write,json} from '../src/common.mjs';
import {executeWorkflow} from '../src/workflow.mjs';
import {designWorkflow} from '../src/workflow-design.mjs';

function fixture(t) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'folio-series-flow-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const local=name=>join(root,name);
  const source=rev=>({representations:{drawing:{file:rev+'.txt',controls:[],redistribute:true,rights:'Original fixture'}}});
  write(local('series.json'),{version:1,id:'rehearsal',roles:['artist','writer'],episodes:['episode.json'],
    defaults:[{key:'camera',value:'wide',source:'Floor plan',roles:['artist']}],
    assets:{object:{variants:{normal:{revisions:{first:source('first'),second:source('second')}}}}},
    board:[{id:'future',note:'Private reveal',source:'Story notes',roles:['writer']}]});
  const use={asset:'object',variant:'normal',revision:'first',representation:'drawing',roles:['artist']};
  write(local('episode.json'),{id:'pilot',workflows:['workflow.json'],scenes:[
    {id:'room',shots:[{id:'close',uses:[use]},{id:'wide',uses:[use]}]}]});
  write(local('first.txt'),'Thin handle');write(local('second.txt'),'Thick handle');
  write(local('brand.json'),{private:'Show bible'});
  write(local('artist.mjs'),`import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
    import {join} from 'node:path';
    const req=JSON.parse(readFileSync(0,'utf8'));
    if(req.brand!==null || readdirSync(req.seriesRoot).length!==1) throw Error('Invalid intake');
    const shot=JSON.parse(readFileSync(req.inputs.seriesContext)).shots[0];
    const path=join(req.seriesRoot,shot.roles.artist.assets[0].path);
    writeFileSync(req.outputs.image,readFileSync(path));`);
  write(local('edit.mjs'),`import {readFileSync,writeFileSync} from 'node:fs';
    const r=JSON.parse(readFileSync(0,'utf8'));writeFileSync(r.outputs.cut,readFileSync(r.inputs.image));`);
  const op={type:'command',command:[process.execPath,'artist.mjs']};
  const art=id=>({id,seriesContext:{file:'series.json',episode:'pilot',shot:id,role:'artist'},outputs:{image:'frame.txt'},owner:op});
  write(local('workflow.json'),{id:'draw',version:1,stages:[art('wide'),art('close'),{
    id:'cut',needs:['close'],inputs:{image:{stage:'close',output:'image'}},outputs:{cut:'cut.txt'},owner:{type:'command',command:[process.execPath,'edit.mjs']}}]});
  const cli=(action,...args)=>JSON.parse(execFileSync(process.execPath,[join(ROOT,'src/cli.mjs'),'series',action,...args],{cwd:root,encoding:'utf8'}));
  return {root,local,cli,run:(action,options)=>executeWorkflow(action,local('workflow.json'),options)};
}

test('a released cut retains its accepted role view, art and output when one working shot adopts new art', async t=>{
  const {cli,run,local}=fixture(t);
  const run1=await run('run');
  assert.deepEqual(run1.failures,{});
  const original=run1.stages.find(s=>s.id==='close');
  assert.ok(original.acceptedContext);
  assert.ok(!readFileSync(original.acceptedContext,'utf8').includes('Private reveal'));
  const wide=run1.stages.find(s=>s.id==='wide');
  const edition=cli('pin','series.json','--episode','pilot','--workflow','workflow.json','--stage','cut','--dir','release');
  assert.deepEqual(edition.workflow.stages.map(s=>s.id),['close','cut']);
  assert.ok(edition.workflow.stages[0].contexts[0].sha256);
  assert.equal(readFileSync(local('release/delivery/cut.txt'),'utf8'),'Thin handle');
  const change=cli('impact','series.json','--asset','object','--candidate','second','--edition','release');
  assert.deepEqual(change.working.find(s=>s.shot==='wide').consumers.map(c=>c.stage),['wide']);
  assert.deepEqual(change.working.find(s=>s.shot==='close').consumers.map(c=>c.stage),['close','cut']);
  assert.deepEqual(change.editions.map(s=>s.shot),['close']);
  const series=json(local('series.json'));series.board[0].note='Secret revision';write(local('series.json'),series);
  assert.ok((await run('status')).stages.every(s=>s.state==='complete'));
  cli('adopt','series.json','--episode','pilot','--shot','close','--asset','object','--revision','second');
  const state=(await run('status')).stages;
  assert.deepEqual(state.map(s=>s.state),['complete','stale','blocked']);
  assert.equal(json(original.acceptedContext).shots[0].roles.artist.assets[0].revision,'first');
  const next=await run('run');
  assert.deepEqual(next.failures,{});
  assert.equal(next.stages[0].revision,wide.revision);
  assert.equal(readFileSync(next.stages.at(-1).artifacts.cut.path,'utf8'),'Thick handle');
  assert.equal(cli('verify','release','--revision',edition.revision).revision,edition.revision);
  series.defaults[0].value='close-up';write(local('series.json'),series);
  const why=['why','series.json','--episode','pilot','--role','artist','--shot','close','--key','camera'];
  assert.equal(cli(...why).decision.value,'close-up');
  const archived=cli(...why,'--edition','release','--workflow','workflow.json');
  assert.equal(archived.decision.value,'wide');assert.equal(archived.edition,edition.revision);
});

test('a human-supplied frame stays protected after reauthoring its shot',async t=>{
  const {cli,run,local}=fixture(t);
  await run('override',{stage:'wide',role:'image',file:local('first.txt')});
  cli('adopt','series.json','--episode','pilot','--shot','wide','--asset','object','--revision','second');
  const result=await run('run',{stage:'wide'});
  assert.equal(result.stages[0].state,'stale-override');
  assert.equal(readFileSync(result.stages[0].previousArtifacts.image.path,'utf8'),'Thin handle');
});

test('the planner binds private series settings from the operator catalog',async t=>{
  const {local}=fixture(t);
  write(local('brief'),'Sketch the new prop.');
  const binding={file:'series.json',episode:'pilot',shot:'wide',role:'artist'};
  const op={description:'Prepare a frame',owner:{type:'manual'},inputs:[],outputs:{frame:'wide.png'},seriesContext:binding};
  write(local('catalog.json'),{version:1,assets:{},operators:{draw:op}});
  write(local('proposal.json'),{version:1,id:'draw',stages:[{id:'work',purpose:'Art handoff',operator:'draw',bindings:{}}]});
  const args={catalog:local('catalog.json'),proposal:local('proposal.json'),brief:local('brief'),out:local('designed.json')};
  await designWorkflow(args);
  assert.deepEqual(json(args.out).stages[0].seriesContext,binding);
  const proposal=json(args.proposal);
  proposal.stages[0].seriesContext={...binding,role:'writer'};
  write(args.proposal,proposal);
  await assert.rejects(designWorkflow({...args,out:local('other.json')}),/Unknown proposal stage field/);
});
