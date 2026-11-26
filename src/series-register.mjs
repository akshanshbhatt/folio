import {readFileSync, realpathSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {json, safeId} from './common.mjs';
import {withLock} from './integrity.mjs';
import {localPath, realFile, replaceJson, stamp} from './project-file.mjs';
import {resolveAssets} from './series-assets.mjs';

const need = (ok, message) => { if (!ok) throw Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const fields = ['file','roles','source','credit','rights','redistribute'];
const keys = ['asset','variant','revision','representation'];

function acceptFields(doc, allowed, label) {
  need(object(doc),label+' must be an object');
  for (const field of Object.keys(doc)) need(allowed.includes(field),'Unknown '+label+' field: '+field);
}

// Defaults and policy on existing records remain authoritative when a sibling is added.
function entry(index, name, initial) {
  need(object(index),'Expected a registry index');
  if (!Object.hasOwn(index,name)) Object.defineProperty(index,name,{value:initial,writable:true,configurable:true,enumerable:true});
  need(object(index[name]),'Invalid existing registry entry: '+name);
  return index[name];
}

function registeredSource(root, manifest, record) {
  need(text(record.source),'Describe who supplied or created the file in source');
  const file = localPath(record.file,'Registered file');
  const source = realFile(root,file);
  need(source !== manifest,'A production manifest cannot contain its own asset bytes');
  const result = {file,...stamp(source)};
  for (const field of fields) if (Object.hasOwn(record,field)) result[field] = record[field];
  return result;
}

export async function registerAsset(file, options) {
  need(text(options.record),'Supply --record FILE');
  const manifest = realpathSync(file), root = dirname(manifest);
  return withLock(join(root,'.folio','series-edit.lock'),() => {
    const before = readFileSync(manifest), series = JSON.parse(before);
    need(series.version === 1 && safeId(series.id),'Expected series version 1 and a series ID');
    const record = json(options.record);
    acceptFields(record,['version',...keys,...fields,'controls','dependencies'],'asset intake');
    need(record.version === 1 && keys.every(key => safeId(record[key])),'Supply version 1 and an asset, variant, revision and representation ID');
    need(Array.isArray(record.roles) && record.roles.length && record.roles.every(safeId)
      && new Set(record.roles).size === record.roles.length,'Register explicit, distinct recipient roles');
    const {asset,variant,revision,representation,roles} = record;
    const def = entry(series.assets ??= {},asset,{variants:{}});
    const state = entry(def.variants,variant,{defaultRevision:revision,revisions:{}});
    const design = entry(state.revisions,revision,{representations:{}});
    need(object(design.representations) && !Object.hasOwn(design.representations,representation),
      'Representation already registered or invalid revision. Supply a fresh revision or representation ID.');
    const selected = registeredSource(root,manifest,record);
    if (record.controls !== undefined) selected.controls = record.controls;
    if (record.dependencies !== undefined) {
      need(Array.isArray(record.dependencies),'Dependencies must be an array');
      selected.dependencies = record.dependencies.map(dep => {
        acceptFields(dep,fields,'dependency');
        return registeredSource(root,manifest,dep);
      });
    }
    entry(design.representations,representation,selected);
    // Apply the same role, controls, rights and dependency checks used by a real shot.
    const shot = {uses:[{asset,variant,revision,representation,roles}]};
    for (const role of roles) resolveAssets(root,series,shot,{},role);
    replaceJson(manifest,before,series);
    return {series:series.id,asset,variant,revision,representation,defaultRevision:state.defaultRevision,
      source:{file:selected.file,bytes:selected.bytes,sha256:selected.sha256},
      dependencies:(selected.dependencies ?? []).map(({file,bytes,sha256}) => ({file,bytes,sha256}))};
  });
}
