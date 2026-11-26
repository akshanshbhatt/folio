import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, linkSync, writeFileSync, existsSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {digest} from '../src/common.mjs';
import {pinEdition, resolveAssets, verifyEdition} from '../src/series-assets.mjs';

function project(t) {
  const base = mkdtempSync(join(tmpdir(), 'folio-series-assets-')), root = join(base, 'kitchen');
  mkdirSync(join(root, 'prop'), {recursive:true});
  mkdirSync(join(root, 'casting'));
  t.after(() => rmSync(base, {recursive:true, force:true}));
  const put = (path, value) => writeFileSync(join(root,path),value);
  put('prop/mug.mesh', 'chipped handle; neutral pivot');
  put('prop/paint.png', 'approved paint');
  put('prop/still.png','chipped profile');
  put('casting/reference.txt','private actor reference');
  put('title.png','finished public work');
  const rig = {file:'prop/mug.mesh', controls:['handle.turn'], roles:['animator'],
    rights:'Original test art', credit:'Test artist', redistribute:true,
    dependencies:[{file:'prop/paint.png', rights:'Original paint', redistribute:true}, 'casting/reference.txt']};
  const repairedRig = {...rig, file:'prop/fixed.mesh'};
  put(repairedRig.file,'repaired handle');
  const chipped = {defaultRevision:'r1', revisions:{r1:{representations:{rig,still:{file:'prop/still.png'}}}}};
  const series = {id:'test-series', assets:{mug:{variants:{chipped, repaired:{revisions:{r1:{representations:{rig:repairedRig}}}}}}}};
  const use = {asset:'mug', variantFrom:'mug-state', revision:'r1', representation:'rig',
    roles:['animator'], requires:['handle.turn']};
  const shot = {id:'doorway',uses:[use]};
  const context = {facts:[{fact:'mug-state',value:'chipped'}], decisions:{private:'casting rehearsal'}};
  function report() {
    const assets = resolveAssets(root,series,shot,context,'animator');
    return {series:series.id,episode:'episode-three',shots:[{id:shot.id,roles:{animator:{...context,assets}}}]};
  }
  return {base,root,put,series,rig,use,shot,context,report};
}

test('the visible story fact chooses the physical variant and a declared revision and rig control', t => {
  const {root,series,use,shot,context} = project(t);
  const select = () => resolveAssets(root,series,shot,context,'animator')[0];
  const first = select();
  assert.equal(first.variant,'chipped');
  assert.equal(first.path,'prop/mug.mesh');
  assert.equal(first.sha256, createHash('sha256').update(readFileSync(join(root,first.path))).digest('hex'));
  assert.deepEqual(first.dependencies.map(x=>x.redistribute),[true,false]);
  assert.deepEqual(resolveAssets(root,series,shot,context,'writer'),[]);
  delete use.revision;
  assert.equal(select().revision,'r1');
  context.facts[0].value = 'repaired';
  assert.throws(select,/Unknown revision/);
  use.revision = 'r1';
  assert.equal(select().path,'prop/fixed.mesh');
  context.facts[0].value = 'chipped';
  use.representation = 'still';
  assert.throws(select,/Missing control "handle.turn"/);
  delete use.requires;
  assert.equal(select().path,'prop/still.png');
  delete context.facts[0].value;
  assert.throws(select,/Unknown variant/);
  context.facts.length = 0;
  assert.throws(select,/one applicable story fact/);
  use.variant = 'chipped';
  assert.throws(select,/exactly one/);
  delete use.variantFrom;
  assert.equal(select().variant,'chipped');
});

