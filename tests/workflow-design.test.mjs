import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync,existsSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ROOT,json,write} from '../src/common.mjs';
import {designWorkflow} from '../src/workflow-design.mjs';

function fixture(t) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'folio-design-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  cpSync(join(ROOT,'examples/workflow-design'),root,{recursive:true});
  const args={brief:join(root,'brief.md'),catalog:join(root,'catalog.json'),proposal:join(root,'proposal.json'),out:join(root,'workflow.json')};
  return {root,args,plan:json(args.proposal),catalog:json(args.catalog)};
}

test('the documented CLI designs the human proposal and leaves the independent art and voice handoffs unexecuted',t=>{
  const {args,root}=fixture(t);
  const cli=(...argv)=>spawnSync(process.execPath,[join(ROOT,'src/cli.mjs'),'workflow',...argv],{encoding:'utf8'});
  const before=readdirSync(root).sort();
  const {stdout,status,stderr}=cli('design',...Object.entries(args).flatMap(([key,value])=>['--'+key,value]));
  assert.equal(status,0,stderr);assert.equal(JSON.parse(stdout).manifest,args.out);
  assert.deepEqual(readdirSync(root).sort(),[...before,'workflow.json'].sort());
  const report=cli('plan',args.out);
  assert.equal(report.status,0,report.stderr);
  const [art,voice,review]=JSON.parse(report.stdout).stages;
  assert.deepEqual([art.state,voice.state,review.state],['awaiting-input','awaiting-input','blocked']);
  assert.deepEqual([art.needs,voice.needs,review.needs],[[],[],[art.id,voice.id]]);
  assert.equal(existsSync(join(root,'.folio')),false);
  const stored=json(args.out);
  assert.equal(stored.brand,null);assert.equal(stored.stages[0].responsibility,'Illustrator');
  assert.equal(stored.stages[2].approval,true);
});

test('a real writer sees interfaces only, and compilation binds runtime/model/files exclusively from the catalog',async t=>{
  const {args,root,catalog,plan}=fixture(t);
  const marker=join(root,'stage-ran');
  const op=catalog.operators.illustrator;
  op.owner={type:'agent',command:[process.execPath,'-e',`require('node:fs').writeFileSync(${JSON.stringify(marker)},"ran")`],
    model:'art-runtime-model-v2',settings:{palette:'amber'}};
  op.fixedInputs={implementation:'adapter-source'};op.useBrand=false;
  catalog.assets['adapter-source']='private-stage-implementation.mjs';write(join(root,catalog.assets['adapter-source']),'/* adapter */');
  catalog.assets['identity']='visual-brand.json';write(join(root,'visual-brand.json'),{name:'Studio'});catalog.brand='identity';
  write(args.catalog,catalog);
  const config=join(root,'writer.json'),log=join(root,'request.json');
  write(join(root,'writer.mjs'),`import{readFileSync,writeFileSync}from'node:fs';const r=JSON.parse(readFileSync(0,'utf8'));
    writeFileSync('request.json',JSON.stringify(r));process.stdout.write(${JSON.stringify(JSON.stringify(plan))});`);
  write(config,{command:[process.execPath,'writer.mjs'],model:'planning-model'});
  const {proposal,...other}=args;
  await designWorkflow({...other,writer:config});
  const req=json(log),result=json(args.out);assert.match(req.brief,/muted microphone/);
  assert.equal(req.model,'planning-model');assert.deepEqual(req.operators[0].outputs,['board']);
  const wire=readFileSync(log,'utf8');for(const protectedValue of [marker,'private-stage-implementation.mjs','art-runtime-model-v2','amber'])
    assert.ok(!wire.includes(protectedValue),protectedValue+' leaked into writer input');
  assert.deepEqual(result.stages[0].owner,op.owner);
  assert.deepEqual(result.stages[0].inputs,{implementation:'private-stage-implementation.mjs',subject:'brief.md'});
  assert.equal(result.stages[0].useBrand,false);assert.equal(result.brand,'visual-brand.json');
  assert.ok(!existsSync(marker));assert.ok(!existsSync(join(root,'.folio')));
  writeFileSync(log,'keep');const prior=readFileSync(args.out);
  await assert.rejects(designWorkflow({...other,writer:config}),/new workflow manifest/);
  assert.equal(readFileSync(log,'utf8'),'keep');assert.deepEqual(readFileSync(args.out),prior);
});

test('unknown bindings, runtime overrides, dependency errors, duplicate JSON keys and escaping catalog paths cannot publish a manifest',async t=>{
  const {args,root,plan,catalog}=fixture(t);
  const invalid=async (change,pattern)=>{
    const copy=structuredClone(plan);change(copy,copy.stages[0]);write(args.proposal,copy);
    await assert.rejects(designWorkflow(args),pattern);
    assert.ok(!existsSync(args.out));assert.ok(!readdirSync(root).some(p=>p.startsWith('.folio-design')));
  };
  for(const [key,value] of Object.entries({owner:{type:'agent'},model:'invented',settings:{},command:['node'],outputs:{board:'/tmp/else'}}))
    await invalid((p,s)=>s[key]=value,/Unknown proposal stage field/);
  await invalid((p,s)=>s.operator='rogue',/Unknown operator/);
  await invalid((p,s)=>s.bindings.subject={asset:'/private/notes'},/Unknown asset/);
  await invalid((p,s)=>s.bindings.subject='notes.md',/Binding must name/);
  await invalid((p,s)=>s.bindings={subject:{asset:'project-brief'},extra:{asset:'project-brief'}},/input bindings/);
  await invalid((p,s)=>s.bindings.subject={asset:'project-brief',path:'other'},/Unknown asset binding/);
  await invalid(p=>p.stages[2].bindings.picture.output='absent',/Unknown output/);
  await invalid((p,s)=>s.needs=['compare-at-desk'],/cycle/);
  await invalid((p,s)=>s.needs=['nonexistent'],/Unknown dependency/);
  await invalid((p,s)=>s.needs=['record-the-desk','record-the-desk'],/duplicate needs/);
  await invalid(p=>p.stages[1].id=p.stages[0].id,/duplicate stage/);
  writeFileSync(args.proposal,'{"id":"first","\\u0069d":"second"}');
  await assert.rejects(designWorkflow(args),/Duplicate key/);
  write(args.proposal,plan);catalog.assets['project-brief']='../elsewhere';write(args.catalog,catalog);
  await assert.rejects(designWorkflow(args),/relative local path/);
  const outside=mkdtempSync(join(tmpdir(),'folio-external-'));t.after(()=>rmSync(outside,{recursive:true,force:true}));
  write(join(outside,'secret.txt'),'outside');symlinkSync(join(outside,'secret.txt'),join(root,'alias'));
  catalog.assets['project-brief']='alias';write(args.catalog,catalog);
  await assert.rejects(designWorkflow(args),/inside the workflow project/);
  assert.ok(!existsSync(args.out));
});

test('concurrent designers publish one complete manifest without overwriting an existing destination',async t=>{
  const {args}=fixture(t);
  const results=await Promise.allSettled([designWorkflow(args),designWorkflow(args)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(results.find(r=>r.status==='rejected').reason.message,/new workflow manifest/);
  assert.equal(json(args.out).stages.length,3);
});
