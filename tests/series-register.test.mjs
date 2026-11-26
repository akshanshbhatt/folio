import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerAsset} from '../src/series-register.mjs';
import {resolveAssets} from '../src/series-assets.mjs';

const write = (file,data) => writeFileSync(file,JSON.stringify(data));
const read = file => JSON.parse(readFileSync(file,'utf8'));
function setup(t) {
  const root=mkdtempSync(join(tmpdir(),'folio-register-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const file=join(root,'series.json');
  write(file,{version:1,id:'studio',episodes:[]});
  writeFileSync(join(root,'rig.txt'),'pivot=8'); writeFileSync(join(root,'palette.txt'),'blue ink');
  const record={version:1,asset:'door',variant:'open',revision:'r1',representation:'rig',file:'rig.txt',
    roles:['animator'],source:'Rigged by the studio artist',rights:'Studio owned',redistribute:true,controls:['pivot'],
    dependencies:[{file:'palette.txt',source:'Artist palette',redistribute:false}]};
  let n=0;
  function register(doc=record) {
    const path=join(root,'intake-'+(++n)+'.json');write(path,doc);return registerAsset(file,{record:path});
  }
  return {root,file,record,register};
}
test('creator intake registers a complete resolvable source with pinned dependencies and roles',async t=>{
  const f=setup(t), result=await f.register(), series=read(f.file);
  const use={asset:'door',variant:'open',representation:'rig',roles:['animator','editor'],requires:['pivot']};
  const [asset]=resolveAssets(f.root,series,{uses:[use]},{},'animator');
  assert.equal(asset.revision,'r1'); assert.equal(asset.sha256,result.source.sha256);
  assert.equal(asset.credit,undefined); assert.equal(asset.source,f.record.source);
  assert.equal(asset.dependencies[0].sha256,result.dependencies[0].sha256);
  assert.throws(()=>resolveAssets(f.root,series,{uses:[use]},{},'editor'),/unavailable/);
  const declared=series.assets.door.variants.open.revisions.r1.representations.rig;
  assert.equal(declared.sha256,asset.sha256); assert.equal(declared.bytes,7);
  writeFileSync(join(f.root,'palette.txt'),'red ochre');
  assert.throws(()=>resolveAssets(f.root,series,{uses:[use]},{},'animator'),/hash|changed|match|SHA|byte/i);
});
test('adding variants, revisions and representations leaves previous choices intact',async t=>{
  const f=setup(t); await f.register();
  const original=read(f.file).assets.door.variants.open.revisions.r1.representations.rig;
  const results=await Promise.all([
    f.register({...f.record,revision:'r2'}),f.register({...f.record,representation:'pose'}),
    f.register({...f.record,variant:'closed',revision:'r3'})]);
  assert.equal(results[0].defaultRevision,'r1');
  const states=read(f.file).assets.door.variants;
  assert.equal(states.closed.defaultRevision,'r3'); assert.equal(states.open.defaultRevision,'r1');
  assert.deepEqual(states.open.revisions.r1.representations.rig,original);
  assert.ok(states.open.revisions.r1.representations.pose); assert.ok(states.open.revisions.r2);
  await assert.rejects(f.register(),/already registered/);
});
test('unusable or unauthorized files preserve the old manifest',async t=>{
  const f=setup(t), before=readFileSync(f.file);
  const outside=mkdtempSync(join(tmpdir(),'folio-elsewhere-')); t.after(()=>rmSync(outside,{recursive:true,force:true}));
  writeFileSync(join(outside,'image'),'outside'); symlinkSync(join(outside,'image'),join(f.root,'escape'));
  for(const [override,message] of [
    [{file:'escape'},/outside/],[{file:'../else'},/relative path/],[{file:'.'},/relative path/],
    [{rights:undefined},/rights/],[{roles:[]},/roles/],[{controls:['pivot','pivot']},/duplicate/],
    [{dependencies:[{file:'palette.txt',source:'Palette',roles:['mixer']}]},/unavailable/],
    [{dependencies:[{file:'rig.txt',source:'Duplicate'}]},/duplicate/],[{source:''},/source/],
    [{file:'series.json'},/own asset/],[{file:'missing.xyz'},/ENOENT/],[{redistributable:true},/Unknown/],
  ]) await assert.rejects(f.register({...f.record,...override}),message);
  assert.deepEqual(readFileSync(f.file),before);
});
