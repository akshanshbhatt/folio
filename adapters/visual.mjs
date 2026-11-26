#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {dirname, extname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const roles = {hyperframes: 'composition', blender: 'scene', import: 'media'};
const adapterDir = dirname(fileURLToPath(import.meta.url));

function run(command, args, options = {}) {
  const {capture, ...rest} = options;
  const result = spawnSync(command, args, {
    encoding: 'utf8', stdio: ['ignore', capture ? 'pipe' : 2, 2], ...rest
  });
  if (result.error) throw Error(`Cannot run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw Error(`${command} exited with ${result.signal || result.status}`);
  return result.stdout;
}

function probe(file) {
  const raw = run('ffprobe', ['-v', 'error', '-select_streams', 'V:0',
    '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,r_frame_rate,duration,nb_frames:format=format_name',
    '-of', 'json', file], {capture: true});
  const {streams, format} = JSON.parse(raw);
  if (!streams?.[0]?.width || !streams[0].height) throw Error('No decodable video stream in ' + file);
  return {...streams[0], format: format.format_name};
}

function inputFile(request, role, base) {
  const value = request.inputs?.[role];
  if (typeof value !== 'string' || !value.trim()) throw Error('Missing input role: ' + role);
  const path = resolve(base, value);
  if (!statSync(path, {throwIfNoEntry: false})?.isFile()) throw Error('Missing input file: ' + path);
  return path;
}

function readCues(request, base) {
  if (!request.inputs?.cues) return null;
  const timeline = JSON.parse(readFileSync(inputFile(request, 'cues', base), 'utf8'));
  const shots = timeline.shots?.filter(s => !request.settings?.shot || s.id === request.settings.shot);
  if (shots?.length !== 1) throw Error('Choose exactly one timeline shot with settings.shot');
  const [shot] = shots;
  if (!Number.isFinite(timeline.fps) || timeline.fps <= 0 || !Number.isSafeInteger(shot.frames) || shot.frames <= 0)
    throw Error('The timeline needs a positive fps and frame count');
  const offset = shot.startFrame ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw Error('Invalid shot startFrame');
  const ids = new Set();
  const frameAt = seconds => Math.ceil(seconds * timeline.fps - 1e-9);
  const actions = (shot.actions ?? []).map(event => {
    if (!event.id || ids.has(event.id) || !Number.isFinite(event.start) || !Number.isFinite(event.end)
        || event.start < 0 || event.end < event.start || event.end > shot.frames / timeline.fps + 1e-9)
      throw Error('Invalid or duplicate resolved cue in ' + shot.id);
    ids.add(event.id);
    const startFrame = frameAt(event.start), endFrame = frameAt(event.end);
    if (startFrame >= shot.frames || endFrame > shot.frames) throw Error('Cue outside the shot: ' + event.id);
    const bounds = {startFrame, endFrame, filmStartFrame: offset + startFrame, filmEndFrame: offset + endFrame};
    for (const [key, expected] of Object.entries(bounds)) {
      if (event[key] !== undefined && event[key] !== expected)
        throw Error(`Cue ${event.id} has ${key} inconsistent with its resolved seconds`);
    }
    return {...event, ...bounds};
  });
  return {id: shot.id, fps: timeline.fps, frames: shot.frames, duration: shot.frames / timeline.fps,
    objects: shot.objects ?? {}, actions};
}

// Only expand numeric cue tokens. Leave all other HTML, including JS templates, intact.
function composeHTML(html, cues) {
  return html.replace(/\{\{(shot|cue)\.([^{}]*?)\}\}/g, (token, scope, path) => {
    if (!cues) throw Error('Composition token requires inputs.cues: ' + token);
    if (scope === 'shot' && ['duration', 'frames', 'fps'].includes(path)) return String(cues[path]);
    const [id, field, extra] = path.split('.');
    const action = cues.actions.find(a => a.id === id);
    if (scope !== 'cue' || !action || extra) throw Error('Unknown composition token: ' + token);
    const values = {start: action.start, end: action.end, duration: action.end - action.start,
      remaining: cues.duration - action.start, startFrame: action.startFrame, endFrame: action.endFrame};
    if (!Object.hasOwn(values, field) || !Number.isFinite(values[field])) throw Error('Unknown cue field: ' + token);
    return String(values[field]);
  });
}

function stageAssets(request, base, root) {
  for (const [role, name] of Object.entries(request.settings?.assets ?? {})) {
    const dest = typeof name === 'string' && resolve(root, name);
    if (!dest || isAbsolute(name) || !relative(root, dest) || relative(root, dest).split(/[\\/]/)[0] === '..')
      throw Error('Asset path must stay inside the render project: ' + name);
    if (existsSync(dest)) throw Error('Duplicate staged asset: ' + name);
    mkdirSync(dirname(dest), {recursive: true});
    copyFileSync(inputFile(request, role, base), dest);
  }
}

function hyperframes(ctx) {
  const {request, source, base, project, output, cues, settings} = ctx;
  if (!/\.html?$/i.test(source)) throw Error('HyperFrames needs an HTML composition');
  writeFileSync(join(project, 'index.html'), composeHTML(readFileSync(source, 'utf8'), cues));
  stageAssets(request, base, project);
  const args = ['render', project, '--output', output, '--format', 'mp4', '--workers', '1', '--quiet'];
  if (settings.fps || cues) args.push('--fps', String(settings.fps ?? cues.fps));
  if (settings.quality) args.push('--quality', settings.quality);
  run(settings.executable || process.env.FOLIO_HYPERFRAMES_BIN || 'hyperframes', args,
    {cwd: project, env: {...process.env, HYPERFRAMES_NO_TELEMETRY: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1'}});
}

function blender(ctx) {
  const {request, source, base, root, project, output, cues, settings} = ctx;
  const ext = extname(source).toLowerCase();
  if (!['.blend', '.py'].includes(ext)) throw Error('Blender needs a .blend project or a scene-building .py file');
  const staged = join(project, 'scene' + ext);
  copyFileSync(source, staged);
  stageAssets(request, base, project);
  const frames = join(root, 'frames');
  mkdirSync(frames);
  const env = {...process.env, FOLIO_FRAME_DIR: frames};
  delete env.FOLIO_CUES_FILE;
  if (cues) {
    env.FOLIO_CUES_FILE = join(root, 'resolved-cues.json');
    writeFileSync(env.FOLIO_CUES_FILE, JSON.stringify(cues));
  }
  const args = ['--background', '--factory-startup', '--disable-autoexec', '--threads', '2', '--python-exit-code', '1'];
  args.push(...(ext === '.py' ? ['--python', staged] : [staged]), '--python', join(adapterDir, 'blender-export.py'));
  run(settings.executable || process.env.FOLIO_BLENDER_BIN || 'blender', args, {cwd: project, env});
  const {rate, count} = JSON.parse(readFileSync(join(frames, 'sequence.json'), 'utf8'));
  run('ffmpeg', ['-nostdin', '-v', 'error', '-framerate', rate, '-start_number', '0',
    '-i', join(frames, 'plate-%08d.png'), '-frames:v', String(count), '-an',
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output]);
}

function importMedia({source, settings, output, cues}) {
  const input = probe(source);
  const isStill = input.format === 'image2' || input.format.endsWith('_pipe');
  if (isStill && !(settings.duration > 0)) throw Error('A still image requires a duration in seconds');
  const start = settings.start ?? 0, fps = settings.fps ?? cues?.fps;
  if (!isStill && settings.duration !== undefined && start + settings.duration > Number(input.duration) + .001)
    throw Error('The source does not cover the requested duration');
  const args = ['-nostdin', '-v', 'error'];
  if (isStill) args.push('-loop', '1', '-framerate', String(fps ?? 30));
  else if (start > 0) args.push('-ss', String(start), '-noaccurate_seek');
  args.push('-i', source);
  if (settings.duration !== undefined) args.push('-t', String(settings.duration));
  const filters = ['pad=ceil(iw/2)*2:ceil(ih/2)*2'];
  if (fps || (!isStill && start > 0)) {
    // Sample the held picture at the in-point, even when its timestamp precedes the cut.
    const rate = fps ?? (input.avg_frame_rate === '0/0' ? input.r_frame_rate : input.avg_frame_rate);
    filters.unshift('fps=fps=' + rate + ':start_time=0:round=up');
  }
  run('ffmpeg', [...args, '-map', '0:V:0', '-an', '-vf', filters.join(','), '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output]);
}

function main() {
  const [kind, flag, filename, ...extra] = process.argv.slice(2);
  if (kind === '--help' || kind === '-h') {
    console.log('Usage: folio-visual hyperframes|blender|import [--request FILE.json]\n' +
      'Read a workflow request from stdin or a file. Set outputs.video to a new MP4 path.');
    return;
  }
  if (!Object.hasOwn(roles, kind) || extra.length || (flag !== undefined && (flag !== '--request' || !filename)))
    throw Error('Usage: visual.mjs hyperframes|blender|import [--request FILE.json]');
  const base = filename ? dirname(resolve(filename)) : process.cwd();
  const request = JSON.parse(readFileSync(filename ? resolve(filename) : 0, 'utf8'));
  const settings = request.settings ?? {};
  const source = inputFile(request, roles[kind], base);
  const path = request.outputs?.video;
  if (typeof path !== 'string' || extname(path).toLowerCase() !== '.mp4') throw Error('outputs.video must name an MP4 file');
  const dest = resolve(base, path);
  if (existsSync(dest)) throw Error('Output already exists: ' + dest);
  for (const key of ['start', 'duration', 'fps']) {
    if (settings[key] !== undefined && (!Number.isFinite(settings[key]) || (key === 'start' ? settings[key] < 0 : settings[key] <= 0)))
      throw Error('Invalid ' + key);
  }
  const cues = readCues(request, base);
  if (cues && settings.fps && settings.fps !== cues.fps) throw Error('Output fps must match the selected timeline');
  mkdirSync(dirname(dest), {recursive: true});
  const root = mkdtempSync(join(dirname(dest), '.visual-'));
  try {
    const project = join(root, 'project'), output = join(root, 'plate.mp4');
    mkdirSync(project);
    ({hyperframes, blender, import: importMedia})[kind]({request, source, base, root, project, output, settings, cues});
    const media = probe(output);
    if (!(Number(media.duration) > 0)) throw Error('Render produced an empty plate');
    if (kind === 'import' && settings.duration !== undefined) {
      const [n, d] = media.avg_frame_rate.split('/').map(Number);
      if (Math.abs(Number(media.duration) - settings.duration) > d / n + 1e-6)
        throw Error('The source does not cover the requested duration');
    }
    if (cues && (Number(media.nb_frames) !== cues.frames || Math.abs(Number(media.duration) - cues.duration) > .5 / cues.fps))
      throw Error('Rendered frame count or duration differs from the selected timeline');
    linkSync(output, dest);
    console.log(JSON.stringify({video: dest, codec: media.codec_name, width: media.width, height: media.height,
      seconds: Number(media.duration), frames: Number(media.nb_frames)}));
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
}

try { main(); } catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
