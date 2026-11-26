import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {ROOT,inside} from '../src/common.mjs';
import {library,validate} from '../src/model.mjs';
import {samples,presentationTimes} from '../src/video.mjs';
import {captions,subtitleText} from '../src/subtitles.mjs';
import {calendar} from '../src/editorial.mjs';
import {progress,project} from '../src/motion.mjs';
import {rollingDistance} from '../channels/starter/components/wheel.mjs';
const channel=join(ROOT,'channels/starter');
test('the starter wheel and other bundled examples resolve their evidence and components', () => {
  const episodes = library(channel);
  const opening = episodes.get('rolling-wheel').shots[0];
  assert.equal(opening.id, 'one-turn');
  assert.equal(opening.component, 'wheel');
  for (const episode of episodes.values()) validate(episode, channel);
});
test('a dangling source cannot produce a render',()=>{const e=structuredClone(library(channel).get('rolling-wheel'));e.shots[0].refs=['unknown'];assert.throws(()=>validate(e,channel),/unresolved source/);});
test('an invalid spoken anchor fails during authoring validation',()=>{
  const episode=structuredClone(library(channel).get('rolling-wheel'));
  for(const bad of [1,{sentence:99},{sentence:1,edge:'next'}]){
    episode.shots[0].motionAt=bad;
    assert.throws(()=>validate(episode,channel),/motionAt/);
  }
});
test('asset paths are relative to the channel',()=>{assert.throws(()=>inside(channel,'../outside'));});
test('freeze frames preserve caption boundaries and delayed motion',()=>{
  const list=samples(120,30,{motion:0.1,motionStart:1},[{start:.25,end:.7}],true);
  assert.deepEqual(list,[0,8,21,30,31,32,33,119]);assert.match(presentationTimes(list),/gte\(N,7\)/);
});
test('caption grouping gives the final word adequate dwell time',()=>{
  const text='Watch the dial as the motor starts and read the value when the needle settles.';
  const cues=captions([{start:0,end:4,text}],Buffer.alloc(4*48000));
  assert.equal(cues.map(s=>s.text).join(' '),text);assert.ok(cues.every(s=>s.end-s.start>=1));
  assert.match(subtitleText(cues,true),/^WEBVTT/);assert.match(subtitleText(cues),/00:00:00,000/);
});
test('the calendar assigns each format its own cadence and leaves reserved slots open', () => {
  const cadence = {
    start: '2024-02-26', timezone: 'Europe/Dublin',
    shortDays: [1, 4], shortTime: '08:15', shortTarget: 4,
    longDay: 4, longEveryWeeks: 2, longTime: '19:45', longTarget: 2
  };
  const episodes = [
    {id: 'first-long', format: 'long', title: 'Long experiment'},
    {id: 'first-short', format: 'short', title: 'First observation'},
    {id: 'second-short', format: 'short', title: 'Second observation'}
  ];
  const slots = calendar(cadence, episodes);
  assert.ok(slots.every(slot => slot.timezone === cadence.timezone));
  assert.deepEqual(slots.map(slot => [slot.local, slot.format, slot.id]), [
    ['2024-02-26T08:15', 'short', 'first-short'],
    ['2024-02-29T08:15', 'short', 'second-short'],
    ['2024-02-29T19:45', 'long', 'first-long'],
    ['2024-03-04T08:15', 'short', null],
    ['2024-03-07T08:15', 'short', null],
    ['2024-03-14T19:45', 'long', null]
  ]);
});
test('animation curves settle, orthographic projection retains the z landmark',()=>{
  for(const curve of ['linear','smooth','smoother','out-cubic']){assert.equal(progress(-1,curve),0);assert.equal(progress(2,curve),1);}
  assert.deepEqual(project([2,8,4]),[2,8,4]);
});
test('the rolling wheel travels one circumference per turn, including partial turns', () => {
  // A wheel with a 20 cm diameter advances 5π cm in a quarter-turn.
  assert.ok(Math.abs(rollingDistance(10, 0.25) - 15.707963267948966) < 1e-10);
  assert.equal(rollingDistance(10, 0), 0);
  assert.ok(Math.abs(rollingDistance(8, 2) - rollingDistance(16, 1)) < 1e-10);
});
