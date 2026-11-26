import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { ROOT } from '../src/common.mjs';

const example = join(ROOT, 'examples/renderers');
const width = 320, height = 180, fps = 24, rate = 48000;
const requiresTools = !process.env.FOLIO_HYPERFRAMES_BIN || !process.env.FOLIO_BLENDER_BIN;
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, object) => writeFileSync(path, JSON.stringify(object, null, 2));
const range = (start, end) => Array.from({ length: end - start }, (_, i) => start + i);

function runProject(project) {
  const command = spawnSync(process.execPath, [join(ROOT, 'src/cli.mjs'), 'workflow', 'run', join(project, 'workflow.json')],
    { cwd: project, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (command.error) throw command.error;
  const result = JSON.parse(command.stdout || '{}');
  const failures = (result.stages || []).filter(s => s.attempt?.state === 'failed').map(stage =>
    stage.id + ': ' + readFileSync(join(stage.attempt.directory, 'stderr.log'), 'utf8').slice(-2500));
  assert.equal(command.status, 0, [command.stderr, ...failures].join('\n'));
  assert.ok(result.stages.every(stage => stage.state === 'complete'));
  return Object.fromEntries(result.stages.map(stage => [stage.id, stage]));
}

function frames(path) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-map', '0:v:0', '-an', '-fps_mode', 'passthrough',
    '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 16 * 1024 * 1024 });
  const stride = width * height * 3;
  assert.equal(raw.length % stride, 0);
  return Array.from({ length: raw.length / stride }, (_, i) => raw.subarray(i * stride, (i + 1) * stride));
}

function orangeFrames(pictures) {
  const receiver = (90 * width + 235) * 3;
  return pictures.flatMap((rgb, i) => rgb[receiver] - rgb[receiver + 2] > 130 ? [i] : []);
}

function sliderCenter(rgb) {
  let total = 0, count = 0;
  for (let i = 0; i < rgb.length; i += 3) {
    if (rgb[i] > rgb[i + 1] + 20 && rgb[i] > rgb[i + 2] + 46) {
      total += (i / 3) % width;
      count++;
    }
  }
  assert.ok(count > 150, 'The rendered slider must be visible');
  return total / count;
}

function mono(path) {
  const data = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-map', '0:a:0', '-vn',
    '-ar', String(rate), '-ac', '1', '-c:a', 'pcm_s16le', '-f', 's16le', '-']);
  return new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.length));
}

function checkSound(path, expected) {
  const metadata = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', path]));
  const video = metadata.streams.find(s => s.codec_type === 'video'), audio = metadata.streams.find(s => s.codec_type === 'audio');
  assert.equal(metadata.streams.length, 2); assert.equal(video.codec_name, 'h264'); assert.equal(audio.codec_name, 'aac');
  assert.equal(Number(audio.sample_rate), rate); assert.equal(audio.channels, 2);
  assert.deepEqual([video.width, video.height], [width, height]);
  assert.equal(Number(video.nb_frames), Math.round(expected.length / rate * fps));
  assert.ok(Math.abs(Number(audio.duration) - expected.length / rate) < 0.002);
  const actual = mono(path);
  // Some decoders expose the tail of the last AAC packet. Compare the presented media interval.
  assert.ok(actual.length >= expected.length && actual.length < expected.length + 1024);
  let aa = 0, bb = 0, ab = 0;
  for (let i = 0; i < expected.length; i++) {
    aa += actual[i] * actual[i]; bb += expected[i] * expected[i]; ab += actual[i] * expected[i];
  }
  const correlation = ab / Math.sqrt(aa * bb);
  assert.ok(correlation > 0.97, 'Rendered sound should match the selected recording at zero sample lag (' + correlation + ')');
}

