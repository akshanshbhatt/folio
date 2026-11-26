// Resolve editorial ownership before sharing a script or accepting draft edits.
import {safeId} from './common.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (obj,key) => Object.hasOwn(obj,key);
const fieldName = key => typeof key === 'string' && /^[a-zA-Z][a-zA-Z0-9._-]*$/.test(key);
const text = value => typeof value === 'string' && value.trim().length > 0;
function need(ok,message) { if (!ok) throw Error(message); }

function byId(rows,label) {
  need(Array.isArray(rows), label + ' must be an array');
  const result = new Map();
  for (const row of rows) {
    need(object(row) && safeId(row.id) && !result.has(row.id), 'Invalid or duplicate ID in ' + label);
    result.set(row.id,row);
  }
  return result;
}

function visible(roles,role) {
  need(Array.isArray(roles) && roles.length && roles.every(safeId), 'Script beat needs explicit roles');
  return roles.includes(role);
}

function definition(series,episode) {
  const id = own(episode,'structure') ? episode.structure : series.structure;
  if (id == null) return new Map();
  need(safeId(id) && object(series.structures) && own(series.structures,id), 'Unknown script structure: ' + id);
  return byId(series.structures[id]?.beats, 'structure beats');
}

function fieldEntry(name,field,scope,source) {
  need(fieldName(name) && object(field) && ['open','fixed','omitted'].includes(field.state),
    'Invalid script field: ' + name);
  const hasValue = own(field,'value');
  need(field.state !== 'fixed' || hasValue, 'Fixed script field needs a value: ' + name);
  need(field.state !== 'omitted' || !hasValue, 'Omitted script field cannot carry a value: ' + name);
  if (hasValue) need(field.value !== undefined, 'Expected a script field value: ' + name);
  const record = {state:field.state, scope};
  if (source !== undefined) {
    need(text(source),'Script source must be nonempty text');
    record.source = source;
  }
  if (hasValue) record.value = structuredClone(field.value);
  return record;
}

function resolvedFields(template, authored, role) {
  const fields = new Map();
  for (const [scope,beat] of [['structure',template],['episode',authored]]) {
    if (!beat) continue;
    need(object(beat.fields ?? {}), 'Script fields must be an object');
    for (const [name,field] of Object.entries(beat.fields ?? {})) {
      need(object(field), 'Invalid script field: ' + name);
      // A private replacement also withdraws the old inherited field from
      // this handoff. Falling back here would give the writer stale copy.
      fields.delete(name);
      if (field.roles !== undefined && !visible(field.roles,role)) continue;
      fields.set(name,fieldEntry(name,field,scope,field.source ?? beat.source));
    }
  }
  return Object.fromEntries(fields);
}

export function scriptFor(series,episode,scene,shot,role) {
  need(safeId(role), 'Choose a valid script role');
  const defaults = definition(series,episode), changes = byId(episode.beats ?? [], 'episode beats');
  if (!defaults.size && !changes.size) return [];
  const shots = episode.scenes.flatMap(s => s.shots.map(item => item.id));
  need(shots.includes(shot.id) && scene.shots.some(item=>item.id === shot.id), 'Unknown script shot: ' + shot.id);
  const result = [];
  for (const id of new Set([...defaults.keys(), ...changes.keys()])) {
    const base = defaults.get(id), override = changes.get(id);
    const roles = override?.roles ?? base?.roles;
    if (!visible(roles,role)) continue;
    const template = base && visible(base.roles,role) ? base : undefined;
    const place = override?.place ?? base?.place ?? 'first';
    need(['first','last'].includes(place),'Unknown script beat placement: ' + place);
    const target = override?.shot ?? (place === 'first' ? shots[0] : shots.at(-1));
    need(shots.includes(target),'Unknown script beat shot: ' + target);
    if (target !== shot.id) continue;
    const state = override?.state ?? template?.state ?? 'active';
    need(['active','omitted'].includes(state),'Unknown script beat state: ' + state);
    const source = override?.source ?? template?.source;
    need(source === undefined || text(source),'Script source must be nonempty text');
    const fields = state === 'omitted' ? {} : resolvedFields(template,override,role);
    result.push({id,state,...(source === undefined ? {} : {source}),fields});
  }
  return result;
}

// A draft is a new role-scoped script handoff. The series, its episode file,
// and every previous accepted draft can remain independently editable.
export function applyDraft(report,draft,role) {
  need(safeId(role) && object(report) && Array.isArray(report.shots), 'Expected a resolved series report and role');
  need(object(draft) && Object.keys(draft).every(k=>k === 'edits') && Array.isArray(draft.edits),
    'A script draft must contain an edits array');
  const shots = byId(report.shots,'reported shots');
  const output = [];
  const scripts = new Map();
  for (const [id,shot] of shots) {
    if (!object(shot.roles) || !own(shot.roles,role)) continue;
    const packet = structuredClone(shot.roles[role]);
    const beats = byId(packet.script ?? [],'resolved script beats');
    scripts.set(id,beats);
    output.push({id,...(shot.scene ? {scene:shot.scene} : {}),roles:{[role]:packet}});
  }
  need(scripts.size,'No script handoff for role ' + role);
  const seen = new Set();
  for (const edit of draft.edits) {
    need(object(edit) && Object.keys(edit).every(k=>['shot','beat','field','value'].includes(k))
      && safeId(edit.shot) && safeId(edit.beat) && fieldName(edit.field) && own(edit,'value') && edit.value !== undefined,
    'Draft edits need shot, beat, field and value');
    const key = JSON.stringify([edit.shot,edit.beat,edit.field]);
    need(!seen.has(key),'Duplicate script edit: ' + key);
    seen.add(key);
    const beat = scripts.get(edit.shot)?.get(edit.beat);
    need(beat && beat.state === 'active' && object(beat.fields) && own(beat.fields,edit.field)
      && beat.fields[edit.field].state === 'open','Script field is unavailable for drafting: ' + key);
    beat.fields[edit.field].value = structuredClone(edit.value);
    beat.fields[edit.field].drafted = true;
  }
  return {version:report.version ?? 1,series:report.series,episode:report.episode,shots:output};
}

export function scriptView(report,role) {
  return {series:report.series,episode:report.episode,role,
    shots:report.shots.filter(s=>own(s.roles,role)).map(s=>({shot:s.id,beats:s.roles[role].script ?? []}))};
}
