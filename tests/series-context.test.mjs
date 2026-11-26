import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveContext} from '../src/series-context.mjs';

const choice = (key,value,roles,source,extra) => ({key,value,roles,source,...extra});

function fixture() {
  const series = {
    id:'kit-and-rue',version:1,
    channel:{id:'studio',defaults:[choice('caption.font','house-face',['editor'],'Channel type sheet')]},
    defaults:[
      choice('camera','wide',['animator'],'Kitchen plan'),
      choice('tone','awkward understatement',['writer'],'Show bible'),
      choice('pay','private contract',['producer'],'Private casting file'),
    ],
    seasons:{one:{defaults:[choice('theme','repair',['writer'],'Season treatment')]}},
    events:[
      {id:'initial',at:0,fact:'mug-state',value:'chipped',roles:['writer','animator'],
        learned:{kit:0,rue:1},source:'Earlier scene'},
      {id:'fixed',at:12,fact:'mug-state',value:'repaired',roles:['writer','animator'],
        learned:{kit:12,rue:17},source:'Bench scene',audienceAt:2,audienceRoles:['writer']},
      {id:'secret',at:20,fact:'spare-key',value:'in-the-canal',roles:['producer'],source:'Private future outline'},
      {id:'unrevealed',at:40,fact:'next-season',value:'train journey',roles:['writer'],
        source:'Future treatment',audienceAt:5,audienceRoles:['writer']},
    ],
  };
  const episode = {
    id:'afterwards',season:'one',releaseOrder:3,
    defaults:[choice('music','leitmotif',['mixer'],'Episode brief')],
    scenes:[
      {id:'flashback',storyTime:8,defaults:[choice('camera','doorway',['animator'],'Director board',{revision:'v2'})],shots:[
        {id:'reaction',defaults:[choice('music',null,['mixer'],'Held performance',{locked:true}),
          choice('hold-frames',192,['mixer','animator'],'Timing sheet',{locked:true})]},
      ]},
      {id:'during',storyTime:14,shots:[{id:'secret-repair'}]},
      {id:'later',storyTime:17,shots:[{id:'at-home'}]},
    ],
  };
  return {series,episode};
}

test('one shot resolves applicable scopes and provenance without crossing recipients or sibling scenes',()=>{
  const {series,episode} = fixture();
  const animator = resolveContext(series,episode,'reaction','animator');
  assert.deepEqual(animator.decisions.camera,{
    scope:'scene',scopeId:'flashback',value:'doorway',source:'Director board',revision:'v2',locked:false,
    history:[{scope:'series',scopeId:'kit-and-rue',value:'wide',source:'Kitchen plan',locked:false}],
  });
  assert.equal(animator.decisions['hold-frames'].value,192);
  assert.equal(animator.decisions['hold-frames'].locked,true);
  assert.equal(resolveContext(series,episode,'at-home','animator').decisions.camera.value,'wide');
  assert.equal(resolveContext(series,episode,'reaction','editor').decisions['caption.font'].value,'house-face');
  assert.deepEqual(Object.keys(resolveContext(series,episode,'reaction','writer').decisions).sort(),['theme','tone']);
  const mixer = resolveContext(series,episode,'reaction','mixer');
  assert.equal(mixer.decisions.music.value,null);
  assert.equal(mixer.decisions.music.history[0].value,'leitmotif');
  assert.deepEqual(mixer.facts,[]);
  for (const report of [animator,mixer]) {
    assert.doesNotMatch(JSON.stringify(report),/private|Private|unrevealed|Bench scene|in-the-canal|train journey/);
  }
});

test('story-time world and individual beliefs are independent through repair, discovery and flashback',()=>{
  const {series,episode} = fixture();
  const earlier = resolveContext(series,episode,'reaction','writer');
  assert.deepEqual(earlier.facts.map(f=>f.value),['chipped']);
  const current = resolveContext(series,episode,'secret-repair','writer');
  assert.equal(current.facts[0].value,'repaired');
  assert.deepEqual(current.facts[0].knownBy,['kit']);
  assert.deepEqual(current.facts[0].learned,{kit:12});
  assert.deepEqual(current.knowledge.rue['mug-state'],{value:'chipped',event:'initial',learnedAt:1});
  assert.equal(current.knowledge.kit['mug-state'].value,'repaired');
  const learned = resolveContext(series,episode,'at-home','writer');
  assert.deepEqual(learned.facts[0].knownBy,['kit','rue']);
  assert.equal(learned.knowledge.rue['mug-state'].learnedAt,17);
});

