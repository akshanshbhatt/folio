// Project-local command adapter. Folio supplies one frozen role context per department.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ff, inside, json, probe, write } from '../../src/common.mjs';
import { pcm, wav } from '../../src/speech.mjs';
import { encodeShot } from '../../src/video.mjs';
import { makeFrame } from './draw.mjs';

const req = JSON.parse(readFileSync(0, 'utf8'));
const { inputs, outputs } = req;
const story = json(inputs.story);
const report = inputs.seriesContext && json(inputs.seriesContext);
const rate = 24000;
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
function requireValue(condition, message) { if (!condition) throw Error(message); }

function selectedAsset(context, id) {
  const item = context.assets.find(a => a.asset === id);
  requireValue(item, 'Missing selected asset ' + id);
  const file = inside(req.seriesRoot, item.path);
  requireValue(sha(file) === item.sha256, 'Frozen source bytes differ for ' + item.path);
  return { item, file };
}
function roleFor(id, role) {
  const ctx = report.shots.find(s => s.id === id)?.roles[role];
  requireValue(ctx, 'Missing ' + role + ' context for ' + id);
  return ctx;
}
function honorBeat(context, choices) {
  for (const beat of context.script ?? []) {
    for (const [key, field] of Object.entries(beat.fields)) {
      if (!Object.hasOwn(choices, key)) continue;
      const value = choices[key];
      requireValue(field.state !== 'fixed' || value === field.value,
        'Protected ' + key + ' conflicts with ' + beat.source);
      requireValue(field.state !== 'omitted' || value == null,
        'Restore the omitted ' + key + ' in the approved beat before using it');
    }
  }
}
function sample(frame, fps) { return Math.round(frame * rate / fps); }
function waveform(file) {
  const take = pcm(file);
  requireValue(take.rate === rate, 'Supply 24 kHz mono PCM16 WAV, or conform the take before intake.');
  return take.bytes;
}
function performance(shot, fps) {
  if (!shot.voice) return null;
  requireValue(!shot.silent && inputs.take && shot.voice.text && Number.isInteger(shot.voice.atFrame) &&
    shot.voice.atFrame >= 0, 'Spoken shot needs an approved take, text and entrance frame');
  requireValue(inputs.transcript && readFileSync(inputs.transcript, 'utf8').trim() === shot.voice.text,
    'The script must match the words in the supplied performance transcript');
  const bytes = waveform(inputs.take);
  const offset = sample(shot.voice.atFrame, fps);
  requireValue(offset + bytes.length / 2 <= sample(shot.frames, fps), 'The supplied performance overruns ' + shot.id);
  return { bytes, offset, sha256: sha(inputs.take) };
}
function mouthAt(take, frame, fps) {
  if (!take) return 0;
  const a = Math.max(0, sample(frame, fps) - take.offset);
  const b = Math.min(take.bytes.length / 2, sample(frame + 1, fps) - take.offset);
  if (b <= a) return 0;
  let sum = 0;
  for (let n = a; n < b; n++) sum += (take.bytes.readInt16LE(2 * n) / 32768) ** 2;
  return Math.min(1, 8 * Math.sqrt(sum / (b - a)));
}

async function picture() {
  const shot = story.shots.find(s => s.id === req.stage);
  requireValue(shot && Number.isInteger(shot.frames) && shot.frames > 0 &&
    ['inspect', 'mend', 'speak', 'hold', 'offer'].includes(shot.acting), 'Unsupported acting or duration for ' + req.stage);
  const ctx = roleFor(shot.id, 'animator');
  const controls = Object.fromEntries(['fps', 'camera', 'cadence', 'eyebrow'].map(k => [k, ctx.decisions[k].value]));
  const { fps, camera, cadence, eyebrow } = controls;
  requireValue(Number.isInteger(fps) && fps > 0 && Number.isInteger(cadence) && cadence > 0, 'Invalid delivery or pose cadence');
  requireValue(['raised', 'rest'].includes(eyebrow), 'Unknown eyebrow pose');
  requireValue(!shot.lockedCamera || camera === shot.lockedCamera, 'Camera conflicts with the supplied board for ' + shot.id);
  requireValue(!shot.lockedBrow || eyebrow === shot.lockedBrow, 'Eyebrow conflicts with the supplied board for ' + shot.id);
  honorBeat(ctx, { durationFrames: shot.frames, camera, eyebrow });
  const rig = ['kitchen', 'cast', 'mug'].map(key => selectedAsset(ctx, key));
  const paint = makeFrame(...rig.map(a => json(a.file)));
  const take = performance(shot, fps);
  function stage(c, view) {
    const frame = Math.round(view.time * fps);
    const drawing = paint({ ...controls, acting: shot.acting, frame, frames: shot.frames, mouth: mouthAt(take, frame, fps) });
    c.drawImage(drawing, 0, 0, view.width, view.height);
  }
  await encodeShot({
    channel: req.project, e: { format: 'long' }, brand: { theme: { paper: '#447674' } },
    shot: { id: shot.id, continuous: true, component: 'kitchen', motion: 0 }, draw() {},
    width: 960, height: 540, fps, frames: shot.frames, profile: 'review', cues: [], burn: false,
    plugins: { stage }, output: outputs.plate,
  });
  write(outputs.receipt, { id: shot.id, frames: shot.frames, acting: shot.acting, ...controls,
    decisions: ctx.decisions, facts: ctx.facts, board: ctx.board, script: ctx.script, takeSha256: take?.sha256 ?? null,
    assets: rig.map(a => a.item), pictureSha256: sha(outputs.plate) });
}