test('asset and dependency role grants, project boundaries and sharing statements are checked', t => {
  const {base,root,series,rig,shot,context} = project(t);
  const select = () => resolveAssets(root,series,shot,context,'animator');
  series.assets.mug.roles=['writer'];
  assert.throws(select,/unavailable to role/);
  delete series.assets.mug.roles;
  rig.dependencies[0].roles=['sound'];
  assert.throws(select,/unavailable to role/);
  delete rig.dependencies[0].roles;
  rig.dependencies[0].file='../external.dat';
  assert.throws(select,/relative path/);
  writeFileSync(join(base,'external.dat'),'outside');
  symlinkSync(join(base,'external.dat'),join(root,'link'));
  rig.dependencies[0].file='link';
  assert.throws(select,/outside/);
  rig.dependencies=[];
  delete rig.rights;
  assert.throws(select,/rights statement/);
  rig.redistribute=false;
  assert.equal(select()[0].redistribute,false);
  assert.throws(()=>resolveAssets(root,series,{uses:[{asset:'mug'}]},context,'animator'),/explicit roles/);
});

test('a registered file stamp detects source or dependency replacement', t => {
  const {root,series,rig,shot,context,put} = project(t);
  const select = () => resolveAssets(root,series,shot,context,'animator')[0];
  const original = select();
  rig.sha256 = original.sha256; rig.bytes = original.bytes;
  rig.dependencies[0].sha256 = original.dependencies[0].sha256;
  assert.equal(select().sha256,original.sha256);
  rig.bytes++;
  assert.throws(select,/byte count differs/);
  rig.bytes--;
  put(rig.dependencies[0].file, 'replacement texture');
  assert.throws(select,/SHA-256 differs/);
});

test('pinned editions keep selected bytes and native asset layout and omit private paths and notes', t => {
  const {root,base,report,put} = project(t);
  const dir = join(base,'deliveries','accepted');
  const manifest = pinEdition(dir,report(),{cover:join(root,'title.png')},root);
  assert.deepEqual(verifyEdition(dir,manifest.revision),manifest);
  assert.equal(manifest.files.cover.path,'delivery/cover.png');
  const [asset] = manifest.shots[0].roles.animator.assets;
  assert.equal(asset.path,'sources/prop/mug.mesh');
  assert.equal(asset.credit,'Test artist');
  assert.equal(readFileSync(join(dir,asset.path),'utf8'),'chipped handle; neutral pivot');
  assert.equal(asset.dependencies[0].path,'sources/prop/paint.png');
  assert.equal(asset.dependencies[1].path,undefined);
  assert.equal(existsSync(join(dir,'sources/casting')),false);
  assert.doesNotMatch(readFileSync(join(dir,'edition.json'),'utf8'),/casting|reference.txt/);
  assert.equal(manifest.shots[0].roles.animator.contextSha256,digest(report().shots[0].roles.animator));
  put('title.png','subsequent edition'); put('prop/mug.mesh','new handle design');
  assert.throws(()=>pinEdition(dir,report(),{},root),/new edition directory/);
  assert.equal(verifyEdition(dir).revision,manifest.revision);
  writeFileSync(join(dir,asset.dependencies[0].path),'changed paint');
  assert.throws(()=>verifyEdition(dir),/Edition file changed/);
});

test('a stale report, extra file, symlink or altered manifest cannot produce a verified edition', t => {
  const {base,root,put,report} = project(t);
  const snapshot = report(), dir=join(base,'accepted');
  put('casting/reference.txt','new take');
  assert.throws(()=>pinEdition(dir,snapshot,{},root),/Source changed/);
  assert.equal(existsSync(dir),false);
  assert.ok(readdirSync(base).every(name=>!name.startsWith('.folio-edition-')));
  const pinned = pinEdition(dir,report(),{},root);
  assert.throws(()=>verifyEdition(dir,'wrong-revision'),/revision mismatch/);
  writeFileSync(join(dir,'extra.dat'),'undeclared');
  assert.throws(()=>verifyEdition(dir),/Unexpected files/);
  rmSync(join(dir,'extra.dat'));
  symlinkSync(join(root,'title.png'),join(dir,'extra'));
  assert.throws(()=>verifyEdition(dir),/symbolic/);
  rmSync(join(dir,'extra'));
  writeFileSync(join(dir,'edition.json'),JSON.stringify({...pinned,episode:'changed'}));
  assert.throws(()=>verifyEdition(dir),/revision mismatch/);
});

