import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {suggestionCli} from '../src/series-suggestions.mjs';
import {resolveContext} from '../src/series-context.mjs';

const write = (file,value) => writeFileSync(file,JSON.stringify(value));
const read = file => JSON.parse(readFileSync(file,'utf8'));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(),'folio-preferences-'));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  const series = join(root,'series.json'), episode = join(root,'episode.json');
  const evidence = join(root,'labels.json'), proposal = join(root,'proposal.json');
  write(series,{version:1,id:'play',roles:['camera','script'],episodes:['episode.json'],seasons:{winter:{}}});
  write(episode,{id:'street',season:'winter',scenes:[{id:'morning',shots:['enter','walk','leave'].map(id => ({id}))}]});
  const rows = ['wide','wide','handheld'].map((value,i) => ({value,role:'camera',episode:'street',
    shot:['enter','walk','leave'][i],key:'framing',source:'cut.txt',locator:'frame '+i,note:'PRIVATE-ANNOTATION'}));
  writeFileSync(join(root,'cut.txt'),'PRIVATE-SOURCE-BYTES');
  rows.push({role:'script',key:'framing',note:'HIDDEN ROLE',source:'forbidden'});
  write(evidence,{version:1,observations:rows});
  const suggest = async (extra={}) => {
    const result = await suggestionCli('suggest',series,{evidence,key:'framing',role:'camera',...extra});
    write(proposal,result); return result;
  };
  const promote = (extra={}) => suggestionCli('promote',series,{proposal,scope:'scene',episode:'street',scene:'morning',...extra});
  return {root,series,episode,evidence,proposal,suggest,promote,rows};
}

test('opt-in suggestions show support and counterexamples without mutating production',async t => {
  const f=fixture(t), before=read(f.series), proposal=await f.suggest();
  assert.deepEqual(read(f.series),before);
  assert.equal(proposal.value,'wide');
  assert.equal(proposal.support.length,2);
  assert.equal(proposal.counterexamples[0].value,'handheld');
  assert.match(proposal.support[0].sha256,/^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(proposal),/PRIVATE|HIDDEN|forbidden/);
  const result=await f.promote(); assert.equal(result.shotsChecked,3);
  const ctx=resolveContext(read(f.series),read(f.episode),'walk','camera');
  assert.equal(ctx.decisions.framing.revision,proposal.id);
  assert.equal(ctx.decisions.framing.scope,'scene');
  assert.equal(resolveContext(read(f.series),read(f.episode),'walk','script').decisions.framing,undefined);
  assert.doesNotMatch(JSON.stringify(ctx),/labels.json|cut.txt|frame 2|handheld/);
});

test('mixed labels require an editorial choice when equally frequent; writer sees selected summaries',async t => {
  const f=fixture(t);
  write(f.evidence,{version:1,observations:[f.rows[0],f.rows[2],f.rows[3]]});
  await assert.rejects(f.suggest(),/single most frequent/);
  writeFileSync(join(f.root,'choose.mjs'),`import {readFileSync,writeFileSync} from 'node:fs';
    const job=JSON.parse(readFileSync(0,'utf8'));
    writeFileSync('request.json',JSON.stringify(job));
    console.log(JSON.stringify({choice:1,reason:'Use foreground motion for this production.'}));`);
  const writer=join(f.root,'writer.json');
  write(writer,{command:[process.execPath,'choose.mjs'],model:'local-test'});
  const proposal=await f.suggest({writer});
  assert.equal(proposal.value,'handheld'); assert.equal(proposal.model,'local-test');
  const payload=read(join(f.root,'request.json'));
  assert.equal(payload.material.observations.length,2);
  assert.doesNotMatch(JSON.stringify(payload),/PRIVATE|HIDDEN|forbidden|cut.txt|frame 2/);
  write(writer,{command:[process.execPath,'-e','console.log(JSON.stringify({choice:99,reason:"guess"}))']});
  await assert.rejects(f.suggest({writer}),/observed value/);
});

test('duplicate examples, rewritten proposals, changed evidence or stale destinations cannot promote',async t => {
  const f=fixture(t), original=await f.suggest();
  write(f.proposal,{...original,value:'invented'}); await assert.rejects(f.promote(),/review receipt/);
  write(f.proposal,original); writeFileSync(join(f.root,'cut.txt'),'new cut'); await assert.rejects(f.promote(),/evidence changed/);
  await f.suggest(); const episode=read(f.episode); episode.defaults=[]; write(f.episode,episode);
  await assert.rejects(f.promote(),/Episode changed/);
  write(f.evidence,{version:1,observations:[f.rows[0],f.rows[0]]}); await assert.rejects(f.suggest(),/Duplicate/);
  assert.equal(read(f.episode).scenes[0].defaults,undefined);
});

test('locks, occupied destinations and incorrect selectors preserve manual decisions',async t => {
  const f=fixture(t), series=read(f.series);
  series.defaults=[{key:'framing',roles:['camera'],value:'fixed',source:'manual',locked:true}];
  write(f.series,series); await f.suggest();
  await assert.rejects(f.promote(),/Locked/);
  await assert.rejects(suggestionCli('promote',f.series,{proposal:f.proposal,scope:'series'}),/already declares/);
  await assert.rejects(f.promote({shot:'walk'}),/Unexpected --shot/);
  assert.equal(read(f.episode).scenes[0].defaults,undefined);
});

test('concurrent choices cannot overwrite the same draft',async t => {
  const f=fixture(t); await f.suggest();
  const results=await Promise.allSettled([f.promote(),f.promote()]);
  assert.equal(results.filter(r => r.status==='fulfilled').length,1);
  assert.equal(read(f.episode).scenes[0].defaults.length,1);
});