function mix() {
  let start = 0, deliveryRate;
  const chunks = [], sheet = [];
  for (const shot of story.shots) {
    const ctx = roleFor(shot.id, 'mixer'), fps = ctx.decisions.fps.value;
    requireValue(Number.isInteger(fps) && fps > 0 && (!deliveryRate || deliveryRate === fps), 'Conform all shots to one delivery rate');
    deliveryRate = fps;
    requireValue(ctx.decisions.dialogue.value !== 'silent' || !shot.voice, 'This shot requires room tone without dialogue');
    const { item, file } = selectedAsset(ctx, 'room'), room = waveform(file), take = performance(shot, fps);
    honorBeat(ctx, { durationFrames: shot.frames, dialogue: shot.voice?.text, bed: item.asset });
    const origin = sample(start, fps), count = sample(start + shot.frames, fps) - origin;
    const chunk = Buffer.alloc(count * 2);
    for (let n = 0; n < count; n++) {
      let value = room.readInt16LE(2 * ((origin + n) % (room.length / 2)));
      if (take && n >= take.offset && (n - take.offset) * 2 < take.bytes.length)
        value += take.bytes.readInt16LE((n - take.offset) * 2) * .91;
      chunk.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value))), 2 * n);
    }
    chunks.push(chunk);
    sheet.push({ id: shot.id, startFrame: start, frames: shot.frames, room: item,
      voice: take ? { ...shot.voice, startSample: origin + take.offset,
        endSample: origin + take.offset + take.bytes.length / 2, sha256: take.sha256 } : null });
    start += shot.frames;
  }
  writeFileSync(outputs.mix, wav(Buffer.concat(chunks), rate));
  write(outputs.sheet, { fps: deliveryRate, rate, frames: start, shots: sheet });
}

function cover() {
  const plate = json(inputs.receipt);
  requireValue(plate.id === story.coverShot && Number.isInteger(story.coverFrame) &&
    story.coverFrame >= 0 && story.coverFrame < plate.frames, 'Choose a cover frame on the connected cover plate');
  ff(['-i', inputs.plate, '-vf', 'select=eq(n\\,' + story.coverFrame + ')', '-frames:v', '1', outputs.cover]);
}

function timestamp(seconds) {
  return new Date(Math.round(1000 * seconds)).toISOString().slice(11, 23);
}
function cut() {
  const sheet = json(inputs.sheet);
  const scratch = mkdtempSync(join(tmpdir(), 'folio-kitchen-cut-'));
  const timeline = [], script = ['# ' + story.title, ''], direction = ['# Direction for ' + story.title, ''];
  const captions = ['WEBVTT', ''];
  try {
    for (const [i, shot] of story.shots.entries()) {
      const picture = json(inputs['receipt-' + shot.id]), sound = sheet.shots[i];
      requireValue(sound.id === picture.id && picture.frames === sound.frames && picture.fps === sheet.fps &&
        picture.pictureSha256 === sha(inputs['plate-' + shot.id]) && picture.takeSha256 === (sound.voice?.sha256 ?? null),
      'Picture and sound disagree for ' + shot.id);
      symlinkSync(inputs['plate-' + shot.id], join(scratch, i + '.mp4'));
      timeline.push({ ...picture, startFrame: sound.startFrame, room: sound.room, voice: sound.voice });
      script.push('## ' + shot.id, '', shot.voice ? shot.voice.speaker + ' — ' + shot.voice.text : '(No spoken dialogue.)', '');
      direction.push('## ' + shot.id, '', shot.direction, '', picture.frames + ' frames at ' + picture.fps +
        ' fps. Camera ' + picture.camera + '. Brow ' + picture.eyebrow + '.', '');
      if (sound.voice) {
        const v = sound.voice;
        captions.push(timestamp(v.startSample / rate) + ' --> ' + timestamp(v.endSample / rate), '<v ' + v.speaker + '>' + v.text, '');
      }
    }
    if (captions.length === 2) captions.push('NOTE No spoken dialogue.', '');
    const list = join(scratch, 'edit.txt');
    writeFileSync(list, timeline.map((_, i) => "file '" + i + ".mp4'").join('\n'));
    ff(['-f', 'concat', '-safe', '0', '-i', list, '-i', inputs.mix, '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', outputs.movie]);
    const video = probe(outputs.movie).streams.find(s => s.codec_type === 'video');
    requireValue(Number(video.nb_frames) === sheet.frames, 'Assembled frame count differs from the approved edit');
    copyFileSync(inputs.cover, outputs.cover);
    if (story.premise) script.splice(2, 0, story.premise, '');
    write(outputs.script, script.join('\n')); write(outputs.direction, direction.join('\n'));
    write(outputs.captions, captions.join('\n') + '\n');
    write(outputs.timeline, { episode: story.episode, title: story.title, source: story.source ?? 'Supplied story',
      fps: sheet.fps, frames: sheet.frames, soundSampleRate: rate, cover: { shot: story.coverShot, frame: story.coverFrame }, shots: timeline });
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

if (req.stage === 'sound') mix();
else if (req.stage === 'cover') cover();
else if (req.stage === 'cut') cut();
else await picture();
