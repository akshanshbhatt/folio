import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {ROOT,json,run} from '../src/common.mjs';
import {executeWorkflow} from '../src/workflow.mjs';
import {clockAt} from '../examples/history-desk/tabletop.mjs';

const dir=join(ROOT,'examples/history-desk'),board=json(join(dir,'editorial/storyboard.json'));
const [slow,fast]=board.shots[2].clocks;
test('each independent clock shows a complete interval for its final card',()=>{
  assert.deepEqual(clockAt(44,0,fast,30),{card:45,elapsed:44/30,done:false});
  assert.deepEqual(clockAt(45,0,fast,30),{card:45,elapsed:1.5,done:true});
  assert.deepEqual(clockAt(45,0,slow,30),{card:23,elapsed:1.5,done:false});
  assert.deepEqual(clockAt(89,0,slow,30),{card:45,elapsed:89/30,done:false});
  assert.deepEqual(clockAt(90,0,slow,30),{card:45,elapsed:3,done:true});
});
test('an offline edition retains accepted sources and actual encoded card changes',async t=>{
  const state=mkdtempSync(join(tmpdir(),'folio-history-test-'));t.after(()=>rmSync(state,{recursive:true,force:true}));
  const workflow=join(dir,'workflow.json');
  const report=await executeWorkflow('run',workflow,{state,stage:'edition'});
  assert.deepEqual(report.failures,{});
  assert.ok(report.stages.every(s=>s.state==='complete'));
  const out=report.stages.at(-1).artifacts,source=json(out.sources.path);
  assert.deepEqual(source.beats.map(b=>b.id),['count','recover','clocks','limit']);
  assert.ok(source.beats.every(beat=>beat.references.every(r=>r.url.startsWith('https://www.loc.gov/')&&r.locator)));
  assert.equal(source.review.decision,'accept');
  assert.equal(source.files.movie,createHash('sha256').update(readFileSync(out.movie.path)).digest('hex'));
  assert.match(readFileSync(out.captions.path,'utf8'),/WEBVTT/);
  assert.match(readFileSync(out.srt.path,'utf8'),/00:00:00,200 -->/);
  const fps=source.edit.fps,{startFrame}=source.picture.clockTrials[0];
  function countLamps(frame) {
    const bytes=run('ffmpeg',['-v','error','-i',out.movie.path,'-frames:v','1',
      '-vf',"select='eq(n,"+frame+")',format=rgb24,crop=1280:1:0:486",'-f','rawvideo','pipe:1'],{encoding:null});
    assert.equal(bytes.length,1280*3);
    return [63,684].map(x=>Array.from({length:45},(_,i)=>bytes[3*(x+31+Math.round(i*10.5)+3)]>120).filter(Boolean).length);
  }
  assert.deepEqual(countLamps(startFrame+30),[16,31]); // independent rates on the same elapsed second
  assert.deepEqual(countLamps(startFrame+45),[23,45]);
  assert.deepEqual(countLamps(startFrame+70),[36,45]); // right remains stationary, left advances
  assert.deepEqual(countLamps(startFrame+90),[45,45]);

  const timing=json(join(dir,'performance/timing.json'));timing.beats[0].spans[0].text='An unreviewed line.';
  const modified=join(state,'changed.json');writeFileSync(modified,JSON.stringify(timing));
  const script=report.stages.find(stage=>stage.id==='script').artifacts.script.path;
  const changed=spawnSync(process.execPath,[join(dir,'edition.mjs')],{encoding:'utf8',input:JSON.stringify({
    stage:'narration',inputs:{script,markers:modified,recording:join(dir,'performance/voice.flac')},outputs:{}})});
  assert.notEqual(changed.status,0);assert.match(changed.stderr,/Performance text diverges/);
});
