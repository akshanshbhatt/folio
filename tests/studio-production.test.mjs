import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ROOT } from '../src/common.mjs';

const tool = name => join(ROOT, 'tools', 'workflow', name);
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, value) => writeFileSync(path, JSON.stringify(value));
function fixture(t) {
  const path = mkdtempSync(join(tmpdir(), 'folio-production-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return name => join(path, name);
}
function cli(command, args, request) {
  const result = spawnSync(command, args, { input: JSON.stringify(request), encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
}

test('the text agent routes an explicit model, selected input roles and opt-in brand to a local process', t => {
  const f = fixture(t), provider = f('writer.mjs'), output = f('reply.json');
  writeFileSync(provider, `import {readFileSync} from 'node:fs';
const prompt = JSON.parse(readFileSync(0, 'utf8'));
console.log(JSON.stringify({argv:process.argv.slice(2), prompt}));`);
  writeFileSync(f('note'), 'A local note.'); writeFileSync(f('brand'), 'Small studio');
  const job = {
    stage: 'draft', model: 'offline model v2', brand: f('brand'),
    inputs: { note: f('note'), other: f('intentionally-unread') }, outputs: { script: output },
    settings: { command: [process.execPath, provider, '--model', '{model}'], instruction: 'Write a caption.', roles: ['note'], format: 'json' },
  };
  const invoke = () => cli(process.execPath, [tool('text-agent.mjs')], job);
  const first = invoke(); assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(read(output), {
    argv: ['--model', 'offline model v2'],
    prompt: { task: 'Write a caption.', stage: 'draft', model: 'offline model v2', format: 'json', material: { note: 'A local note.' } },
  });
  job.settings.includeBrand = true;
  job.purpose = 'Locate the selected sound.';
  job.responsibility = 'Sound editor';
  const next = invoke(); assert.equal(next.status, 0, next.stderr);
  assert.equal(read(output).prompt.brand, 'Small studio');
  assert.equal(read(output).prompt.purpose, job.purpose);
  assert.equal(read(output).prompt.responsibility, job.responsibility);
  const accepted = readFileSync(output);
  job.model = null;
  const absentModel = invoke(); assert.notEqual(absentModel.status, 0); assert.match(absentModel.stderr, /owner.model/);
  job.model = 'offline model v2';
  writeFileSync(provider, "process.stdout.write('Provider reply is not JSON');");
  assert.notEqual(invoke().status, 0); assert.deepEqual(readFileSync(output), accepted);
  writeFileSync(provider, 'process.exit(23);');
  assert.match(invoke().stderr, /Provider exited with 23/);
  job.settings.roles = ['unknown'];
  assert.match(invoke().stderr, /input roles/);
});

test('local research binds exact quote occurrences and rights to original bytes inside the input size limit', t => {
  const f = fixture(t), source = f('field.html'), selection = f('selection.json'), evidence = f('evidence.json');
  const html = '<html><head><style>suppressed</style></head><body><p>Blue lamp.</p><script>secret</script><p>Check again: Blue lamp.</p></body></html>';
  writeFileSync(source, html);
  const entry = { id: 'room', input: 'source', title: 'Field observation', rights: 'Original', url: 'https://example.org/field-note', format: 'text/html' };
  const reference = { source: 'room', locator: 'second paragraph', quote: 'Blue lamp.', occurrence: 2 };
  const document = { sources: [entry], claims: [{ id: 'lamp', statement: 'The observer recorded a blue lamp.', references: [reference] }] };
  const req = { inputs: { selection, source }, outputs: { evidence }, settings: { includeNormalizedText: true } };
  const invoke = () => { save(selection, document); return cli('python3', [tool('research.py'), 'collect'], req); };
  const first = invoke(); assert.equal(first.status, 0, first.stderr);
  const out = read(evidence), [provenance] = out.sources, [cite] = out.claims[0].citations;
  assert.equal(out.kind, 'evidence');
  assert.equal(provenance.sha256, createHash('sha256').update(html).digest('hex'));
  assert.equal(provenance.rights, 'Original');
  assert.equal(provenance.url, entry.url);
  assert.equal(provenance.normalizedText, 'Blue lamp. Check again: Blue lamp.');
  assert.deepEqual(cite.normalizedRange, [provenance.normalizedText.lastIndexOf('Blue lamp.'), provenance.normalizedText.length]);
  assert.equal(provenance.normalizedText.slice(...cite.normalizedRange), cite.quote);
  delete reference.occurrence; assert.match(invoke().stderr, /Select a quote occurrence/);
  reference.occurrence = 3; assert.match(invoke().stderr, /Missing quote occurrence/);
  reference.quote = 'secret'; assert.match(invoke().stderr, /Passage missing/);
  reference.quote = 'Blue lamp.'; reference.occurrence = 2;
  const size = 4 * 1024 * 1024, exact = Buffer.alloc(size, 32);
  Buffer.from(html).copy(exact); writeFileSync(source, exact);
  assert.equal(invoke().status, 0);
  writeFileSync(source, Buffer.concat([exact, Buffer.from(' ')]));
  assert.match(invoke().stderr, /exceeds 4 MiB/);
  const badBrief = f('query.json'); save(badBrief, { query: 'a local validation case', limit: 21 });
  const noFetch = cli('python3', [tool('research.py'), 'discover'], { inputs: { brief: badBrief }, outputs: { leads: f('leads.json') } });
  assert.notEqual(noFetch.status, 0); assert.match(noFetch.stderr, /between 1 and 20/); assert.equal(existsSync(f('leads.json')), false);
});

const fps = 20, width = 64, height = 48, rate = 48000;
// Each recorded second has both a different picture and a distinct tone in each stereo channel.
const colors = [[205, 30, 35], [25, 185, 42], [30, 45, 210], [220, 188, 30]];
const tones = [[240, 480], [370, 610], [540, 780], [710, 950]];
function makeSource(f) {
  const frames = Buffer.alloc(4 * fps * width * height * 3), samples = Buffer.alloc(4 * rate * 4);
  for (let second = 0; second < 4; second++) {
    const rgb = Buffer.from(colors[second]);
    frames.fill(rgb, second * fps * width * height * 3, (second + 1) * fps * width * height * 3);
    for (let i = 0; i < rate; i++) for (let ch = 0; ch < 2; ch++) {
      const val = Math.round(8500 * Math.sin(2 * Math.PI * tones[second][ch] * i / rate));
      samples.writeInt16LE(val, (second * rate + i) * 4 + ch * 2);
    }
  }
  writeFileSync(f('picture.rgb'), frames); writeFileSync(f('sound.pcm'), samples);
  execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', width + 'x' + height,
    '-r', String(fps), '-i', f('picture.rgb'), '-f', 's16le', '-ar', String(rate), '-ac', '2', '-i', f('sound.pcm'),
    '-map', '0:v', '-map', '1:a', '-c:v', 'ffv1', '-c:a', 'pcm_s16le', f('recording.mkv')]);
}
function frameColors(file) {
  const rgb = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', '-an', '-fps_mode', 'passthrough',
    '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
  const stride = width * height * 3, center = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 3;
  assert.equal(rgb.length % stride, 0);
  return Array.from({ length: rgb.length / stride }, (_, frame) => {
    const pixel = rgb.subarray(frame * stride + center, frame * stride + center + 3);
    return colors.findIndex(color => color.every((value, i) => Math.abs(value - pixel[i]) <= 12));
  });
}
function stereoPcm(file) {
  return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-vn', '-ar', String(rate),
    '-c:a', 'pcm_s16le', '-f', 's16le', '-'], { maxBuffer: 4 * 1024 * 1024 });
}
function strongestTone(pcm, time, channel) {
  const start = Math.round(time * rate), count = rate / 10;
  let strongest, largest = 0;
  for (const frequency of tones.flat()) {
    let x = 0, y = 0;
    for (let i = 0; i < count; i++) {
      const value = pcm.readInt16LE((start + i) * 4 + 2 * channel), angle = 2 * Math.PI * frequency * i / rate;
      x += value * Math.cos(angle); y += value * Math.sin(angle);
    }
    const magnitude = 2 * Math.hypot(x, y) / count;
    if (magnitude > largest) { largest = magnitude; strongest = frequency; }
  }
  assert.ok(largest > 4000, 'Expected a recorded channel tone above the noise floor');
  return strongest;
}