test('an asset which may only be relinked carries no filenames or attribution text into the archive', t => {
  const {base,root,rig,report} = project(t);
  rig.redistribute = false; rig.source='private reference URL';
  const pinned=pinEdition(join(base,'edition'),report(),{},root);
  const [asset] = pinned.shots[0].roles.animator.assets;
  assert.equal(asset.path,undefined);
  assert.ok(asset.dependencies.every(d=>!d.path));
  assert.deepEqual(readdirSync(join(base,'edition')),['edition.json']);
  assert.doesNotMatch(JSON.stringify(pinned),/mesh|\.png|private reference URL/);
});

test('conflicting permission for the same source fails the pin even under a file alias', t => {
  const {base,root,report} = project(t), r = report();
  const asset = r.shots[0].roles.animator.assets[0];
  for (const [alias, link] of [['symbolic-reference',symlinkSync],['hard-reference',linkSync]]) {
    link(join(root,asset.dependencies[1].path),join(root,alias));
    const sharedCopy = {...asset.dependencies[1],path:alias,rights:'Shared art',redistribute:true};
    asset.dependencies.push(sharedCopy);
    assert.throws(()=>pinEdition(join(base,'cut'),r,{},root),/Conflicting redistribution/);
    assert.equal(existsSync(join(base,'cut')),false);
    asset.dependencies.pop();
  }
});

test('an edition retains the exact workflow revision, scene and mixed-case artifact role', t => {
  const {base, root, report} = project(t);
  const r = report(), revision='test-revision';
  r.shots[0].scene='kitchen-flashback';
  r.workflow={id:'cut',stage:'edition',revision,privateNotes:'private deliberations',
    stages:[{id:'edition',revision,fingerprint:digest('inputs'),toolLog:'private material'}]};
  const pinned=pinEdition(join(base,'cut'),r,{coverImage:join(root,'title.png')},root);
  assert.equal(pinned.shots[0].scene,'kitchen-flashback');
  assert.equal(pinned.workflow.revision,revision);
  assert.equal(pinned.workflow.stages[0].fingerprint,digest('inputs'));
  assert.equal(pinned.files.coverImage.path,'delivery/coverImage.png');
  assert.doesNotMatch(JSON.stringify(pinned),/private deliberations|toolLog/);
});

test('a pinned HTML delivery preserves links to companion files and excludes paths outside the export', t => {
  const {base,root,report} = project(t);
  const exported = join(base,'export'), dir = join(base,'edition');
  mkdirSync(join(exported,'media'),{recursive:true});
  const files = {player:join(exported,'index.html'),audio:join(exported,'media','sound.wav')};
  writeFileSync(files.player,'<audio src="media/sound.wav"></audio>');
  writeFileSync(files.audio,'accepted sound');
  const pinned = pinEdition(dir,report(),files,root,exported);
  const {player,audio} = verifyEdition(dir,pinned.revision).files;
  assert.equal(player.path,'delivery/index.html');
  assert.equal(audio.path,'delivery/media/sound.wav');
  const index = join(dir,player.path), link = readFileSync(index,'utf8').match(/src="([^"]+)"/)[1];
  assert.equal(readFileSync(join(dirname(index),link),'utf8'),'accepted sound');
  const other = join(base,'bad-edition'), privateFile = join(root,'casting','reference.txt');
  assert.throws(()=>pinEdition(other,report(),{leak:privateFile},root,exported),/relative path/);
  const alias = join(exported,'unrelated.wav');
  symlinkSync(privateFile,alias);
  assert.throws(()=>pinEdition(other,report(),{leak:alias},root,exported),/outside/);
  assert.equal(existsSync(other),false);
});
