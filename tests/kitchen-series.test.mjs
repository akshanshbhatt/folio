import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { json, probe, ROOT, run } from '../src/common.mjs';
import { pcm } from '../src/speech.mjs';
import { executeWorkflow } from '../src/workflow.mjs';

const source = join(ROOT, 'examples/kitchen-series');
const cli = (...args) => JSON.parse(run(process.execPath, [join(ROOT, 'src/cli.mjs'), ...args]));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'folio-kitchen-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'examples'));
  for (const name of ['src', 'node_modules']) symlinkSync(join(ROOT, name), join(root, name), 'dir');
  const dir = join(root, 'examples/kitchen-series');
  cpSync(source, dir, { recursive: true, filter: path => basename(path) !== '.folio' });
  return { dir, series: join(dir, 'series.json'), edition: join(root, 'accepted') };
}
const row = (report, id) => report.stages.find(s => s.id === id);
async function render(workflow) {
  const result = await executeWorkflow('run', workflow, { stage: 'cut' });
  assert.deepEqual(result.failures, {});
  assert.equal(row(result, 'cut').state, 'complete');
  return result;
}
function frame(file, n) {
  return run('ffmpeg', ['-v', 'error', '-i', file, '-vf', "select='eq(n," + n + ")',format=rgb24",
    '-frames:v', '1', '-f', 'rawvideo', '-'], { encoding: null });
}
const pixel = (bytes, x, y) => bytes.subarray(3 * (960 * y + x), 3 * (960 * y + x + 1));
function audio(file) {
  return run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', 's16le', '-ar', '24000', '-ac', '1', '-'], { encoding: null });
}
function correlation(actual, expected, start, count, loop = false) {
  let a2 = 0, b2 = 0, ab = 0;
  for (let n = 0; n < count; n++) {
    const a = actual.readInt16LE(2 * (n + start));
    const b = expected.readInt16LE(loop ? (2 * (n + start)) % expected.length : 2 * n);
    a2 += a * a; b2 += b * b; ab += a * b;
  }
  return ab / Math.sqrt(a2 * b2);
}

test('a supplied take reaches the speakers and captions while the pause stays in the edit', async t => {
  const { dir } = fixture(t), workflow = join(dir, 'workflow-repair.json');
  const first = await executeWorkflow('run', workflow, { stage: 'cut' });
  assert.equal(row(first, 'cut').state, 'blocked');
  assert.equal(row(first, 'find-chip').state, 'complete');
  const file = join(dir, 'sound/rue.wav');
  await executeWorkflow('override', workflow, { stage: 'performance', file });
  const report = await render(workflow);
  const cut = row(report, 'cut').artifacts, sheet = json(cut.timeline.path);
  const voice = sheet.shots.at(-1).voice, expected = pcm(file);
  assert.equal(row(report, 'performance').manualOverrideProtected, true);
  assert.equal(sheet.frames, 216);
  assert.deepEqual(sheet.shots.map(s => s.assets.find(a => a.asset === 'mug').variant), ['chipped', 'repaired', 'repaired']);
  assert.equal(voice.startSample, (66 + 60 + 16) * 1000);
  assert.equal(voice.endSample - voice.startSample, expected.bytes.length / 2);
  assert.ok(correlation(audio(cut.movie.path), expected.bytes, voice.startSample, expected.bytes.length / 2) > .98);
  assert.match(readFileSync(cut.captions.path, 'utf8'), /00:00:05.917 --> 00:00:07.869\n<v Rue>That was my good chip\./);
  const again = await render(workflow);
  assert.equal(row(report, 'performance').revision, row(again, 'performance').revision);
});

test('the flashback holds in picture and sound, then a single adopted drawing changes its cover and preserves the edition', async t => {
  const { dir, series, edition } = fixture(t), workflow = join(dir, 'workflow-flashback.json');
  const first = await render(workflow), cut = row(first, 'cut').artifacts;
  const video = probe(cut.movie.path).streams.find(s => s.codec_type === 'video');
  assert.equal(video.nb_frames, '264'); assert.equal(video.avg_frame_rate, '24/1');
  const sheet = json(cut.timeline.path);
  assert.deepEqual(sheet.shots.map(s => [s.startFrame, s.camera, s.eyebrow, s.assets.find(a => a.asset === 'mug').variant]),
    [[0, 'doorway', 'raised', 'chipped'], [192, 'wide', 'rest', 'repaired']]);
  const lastHold = frame(cut.movie.path, 191), wide = frame(cut.movie.path, 192);
  for (const n of [0, 103, 191]) {
    const actual = n === 191 ? lastHold : frame(cut.movie.path, n);
    assert.ok(pixel(actual, 36, 342)[0] < 50, 'Door jamb still in frame ' + n);
    assert.ok(pixel(actual, 725, 230)[0] < 98, 'Empty right side of the kitchen ' + n);
  }
  assert.ok(pixel(wide, 36, 342)[0] > 103, 'Wide frame no longer contains the jamb');
  assert.ok(pixel(wide, 725, 230)[0] > 180, 'Rue appears on the return to today');
  assert.ok(correlation(audio(cut.movie.path), pcm(join(dir, 'sound/room.wav')).bytes, 0, 192 * 1000, true) > .98);
  assert.doesNotMatch(readFileSync(cut.captions.path, 'utf8'), /-->/);

  const old = frame(cut.movie.path, 132);
  cli('series', 'pin', series, '--episode', 'flashback', '--workflow', workflow, '--stage', 'cut', '--dir', edition);
  cli('series', 'adopt', series, '--episode', 'flashback', '--shot', 'doorway-hold', '--asset', 'mug', '--revision', 'v2');
  const next = await render(workflow);
  for (const same of ['story', 'return-wide', 'sound']) assert.equal(row(next, same).revision, row(first, same).revision);
  for (const changed of ['doorway-hold', 'cover', 'cut']) assert.notEqual(row(next, changed).revision, row(first, changed).revision);
  assert.notEqual(row(next, 'cut').artifacts.cover.sha256, cut.cover.sha256);
  const updated = frame(row(next, 'cut').artifacts.movie.path, 132);
  let changedHandlePixels = 0;
  for (let y = 292; y < 380; y++) for (let x = 548; x < 595; x++)
    if (Math.abs(pixel(old, x, y)[0] - pixel(updated, x, y)[0]) > 20) changedHandlePixels++;
  assert.ok(changedHandlePixels > 50, 'Redesigned handle changes the decoded image');
  cli('series', 'verify', edition);
});

test('a revised board cannot silently shorten the approved reaction', async t => {
  const { dir } = fixture(t);
  const board = join(dir, 'editorial/flashback-board.svg');
  writeFileSync(board, readFileSync(board, 'utf8').replace('data-frames="192"', 'data-frames="144"'));
  const attempt = await executeWorkflow('run', join(dir, 'workflow-flashback.json'), { stage: 'story' });
  assert.ok(attempt.failures.story);
  const log = join(row(attempt, 'story').attempt.directory, 'stderr.log');
  assert.match(readFileSync(log, 'utf8'), /Protected durationFrames/);
  assert.equal(row(attempt, 'story').revision, null);
});