test('a reordered multi-select preserves source pictures and both stereo channels through the final MP4', t => {
  const f = fixture(t); makeSource(f);
  const edl = { fps, size: [width, height], selects: [
    { source: 'recording', in: 2.25, out: 3.25, captions: [{ start: 2.1, end: 2.65, text: 'Blue & yellow' }] },
    { source: 'recording', in: 0.5, out: 1.25, captions: [{ start: 0.6, end: 1.4, text: 'Red < green' }] },
  ] };
  save(f('edit.json'), edl);
  const outputs = { movie: f('result.mp4'), captions: f('result.vtt'), timeline: f('timeline.json') };
  const invoke = () => cli('python3', [tool('edit.py')], { inputs: { recording: f('recording.mkv'), edl: f('edit.json') }, outputs });
  const result = invoke(); assert.equal(result.status, 0, result.stderr);
  const source = frameColors(f('recording.mkv')), after = frameColors(outputs.movie);
  assert.deepEqual(source, colors.flatMap((_,i) => Array(fps).fill(i)));
  assert.deepEqual(after, [...source.slice(45, 65), ...source.slice(10, 25)]);
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_packets', '-show_format', '-of', 'json', outputs.movie]));
  const video = info.streams.find(s => s.codec_type === 'video'), audio = info.streams.find(s => s.codec_type === 'audio');
  assert.equal(video.codec_name, 'h264'); assert.equal(audio.codec_name, 'aac'); assert.equal(audio.channels, 2);
  assert.equal(Number(video.nb_frames), 35); assert.equal(Number(audio.sample_rate), rate);
  assert.ok(Math.abs(Number(info.format.duration) - 1.75) <= 1 / fps);
  const pts = info.packets.filter(p => p.stream_index === video.index).map(p => Number(p.pts_time)).sort((a,b) => a-b);
  assert.equal(pts.length, 35);
  assert.ok(pts.every((time,i) => Math.abs(time - pts[0] - i / fps) < 0.002), 'One presentation timestamp per output frame');
  const beforeSound = stereoPcm(f('recording.mkv')), afterSound = stereoPcm(outputs.movie);
  for (const [outAt, sourceAt, second] of [[0.2, 2.45, 2], [0.8, 3.05, 3], [1.2, 0.7, 0], [1.55, 1.05, 1]]) {
    const before = [0,1].map(c => strongestTone(beforeSound, sourceAt, c));
    assert.deepEqual(before, tones[second]); assert.deepEqual([0,1].map(c => strongestTone(afterSound, outAt, c)), before);
  }
  assert.deepEqual(read(outputs.timeline), { fps, frames: 35, duration: 1.75, selects: [
    { source: 'recording', sourceIn: 2.25, sourceOut: 3.25, startFrame: 0, frames: 20 },
    { source: 'recording', sourceIn: 0.5, sourceOut: 1.25, startFrame: 20, frames: 15 },
  ] });
  const captions = readFileSync(outputs.captions, 'utf8');
  assert.match(captions, /00:00:00\.000 --> 00:00:00\.400\nBlue &amp; yellow/);
  assert.match(captions, /00:00:01\.100 --> 00:00:01\.750\nRed &lt; green/);
});

