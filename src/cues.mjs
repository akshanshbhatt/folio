// The same timed state drives the native and browser renderers and survives seeking.
import {safeId} from './common.mjs';
import {progress} from './motion.mjs';

const center = [500, 410];
const curves = ['linear', 'smooth', 'smoother', 'out-cubic'];
const wordPattern = /[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu;
const words = text => Array.from(text.matchAll(wordPattern), match => ({
  text: match[0], start: match.index, end: match.index + match[0].length
}));
const space = text => text.trim().replace(/\s+/gu, ' ');
const rowsText = rows => rows.flatMap(r => words(r.text).map(w => w.text.toLowerCase()));
const same = (a,b) => a.length === b.length && a.every((v,i) => v === b[i]);
const unit = x => Number.isFinite(x) && x >= 0 && x <= 1;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const issue = (shot, text) => Error(shot.id + ': ' + text);

export function quoteRange(shot, at) {
  const query = space(at.quote);
  const scriptWords = words(shot.voice), wanted = words(query);
  if (!wanted.length) throw issue(shot, 'quote needs spoken words');
  const matches = [];
  for (let i = 0; i <= scriptWords.length - wanted.length; i++) {
    if (!wanted.every((w,j) => w.text === scriptWords[i + j].text)) continue;
    const start = scriptWords[i].start - wanted[0].start;
    const end = scriptWords[i + wanted.length - 1].end + query.length - wanted.at(-1).end;
    if (start >= 0 && space(shot.voice.slice(start, end)) === query)
      matches.push({first:i, after:i + wanted.length, start, end});
  }
  if (!matches.length) throw issue(shot, 'quote does not match the script: ' + query);
  if (matches.length > 1 && at.occurrence === undefined)
    throw issue(shot, 'ambiguous quote; specify its 1-based occurrence: ' + query);
  const range = matches[(at.occurrence ?? 1) - 1];
  if (!range) throw issue(shot, 'quote occurrence does not exist: ' + query);
  return range;
}

export function validateDirection(shot) {
  const objects = shot.objects ?? {}, actions = shot.actions ?? [];
  if (!record(objects) || !Array.isArray(actions)) throw issue(shot, 'objects must be a map and actions an array');
  for (const [id, obj] of Object.entries(objects)) {
    if (!safeId(id) || !record(obj) || !Array.isArray(obj.anchor) || obj.anchor.length !== 2 ||
        !obj.anchor.every(Number.isFinite) || obj.anchor[0] < 0 || obj.anchor[0] > 1000 ||
        obj.anchor[1] < 0 || obj.anchor[1] > 820 || !unit(obj.opacity ?? 1))
      throw issue(shot, 'object needs an artboard anchor and valid initial opacity: ' + id);
    if (obj.properties !== undefined && (!record(obj.properties) ||
        !Object.entries(obj.properties).every(([name,value]) => safeId(name) && Number.isFinite(value))))
      throw issue(shot, 'object properties must be named finite numbers: ' + id);
  }
  const ids = new Set();
  for (const a of actions) {
    if (!record(a) || !safeId(a.id) || ids.has(a.id)) throw issue(shot, 'invalid or duplicate action ID');
    ids.add(a.id);
    if (!['pan','zoom','reveal','animate'].includes(a.type)) throw issue(shot, 'unknown action type: ' + a.type);
    if ((a.type !== 'zoom' || a.target !== undefined) && !Object.hasOwn(objects,a.target))
      throw issue(shot, 'unknown action target for ' + a.id);
    if (a.type === 'zoom' && !(Number.isFinite(a.scale) && a.scale > 0)) throw issue(shot, 'zoom needs a positive scale');
    if (a.type === 'reveal' && !unit(a.opacity ?? 1)) throw issue(shot, 'reveal opacity must be between 0 and 1');
    if (a.type === 'animate' && (!Object.hasOwn(objects[a.target].properties ?? {}, a.property) || !Number.isFinite(a.to)))
      throw issue(shot, 'animate needs a declared object property and a numeric destination');
    const bezier = Array.isArray(a.curve) && a.curve.length === 4 && a.curve.every(unit);
    if (a.curve !== undefined && !curves.includes(a.curve) && !bezier)
      throw issue(shot, 'choose a named curve or four cubic Bezier coordinates between 0 and 1');
    if (a.duration !== undefined && !(Number.isFinite(a.duration) && a.duration >= 0)) throw issue(shot, 'invalid action duration');
    const at = a.at;
    if (!record(at) || (at.quote !== undefined) === (at.mark !== undefined) ||
        !['start','end'].includes(at.edge ?? 'start') || !Number.isFinite(at.offset ?? 0))
      throw issue(shot, 'action needs one quote or mark, a valid edge and a finite offset');
    if (at.quote !== undefined) {
      if (typeof at.quote !== 'string' || !at.quote.trim() ||
          (at.occurrence !== undefined && !(Number.isSafeInteger(at.occurrence) && at.occurrence >= 1)))
        throw issue(shot, 'invalid quote or occurrence');
      quoteRange(shot, at);
    } else if (!safeId(at.mark) || at.occurrence !== undefined) throw issue(shot, 'invalid named mark');
  }
}

// Synthesize each selected phrase as a real clip. Punctuation stays with its
// preceding word, preserving the full display text and normal sentence pauses.
export function speechSegments(shot, sentences) {
  const selected = (shot.actions ?? []).filter(a => a.at.quote !== undefined);
  const boundaries = new Set();
  for (const a of selected) {
    const range = quoteRange(shot,a.at);
    boundaries.add(range.first);
    boundaries.add(range.after);
  }
  let position = 0;
  return sentences.map(sentence => {
    const terms = words(sentence);
    const cuts = [0, ...terms.flatMap((w,i) => i > 0 && boundaries.has(position+i) ? [w.start] : []), sentence.length];
    position += terms.length;
    return cuts.slice(0,-1).map((start,i) => sentence.slice(start,cuts[i+1]).trim());
  });
}

function measuredRows(script, rows) {
  const expected = words(script).map(w => w.text.toLowerCase());
  if (!same(expected, rowsText(rows))) return null;
  const starts = new Map(), ends = new Map();
  let i = 0;
  for (const row of rows) {
    const n = words(row.text).length;
    if (!n) continue;
    starts.set(i,row.start); i += n; ends.set(i,row.end);
  }
  return {starts,ends};
}

export function measuredSentences(shot, timing, sentences) {
  const indexes = [timing.spans,timing.words].filter(Boolean).map(rows => measuredRows(shot.voice,rows)).filter(Boolean);
  let first = 0;
  return sentences.map(sentence => {
    const after = first + words(sentence).length;
    const start = indexes.find(idx => idx.starts.has(first))?.starts.get(first);
    const end = indexes.find(idx => idx.ends.has(after))?.ends.get(after);
    first = after;
    return {start,end};
  });
}

const frameAt = (time, fps) => Math.ceil(time * fps - 1e-9);
export function resolveActions(shot, timing, {lead,frames,fps}) {
  const result = [], indexes = [];
  for (const rows of [timing.words,timing.spans]) {
    if (rows) {
      const index = measuredRows(shot.voice,rows);
      if (index) indexes.push(index);
    }
  }
  for (const action of shot.actions ?? []) {
    const at = action.at;
    let source;
    if (at.mark) {
      const span = timing.marks?.find(m => m.id === at.mark);
      if (!span) throw issue(shot, 'missing take mark: ' + at.mark);
      source = {kind:'mark',mark:at.mark,start:span.start,end:span.end};
    } else {
      const {first,after} = quoteRange(shot,at);
      const index = indexes.find(idx => idx.starts.has(first) && idx.ends.has(after));
      if (!index) throw issue(shot, 'no measured boundaries for "'+at.quote+'"; supply matching timed words, phrase rows or a named mark');
      source = {kind:'quote',text:at.quote,occurrence:at.occurrence ?? 1,start:index.starts.get(first),end:index.ends.get(after)};
    }
    const start = lead + source[at.edge ?? 'start'] + (at.offset ?? 0);
    const end = start + (action.duration ?? source.end - source.start);
    if (start < 0 || frameAt(start,fps) >= frames || end > frames/fps + 1e-9)
      throw issue(shot, 'action falls outside the shot: ' + action.id + '; adjust its offset, duration or hold');
    result.push({...action,curve:action.curve ?? 'smooth',source,start,end,startFrame:frameAt(start,fps),endFrame:frameAt(end,fps)});
  }
  return result.sort((a,b) => a.start-b.start);
}

export function cueState(shot, time) {
  const objects = Object.fromEntries(Object.entries(shot.objects ?? {}).map(([id,obj]) =>
    [id,{anchor:obj.anchor,opacity:obj.opacity ?? 1,...(obj.properties ? {properties:{...obj.properties}} : {})}]));
  const actions = {}, tracks = new Map();
  function value(track,t) {
    if (!track) return undefined;
    const {from,to,event} = track;
    const f = event.end === event.start ? 1 : progress((t-event.start)/(event.end-event.start),event.curve);
    return from.map((v,i) => v+(to[i]-v)*f);
  }
  function set(key,to,initial,event) {
    tracks.set(key,{from:value(tracks.get(key),event.start) ?? initial,to,event});
  }
  for (const event of shot.resolvedActions ?? []) {
    const {id,type,target,start,end} = event;
    const active = time >= start;
    actions[id] = {progress:!active ? 0 : end === start ? 1 : progress((time-start)/(end-start),event.curve),
      status:!active ? 'pending' : time < end ? 'active' : 'complete'};
    if (!active) continue;
    if (type === 'pan' || (type === 'zoom' && target)) set('pan',objects[target].anchor,center,event);
    if (type === 'zoom') set('zoom',[event.scale],[1],event);
    if (type === 'animate') {
      const key = 'property:' + target + ':' + event.property;
      set(key, [event.to], [objects[target].properties[event.property]], event);
    }
    if (type === 'reveal') set('opacity:'+target,[event.opacity ?? 1],[objects[target].opacity],event);
  }
  for (const [id,obj] of Object.entries(objects)) {
    obj.opacity = value(tracks.get('opacity:'+id),time)?.[0] ?? obj.opacity;
    for (const property of Object.keys(obj.properties ?? {})) {
      const track = tracks.get('property:' + id + ':' + property);
      if (track) obj.properties[property] = value(track, time)[0];
    }
  }
  return {objects,actions,camera:{focus:value(tracks.get('pan'),time) ?? center,scale:value(tracks.get('zoom'),time)?.[0] ?? 1}};
}

export function applyCueCamera(ctx, {focus,scale}) {
  ctx.translate(...center);
  ctx.scale(scale,scale);
  ctx.translate(-focus[0],-focus[1]);
}
