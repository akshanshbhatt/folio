import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {scriptFor, applyDraft} from '../src/series-script.mjs';

function kitchen() {
  const writer=['writer'], staff=['animator','writer'];
  const series={structure:'comedy',structures:{comedy:{beats:[
    {id:'intro',place:'first',roles:writer,fields:{line:{state:'open'}}},
    {id:'button',place:'last',roles:staff,source:'Guide',fields:{
      action:{state:'open',value:'Wait for a look.'}, dialogue:{state:'open'},
      expression:{state:'fixed',roles:['animator'],value:'Small eye twitch.'}
    }}
  ]}}};
  const scene={id:'door',shots:[{id:'in'},{id:'pause'},{id:'out'}]};
  const episode={id:'one',scenes:[scene],beats:[
    {id:'intro',state:'omitted'},
    {id:'button',shot:'pause',source:'Creator board',fields:{
      dialogue:{state:'fixed',value:null}, music:{state:'omitted'},
      timing:{state:'fixed',value:{frames:192,fps:24}}, edit:{state:'open'}
    }},
    {id:'credit',shot:'out',roles:writer,fields:{name:{state:'fixed',value:'Actor'}}}
  ]};
  const run = (id,role) => scriptFor(series,episode,scene,scene.shots.find(s=>s.id === id),role);
  const report = () => ({version:1,series:'kitchen',episode:'one',shots:scene.shots.map(shot=>({
    id:shot.id,scene:scene.id,roles:{
      writer:{script:run(shot.id,'writer')},animator:{script:run(shot.id,'animator'),privateNotes:'Embargoed pose guide'}
    }
  }))});
  return {series,episode,run,report};
}
const edit = (field,value) => ({shot:'pause',beat:'button',field,value});

test('structures give a default opening and ending and episodes may move, omit or disable them', () => {
  const {episode,run} = kitchen();
  assert.deepEqual(run('in','writer'),[{id:'intro',state:'omitted',fields:{}}]);
  const [button]=run('pause','writer');
  assert.equal(button.fields.action.scope,'structure');
  assert.equal(button.fields.action.source,'Guide');
  assert.equal(button.fields.dialogue.scope,'episode');
  assert.equal(button.fields.dialogue.value,null);
  assert.deepEqual(button.fields.timing.value,{frames:192,fps:24});
  assert.equal(button.fields.expression,undefined);
  assert.equal(run('pause','animator')[0].fields.expression.value,'Small eye twitch.');
  assert.deepEqual(run('in','mixer'),[]);
  assert.deepEqual(run('out','writer').map(b=>b.id),['credit']);
  episode.beats=[];
  assert.equal(run('in','writer')[0].id,'intro');
  assert.equal(run('out','writer')[0].id,'button');
  episode.structure=null;
  assert.deepEqual(run('out','writer'),[]);
});

test('an episode can narrow recipients without disclosing a replaced or hidden field', () => {
  const {series,episode,run} = kitchen();
  episode.beats[1].fields.action={state:'fixed',roles:['animator'],value:'Private facial study'};
  assert.equal(run('pause','writer')[0].fields.action,undefined);
  assert.equal(run('pause','animator')[0].fields.action.value,'Private facial study');
  series.structures.comedy.beats[1].roles=['writer'];
  episode.beats[1].roles=['animator'];
  assert.deepEqual(run('pause','writer'),[]);
  assert.doesNotMatch(JSON.stringify(run('pause','animator')),/eye twitch|Guide/);
});

test('draft patches preserve exact locked fields, scope handoffs and leave inputs unmodified', () => {
  const {report}=kitchen(), input=report(), original=structuredClone(input);
  const draft = {edits:[edit('edit',{in:229,out:421}),edit('action','Hold under the close-up.')]};
  const filled = applyDraft(input,draft,'writer');
  assert.equal(filled.shots[1].roles.writer.script[0].fields.action.value,'Hold under the close-up.');
  draft.edits[0].value.in=100;
  assert.deepEqual(filled.shots[1].roles.writer.script[0].fields.edit.value,{in:229,out:421});
  assert.equal(filled.shots[1].roles.writer.script[0].fields.dialogue.value,null);
  assert.doesNotMatch(JSON.stringify(filled),/Embargoed|eye twitch/);
  assert.deepEqual(input,original);
  for (const field of ['dialogue','timing','music','expression','new-field']) {
    assert.throws(()=>applyDraft(input,{edits:[edit('edit','earlier change'),edit(field,'x')]},'writer'),/unavailable for drafting/);
    assert.deepEqual(input,original);
  }
  assert.throws(()=>applyDraft(input,{edits:[{shot:'in',beat:'intro',field:'line',value:'fake hook'}]},'writer'),/unavailable/);
  assert.throws(()=>applyDraft(input,{edits:[edit('edit',1),edit('edit',2)]},'writer'),/Duplicate script edit/);
  assert.throws(()=>applyDraft(input,{edits:[{...edit('edit',1),state:'fixed'}]},'writer'),/Draft edits need/);
  assert.throws(()=>applyDraft(input,{edits:[]},'mixer'),/No script handoff/);
});

test('duplicate IDs, unknown shots and broken ownership fail before dispatch', () => {
  const {episode,run} = kitchen();
  episode.beats[1].shot='elsewhere';
  assert.throws(()=>run('out','writer'),/Unknown script beat shot/);
  episode.beats[1].shot='pause';
  episode.beats[1].fields.dialogue={state:'fixed'};
  assert.throws(()=>run('pause','writer'),/needs a value/);
  episode.beats[1].fields.dialogue={state:'omitted',value:'retained private line'};
  assert.throws(()=>run('pause','writer'),/cannot carry a value/);
  episode.beats.push(episode.beats[0]);
  assert.throws(()=>run('out','writer'),/duplicate ID/);
});

test('workflow adapter reads job files on stdin and writes only after all edits pass', t => {
  const {report}=kitchen(), scoped=applyDraft(report(),{edits:[]},'writer');
  const dir=mkdtempSync(join(tmpdir(),'folio-script-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const seriesContext=join(dir,'ctx.json'),draft=join(dir,'draft.json'),script=join(dir,'script.json');
  writeFileSync(seriesContext,JSON.stringify(scoped));
  const adapter=fileURLToPath(new URL('../tools/workflow/script.mjs',import.meta.url));
  const run=()=>spawnSync(process.execPath,[adapter],{input:JSON.stringify({inputs:{seriesContext,draft},outputs:{script}}),encoding:'utf8'});
  writeFileSync(draft,JSON.stringify({edits:[edit('edit','J-cut to room tone')]}));
  assert.equal(run().status,0);
  const accepted=readFileSync(script,'utf8');
  assert.match(accepted,/J-cut to room tone/);
  assert.equal(JSON.parse(accepted).shots[1].beats[0].fields.edit.drafted,true);
  writeFileSync(draft,JSON.stringify({edits:[edit('timing',1)]}));
  assert.notEqual(run().status,0);
  assert.equal(readFileSync(script,'utf8'),accepted);
});
