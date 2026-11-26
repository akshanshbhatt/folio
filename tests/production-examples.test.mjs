import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, join} from 'node:path';
import {ROOT} from '../src/common.mjs';

const read = file => JSON.parse(readFileSync(file, 'utf8'));
function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), 'folio-production-'));
  t.after(() => rmSync(dir, {recursive:true, force:true}));
  return dir;
}
const workflow = (...args) => JSON.parse(execFileSync(process.execPath,
  [join(ROOT, 'src/cli.mjs'), 'workflow', ...args], {encoding:'utf8'}));
const stage = (state, id) => state.stages.find(s => s.id === id);

test('the producer brief compiles to the working studio project and exports the reviewed cut', t => {
  const work = temporary(t), session = join(work, 'examples/studio-session');
  mkdirSync(join(work, 'examples'));
  cpSync(join(ROOT, 'examples/studio-session'), session, {
    recursive:true, filter:file => !['.folio','__pycache__'].includes(basename(file)),
  });
  symlinkSync(join(ROOT, 'tools'), join(work, 'tools'), 'dir');
  const file = join(session, 'designed.json');
  workflow('design', '--brief', join(session, 'brief.md'), '--catalog', join(session, 'catalog.json'),
    '--proposal', join(session, 'proposal.json'), '--out', file);
  assert.deepEqual(read(file), read(join(session, 'workflow.json')));
  const graph = execFileSync(process.execPath, [join(ROOT, 'src/cli.mjs'), 'workflow', 'graph', file], {encoding:'utf8'});
  assert.match(graph, /stage_direction --> stage_thumbnail/);
  assert.match(graph, /stage_review\["review · command · approval"\]/);
  assert.doesNotMatch(graph, /stage_picture --> stage_thumbnail/);
  const first = workflow('run', file);
  assert.equal(stage(first, 'evidence').state, 'complete');
  assert.equal(stage(first, 'story').state, 'awaiting-input');
  workflow('override', file, '--stage','story','--file',join(session, 'editorial/story.json'));
  const edited = workflow('run', file);
  assert.equal(stage(edited, 'review').state, 'awaiting-approval');
  assert.equal(stage(edited, 'delivery').state, 'blocked');
  const review = read(stage(edited, 'review').artifacts.review.path);
  assert.ok(review.audioCorrelation > .98);
  assert.deepEqual(review.coverPixels, [1280, 720]);
  workflow('approve', file, '--stage', 'review', '--revision', stage(edited, 'review').revision);
  const approved = workflow('run', file, '--stage', 'delivery');
  const replay = workflow('run', file, '--stage', 'delivery');
  for (const row of approved.stages) assert.equal(stage(replay, row.id).revision, row.revision);
  const dir = join(work, 'editions', 'first');
  workflow('export', file, '--stage', 'delivery', '--dir', dir);
  execFileSync('python3', ['-c', [
    'import hashlib, json, sys, zipfile',
    'with zipfile.ZipFile(sys.argv[1]) as z:',
    '  entries = json.loads(z.read("manifest.json"))["files"]',
    '  assert {"cut.mp4","cover.png","captions.vtt","project/interview.wav","project/story.json","review.json"} <= set(entries)',
    '  assert all(hashlib.sha256(z.read(p)).hexdigest() == e["sha256"] for p,e in entries.items())',
  ].join('\n'), join(dir, 'listening-session.zip')]);
});

test('a fractional final video frame keeps the end of the performance in the generated edit', t => {
  const dir = temporary(t), example = join(ROOT, 'examples/renderers');
  const performance = join(dir,'take.wav'), plate = join(dir,'plate.mp4');
  execFileSync('ffmpeg',['-nostdin','-v','error','-i',join(example,'performance.wav'),'-af','apad=pad_dur=0.01',performance]);
  execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=orange:s=320x180:r=24',
    '-frames:v','25','-c:v','libx264','-pix_fmt','yuv420p',plate]);
  const inputs = {direction:join(example,'direction.json'), alignment:join(example,'alignment.json'),take:performance};
  const outputs = {cues:join(dir,'cues.json'),edl:join(dir,'edit.json')};
  execFileSync(process.execPath, [join(ROOT,'tools/workflow/cue-sheet.mjs')], {
    input:JSON.stringify({inputs, outputs, settings:{fps:24,size:[320,180]}}),
  });
  assert.equal(read(outputs.cues).shots[0].frames,25);
  assert.equal(read(outputs.edl).selects[0].frames,25);
  const cut = {movie:join(dir,'cut.mp4'),captions:join(dir,'cut.vtt'),timeline:join(dir,'cut.json')};
  execFileSync('python3',[join(ROOT,'tools/workflow/edit.py')], {
    input:JSON.stringify({inputs:{edl:outputs.edl,performance,plate},outputs:cut}),
  });
  assert.equal(read(cut.timeline).frames,25);
  const probe = JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',cut.movie]));
  assert.equal(Number(probe.streams.find(s=>s.codec_type==='video').nb_frames),25);
  assert.ok(Number(probe.streams.find(s=>s.codec_type==='audio').duration) >= 1.01);
});