test('a select starting between 1 fps source frames uses the picture on screen at its in-point', t => {
  const f = fixture(t), picture = f('low-rate.mkv'), sound = f('sound.wav');
  const raw = Buffer.alloc(width * height * 3 * 2);
  raw.fill(Buffer.from(colors[0]), 0, raw.length / 2); raw.fill(Buffer.from(colors[2]), raw.length / 2);
  writeFileSync(f('two-frames.rgb'), raw);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-s', width + 'x' + height, '-pix_fmt', 'rgb24',
    '-r', '1', '-i', f('two-frames.rgb'), '-f', 'lavfi', '-i', 'sine=frequency=400:sample_rate=48000:duration=2',
    '-c:v', 'ffv1', '-c:a', 'pcm_s16le', picture]);
  execFileSync('ffmpeg', ['-v', 'error', '-i', picture, '-vn', '-c:a', 'pcm_s16le', sound]);
  for (const replacement of [false, true]) {
    const source = replacement ? 'take' : 'movie', out = f('cut-' + source + '.mp4');
    const select = replacement ? { source, in: 0.4, out: 0.65, pictureSource: 'movie', pictureIn: 0.3 }
      : { source, in: 0.3, out: 0.55 };
    save(f('edl.json'), { fps, size: [width, height], selects: [select] });
    const request = { inputs: { movie: picture, take: sound, edl: f('edl.json') }, outputs: { movie: out } };
    const result = cli('python3', [tool('edit.py')], request); assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(frameColors(out), Array(5).fill(0), source + ' should hold red through the sub-frame select');
  }
  save(f('edl.json'), { fps, size: [width, height], selects: [{ source: 'take', in: 0, out: 0.5, pictureSource: 'movie', pictureIn: 1.75 }] });
  const rejected = cli('python3', [tool('edit.py')], {
    inputs: { movie: picture, take: sound, edl: f('edl.json') }, outputs: { movie: f('invalid.mp4') },
  });
  assert.notEqual(rejected.status, 0); assert.equal(existsSync(f('invalid.mp4')), false);
});
