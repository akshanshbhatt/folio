import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startSeries} from '../src/series-init.mjs';
import {inspectSeries,openSeries} from '../src/series.mjs';

const read = file => JSON.parse(readFileSync(file));
function setup(t) {
  const root=mkdtempSync(join(tmpdir(),'folio-new-series-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const file=join(root,'series.json');
  return {root,file,init:(args={})=>startSeries('init',file,{id:'house',...args}),
    add:(id,args={})=>startSeries('new-episode',file,{id,...args})};
}
test('init creates an empty local guide exclusively and starting an episode inherits creator defaults',async t=>{
  const f=setup(t), guide=await f.init();
  assert.equal(guide.role,'creator');
  assert.equal(openSeries(f.file).episodes.size,0);
  const series=read(f.file);
  await assert.rejects(f.init({role:'other'}),/EEXIST/);assert.deepEqual(read(f.file),series);
  series.channel.defaults=[{key:'lens',value:35,source:'Camera test',roles:['creator']}];
  writeFileSync(f.file,JSON.stringify(series));
  const result=await f.add('arrival',{season:'one'});
  assert.equal(result.mode,'created');assert.equal(result.file,'arrival.json');
  assert.deepEqual(read(join(f.root,result.file)).defaults,[]);
  assert.equal(inspectSeries(f.file,{episode:'arrival',role:'creator'}).shots[0].roles.creator.decisions.lens.value,35);
  assert.ok(read(f.file).seasons.one);
});
test('preauthored episodes keep exact bytes and local sources. Conflicting or incomplete documents survive',async t=>{
  const f=setup(t);await f.init({role:'writer'});
  const target=join(f.root,'notes.json');
  const bytes='{"id":"pilot","season":"autumn","notes":"artist material","scenes":[]}\n';
  writeFileSync(target,bytes);
  await assert.rejects(f.add('different',{file:'notes.json'}),/match/);
  await assert.rejects(f.add('pilot',{file:target,season:'summer'}),/differs/);
  assert.deepEqual(read(f.file).episodes,[]);
  const result=await f.add('pilot',{file:target}); assert.equal(result.mode,'registered');
  assert.equal(readFileSync(target,'utf8'),bytes); assert.ok(read(f.file).seasons.autumn);
  await assert.rejects(f.add('pilot'),/already registered/);
});
test('parallel creates preserve both episodes and a duplicate has one winner',async t=>{
  const f=setup(t);await f.init();
  await Promise.all([f.add('a',{file:'episodes/a.json'}),f.add('b',{file:'episodes/b.json'})]);
  const results=await Promise.allSettled([f.add('c'),f.add('c')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.deepEqual(new Set(read(f.file).episodes),new Set(['episodes/a.json','episodes/b.json','c.json']));
});
test('outside paths and broken contexts never become registered shots',async t=>{
  const f=setup(t);await f.init();
  const outside=mkdtempSync(join(tmpdir(),'folio-start-outside-'));
  t.after(()=>rmSync(outside,{recursive:true,force:true}));symlinkSync(outside,join(f.root,'external'));
  await assert.rejects(f.add('bad',{file:'external/new/document.json'}),/outside/);
  assert.equal(existsSync(join(outside,'new')),false);
  await assert.rejects(f.add('bad',{file:'../bad.json'}),/relative path/);
  const doc=read(f.file), choice={key:'camera',roles:['creator'],value:'wide',source:'board'};
  doc.defaults=[choice,choice];writeFileSync(f.file,JSON.stringify(doc));
  await assert.rejects(f.add('bad'),/Conflicting/);
  assert.equal(existsSync(join(f.root,'bad.json')),false);assert.deepEqual(read(f.file).episodes,[]);
});
