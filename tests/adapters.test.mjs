import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {ROOT} from '../src/common.mjs';

const cli = join(ROOT, 'adapters/visual.mjs');
const example = join(ROOT, 'examples/renderers');
const composition = join(example, 'pulse.html'), cues = join(example, 'timing.json');
function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), 'folio-renderer-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  return dir;
}
function adapter(kind, request, cwd) {
  return spawnSync(process.execPath, [cli, kind], {cwd, input: JSON.stringify(request), encoding: 'utf8'});
}
function videoInfo(file) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file])).streams;
}
function rgb(file, frame) {
  return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'select=eq(n\\,' + frame + ')',
    '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
}

test('import runs from a standalone request and admits only complete, silent video plates', t => {
  const dir = workspace(t);
  const src = join(dir, 'owned.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x48:r=24:d=1',
    '-f', 'lavfi', '-i', 'sine=d=1', '-c:v', 'libx264', '-c:a', 'aac', src]);
  const req = {inputs: {media: 'owned.mp4'}, outputs: {video: 'trim.mp4'}, settings: {start: 0.25, duration: 0.5}};
  const spec = join(dir, 'request.json');
  writeFileSync(spec, JSON.stringify(req));
  execFileSync(process.execPath, [cli, 'import', '--request', spec], {cwd: tmpdir()});
  const file = join(dir, 'trim.mp4'), [movie, audio] = videoInfo(file);
  assert.equal(movie.codec_name, 'h264');
  assert.equal(audio, undefined);
  assert.deepEqual([movie.width, movie.height, Number(movie.nb_frames)], [64, 48, 12]);
  const prior = readFileSync(file);
  assert.match(adapter('import', req, dir).stderr, /already exists/);
  assert.deepEqual(readFileSync(file), prior);
  const tooLong = adapter('import', {...req, outputs: {video: 'short.mp4'}, settings: {start: 0.75, duration: 0.5}}, dir);
  assert.notEqual(tooLong.status, 0);
  assert.match(tooLong.stderr, /requested duration/);
  assert.equal(existsSync(join(dir, 'short.mp4')), false);
});

test('resolved actions must belong to the selected shot and explicitly named cue', t => {
  const dir = workspace(t);
  const spec = {inputs: {composition, cues}, outputs: {video: 'no.mp4'}, settings: {shot: 'unknown'}};
  assert.match(adapter('hyperframes', spec, dir).stderr, /exactly one timeline shot/);
  const source = join(dir, 'missing.html');
  writeFileSync(source, '<div data-start="{{cue.other.start}}"></div>');
  spec.inputs.composition = source;
  spec.settings.shot = 'contacts';
  assert.match(adapter('hyperframes', spec, dir).stderr, /Unknown composition token/);
  spec.inputs.composition = composition;
  spec.settings.assets = {cues: '../outside.json'};
  assert.match(adapter('hyperframes', spec, dir).stderr, /inside the render project/);
  assert.equal(existsSync(join(dir, 'no.mp4')), false);
});

test('import samples a held source picture when the requested in-point falls between frames', t => {
  const dir = workspace(t), movie = join(dir, 'held.mkv'), plate = join(dir, 'plate.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=64x48:r=1:d=1',
    '-f', 'lavfi', '-i', 'color=blue:s=64x48:r=1:d=1', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0',
    '-r', '1', '-c:v', 'ffv1', movie]);
  const result = adapter('import', {inputs: {media: movie}, outputs: {video: plate},
    settings: {start: .3, duration: .25, fps: 24}}, dir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(Number(videoInfo(plate)[0].nb_frames), 6);
  for (const frame of [0, 5]) {
    const [red, , blue] = rgb(plate, frame);
    assert.ok(red > 180 && blue < 40, 'the first source picture is held for the full select');
  }
});

test('contradictory cue clocks cannot reach either external renderer', t => {
  const dir = workspace(t), times = join(dir, 'clock.json');
  const original = JSON.parse(readFileSync(cues));
  const request = {inputs: {composition, scene: join(example, 'slider.py'), cues: times},
    outputs: {video: 'clock.mp4'}, settings: {executable: join(dir, 'unreachable-renderer')}};
  for (const [field, value] of [['startFrame', 7], ['endFrame', 17], ['filmStartFrame', 7], ['filmEndFrame', 17]]) {
    const timeline = structuredClone(original);
    timeline.shots[0].actions[0][field] = value;
    writeFileSync(times, JSON.stringify(timeline));
    for (const kind of ['hyperframes', 'blender']) {
      const failed = adapter(kind, request, dir);
      assert.notEqual(failed.status, 0);
      assert.match(failed.stderr, new RegExp(field + ' inconsistent with its resolved seconds'));
    }
  }
  const event = original.shots[0].actions[0];
  Object.assign(event, {start: 1, end: 1});
  writeFileSync(times, JSON.stringify(original));
  assert.match(adapter('hyperframes', request, dir).stderr, /outside the shot/);
  assert.equal(existsSync(join(dir, 'clock.mp4')), false);
});

const hyperframes = process.env.FOLIO_HYPERFRAMES_BIN;
test('real HyperFrames clips switch at the selected spoken cue frames',
  {skip: !hyperframes && 'Set FOLIO_HYPERFRAMES_BIN to run the optional HyperFrames integration'}, t => {
    const dir = workspace(t);
    const result = adapter('hyperframes', {inputs: {composition, cues}, outputs: {video: 'pulse.mp4'}}, dir);
    assert.equal(result.status, 0, result.stderr);
    const file = join(dir, 'pulse.mp4'), pixel = (90 * 320 + 235) * 3;
    assert.equal(Number(videoInfo(file)[0].nb_frames), 24);
    const isOrange = frame => {
      const color = rgb(file, frame).subarray(pixel, pixel + 3);
      return color[0] - color[2] > 130;
    };
    assert.deepEqual([5, 6, 17, 18].map(isOrange), [false, true, true, false]);
  });

const blender = process.env.FOLIO_BLENDER_BIN;
test('a real Blender binary reconstructs a native scene from its packed blend file',
  {skip: !blender && 'Set FOLIO_BLENDER_BIN to run the optional Blender integration'}, t => {
    const dir = workspace(t), scene = join(dir, 'source.blend');
    // This first invocation creates an actual blend project. Its keyframes persist on disk.
    execFileSync(blender, ['--background', '--factory-startup', '--threads', '2', '--python-exit-code', '1',
      '--python', join(example, 'slider.py'), '--python-expr',
      'import bpy, os; bpy.ops.wm.save_as_mainfile(filepath=os.environ["FOLIO_TEST_BLEND"])'],
      {cwd: dir, env: {...process.env, FOLIO_TEST_BLEND: scene}, stdio: 'pipe'});
    const result = adapter('blender', {inputs: {scene, cues}, outputs: {video: 'slider.mp4'}}, dir);
    assert.equal(result.status, 0, result.stderr);
    const file = join(dir, 'slider.mp4'), [info] = videoInfo(file);
    assert.equal(Number(info.nb_frames), 24);
    function sliderX(frame) {
      const bytes = rgb(file, frame);
      let sum = 0, count = 0;
      for (let i = 0; i < bytes.length; i += 3) {
        if (bytes[i] > bytes[i + 2] + 46 && bytes[i] > bytes[i + 1] + 20) {
          sum += (i / 3) % info.width;
          count++;
        }
      }
      assert.ok(count > 150);
      return sum / count;
    }
    assert.ok(sliderX(18) - sliderX(5) > 100);
  });