test('audience chronology requires explicit reveal, recipient permission and an explicit audience request',()=>{
  const {series,episode} = fixture();
  assert.equal(resolveContext(series,episode,'reaction','writer').audience,undefined);
  const request = role=>resolveContext(series,episode,'reaction',role,{includeAudience:true});
  assert.deepEqual(request('writer').audience.map(f=>f.id),['fixed']);
  assert.deepEqual(request('writer').facts.map(f=>f.id),['initial']);
  assert.deepEqual(request('animator').audience,[]);
  assert.doesNotMatch(JSON.stringify(request('writer')), /train journey|in-the-canal|learnedAt":17/);
  episode.scenes[0].audienceOrder=1;
  assert.deepEqual(request('writer').audience,[]);
});

test('distinct recipients can give different instructions while overlapping instructions and broken locks need a decision',()=>{
  const {series,episode} = fixture();
  series.defaults.push(choice('camera','diagram',['writer'],'Writer notes'));
  assert.equal(resolveContext(series,episode,'reaction','writer').decisions.camera.value,'diagram');
  series.defaults.push(choice('camera','side',['writer'],'Other notes'));
  assert.throws(()=>resolveContext(series,episode,'reaction','writer'),/Conflicting series defaults/);
  assert.equal(resolveContext(series,episode,'reaction','animator').decisions.camera.value,'doorway');
  series.defaults[0].locked = true;
  assert.throws(()=>resolveContext(series,episode,'reaction','animator'),/Locked decision camera/);
  episode.scenes[0].defaults[0].value='wide';
  assert.equal(resolveContext(series,episode,'reaction','animator').decisions.camera.locked,true);
});

test('role-filtered packets detach nested values and omit arbitrary private metadata from input objects',()=>{
  const {series,episode} = fixture();
  series.defaults.push(choice('gesture',{pose:'blink'},['animator'],'Rig sheet',{privateNotes:'Phone number'}));
  const report=resolveContext(series,episode,'reaction','animator');
  assert.doesNotMatch(JSON.stringify(report), /Phone number|privateNotes/);
  report.decisions.gesture.value.pose='wince';
  assert.equal(series.defaults.at(-1).value.pose,'blink');
});

test('missing inputs, conflicting story states and accidental implicit recipients cannot silently select a choice',()=>{
  const {series,episode} = fixture();
  const run=()=>resolveContext(series,episode,'reaction','writer');
  assert.throws(()=>resolveContext(series,episode,'absent','writer'),/Unknown shot/);
  episode.season='two'; assert.throws(run,/Unknown episode season/); episode.season='one';
  episode.scenes[1].shots.push({id:'reaction'}); assert.throws(run,/distinct across/); episode.scenes[1].shots.pop();
  series.events.push({...series.events[0],id:'competing',value:'pristine'});
  assert.throws(run,/Competing events/); series.events.pop();
  series.events[0].learned.rue = -3; assert.throws(run,/after its story time/); series.events[0].learned.rue=1;
  series.defaults[0].roles=[]; assert.throws(run,/explicit, distinct recipient roles/);
});

test('standalone or unscheduled material can resolve context without an invented season or story date',()=>{
  const series={version:1,id:'field-recordings',events:[{id:'later',at:1,fact:'weather',value:'rain',
    roles:['editor'],source:'Interview log'}]};
  const episode={id:'cello',scenes:[{id:'studio',shots:[{id:'opening'}]}]};
  const report=resolveContext(series,episode,'opening','editor');
  assert.deepEqual(report.facts,[]); assert.deepEqual(report.decisions,{});
  assert.equal(report.season,null); assert.equal(report.storyTime,null);
});