function checkEdition(project, rows, step) {
  const file = (stage, role) => rows[stage].artifacts[role].path;
  const source = join(project, 'performance.wav'), samples = mono(source);
  const compiled = json(file('timing', 'cues')), [shot] = compiled.shots, [action] = shot.actions;
  const expectedFrames = 24 + step, start = 6 + step, end = 18 + step;
  assert.equal(compiled.fps, fps); assert.equal(shot.frames, expectedFrames); assert.equal(samples.length, expectedFrames * rate / fps);
  assert.deepEqual([action.startFrame, action.endFrame], [start, end]);
  const foreground = range(start, end);
  assert.deepEqual(orangeFrames(frames(file('contacts', 'video'))), foreground);
  const extracts = frames(file('extract', 'video'));
  assert.equal(extracts.length, 12);
  assert.deepEqual(orangeFrames(extracts), foreground.filter(i => i >= 6 && i < 18).map(i => i - 6));
  const plateCenters = frames(file('slider', 'video')).map(sliderCenter);
  assert.equal(plateCenters.length, expectedFrames);
  assert.ok(plateCenters[end] - plateCenters[start] > 100);
  const recordingEdit = json(file('timing', 'edl'));
  const [select] = recordingEdit.selects;
  assert.equal(select.source, 'performance'); assert.equal(select.pictureSource, 'plate');
  assert.deepEqual([select.in, select.out], [0, expectedFrames / fps]);

  for (const [stage, upstream] of [['html-cut', 'contacts'], ['blender-cut', 'slider']]) {
    const movie = file(stage, 'movie'), pictures = frames(movie);
    assert.equal(pictures.length, expectedFrames);
    checkSound(movie, samples);
    if (stage === 'html-cut') assert.deepEqual(orangeFrames(pictures), foreground);
    else assert.ok(pictures.every((frame, i) => Math.abs(sliderCenter(frame) - plateCenters[i]) < 2));
    const captions = readFileSync(file(stage, 'captions'), 'utf8');
    const expectedCue = step ? '00:00:00.500 --> 00:00:01.200' : '00:00:00.250 --> 00:00:00.950';
    assert.ok(captions.includes(expectedCue + '\nRoom test.'));
    assert.equal(json(file(stage, 'timeline')).frames, expectedFrames);

    // Exercise an actual nonzero take and plate trim on this same two-input edit.
    const head = start / fps, tail = end / fps;
    const edl = join(project, stage + '-select.json'), clip = join(project, stage + '-select.mp4');
    save(edl, { ...recordingEdit, selects: [{ ...select, in: head, out: tail, pictureIn: head, frames: end - start }] });
    execFileSync('python3', [join(ROOT, 'tools/workflow/edit.py')], {
      input: JSON.stringify({ inputs: { edl, performance: source, plate: file(upstream, 'video') }, outputs: { movie: clip } }),
    });
    checkSound(clip, samples.subarray(Math.round(head * rate), Math.round(tail * rate)));
    const selected = frames(clip); assert.equal(selected.length, end - start);
    if (stage === 'html-cut') assert.deepEqual(orangeFrames(selected), range(0, end - start));
    else assert.ok(selected.every((frame, i) => Math.abs(sliderCenter(frame) - plateCenters[start + i]) < 2));
  }
  return plateCenters;
}

test('padding the performance retimes the HTML and Blender pictures, captions and edited audio together',
  { skip: requiresTools && 'Set FOLIO_HYPERFRAMES_BIN and FOLIO_BLENDER_BIN to run the two-renderer project' }, t => {
    const scratch = mkdtempSync(join(tmpdir(), 'folio-performance-'));
    t.after(() => rmSync(scratch, { recursive: true, force: true }));
    // Preserve the example's relative command paths and avoid importing previous workflow state.
    for (const name of ['adapters', 'tools']) symlinkSync(join(ROOT, name), join(scratch, name), 'junction');
    const project = join(scratch, 'examples', 'renderers'); mkdirSync(join(scratch, 'examples'));
    cpSync(example, project, { recursive: true, filter: source => basename(source) !== '.folio' });
    const baseline = runProject(project);
    const original = checkEdition(project, baseline, 0);
    const take = join(project, 'performance.wav'), padded = join(project, 'padded.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-i', take, '-af', 'aresample=48000,adelay=12000S:all=1', '-c:a', 'pcm_s16le', padded]);
    renameSync(padded, take);
    const timing = join(project, 'alignment.json'), alignment = json(timing);
    for (const span of alignment.spans) { span.start += 0.25; span.end += 0.25; }
    save(timing, alignment);
    const retimed = runProject(project);
    for (const [id, stage] of Object.entries(baseline)) assert.notEqual(retimed[id].revision, stage.revision);
    const delayed = checkEdition(project, retimed, 6);
    assert.ok(delayed.slice(0, 6).every(x => Math.abs(x - original[0]) < 2));
    assert.ok(original.every((x, i) => Math.abs(x - delayed[i + 6]) < 2), 'The full Blender trajectory must move six frames later');
  });
