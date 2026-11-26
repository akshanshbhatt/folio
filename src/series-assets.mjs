// Resolve the files a particular contributor can use. Edition archives have a
// separate sharing decision for each source and each dependency.
import {constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {dirname, extname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {digest, safeId} from './common.mjs';
import {localPath, realFile, stamp} from './project-file.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const own = (obj, key) => Object.hasOwn(obj, key);
const checksum = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const workflowRole = value => typeof value === 'string' && /^[a-z][a-zA-Z0-9_-]*$/.test(value);
const editionName = 'edition.json';

function need(condition, message) {
  if (!condition) throw Error(message);
}

function lookup(entries, key, kind) {
  need(safeId(key) && object(entries) && own(entries, key) && object(entries[key]),
    'Unknown ' + kind + ': ' + key);
  return entries[key];
}

function names(value, label, predicate = nonempty) {
  need(Array.isArray(value) && value.every(predicate) && new Set(value).size === value.length,
    'Invalid or duplicate names in ' + label);
  return value;
}

function permit(record, role) {
  if (record.roles !== undefined) {
    need(names(record.roles, 'allowed asset roles', safeId).includes(role),
      'This source is unavailable to role ' + role);
  }
}

function inspectSource(root, spec, role) {
  need(object(spec), 'Expected an asset file declaration');
  permit(spec, role);
  const path = localPath(spec.file, 'Asset file');
  need(spec.redistribute === undefined || typeof spec.redistribute === 'boolean',
    'redistribute must be true or false');
  for (const key of ['rights', 'credit', 'source']) {
    need(spec[key] === undefined || nonempty(spec[key]), 'Expected text for asset ' + key);
  }
  need(!spec.redistribute || nonempty(spec.rights), 'Shareable asset needs a rights statement: ' + path);
  const asset = {path, ...stamp(realFile(root, path)), redistribute: spec.redistribute === true};
  need(spec.sha256 === undefined || spec.sha256 === asset.sha256, 'Declared SHA-256 differs for ' + path);
  need(spec.bytes === undefined || spec.bytes === asset.bytes, 'Declared byte count differs for ' + path);
  for (const key of ['rights', 'credit', 'source']) if (spec[key] !== undefined) asset[key] = spec[key];
  return asset;
}

export function resolveAssets(root, series, shot, context, role) {
  need(safeId(role), 'Choose a valid asset handoff role');
  const uses = shot.uses ?? [];
  need(Array.isArray(uses), 'Shot uses must be an array');
  const result = [];
  for (const use of uses) {
    need(object(use) && Array.isArray(use.roles) && use.roles.length, 'A shot asset needs explicit roles');
    if (!names(use.roles, 'shot asset roles', safeId).includes(role)) continue;
    const def = lookup(series.assets, use.asset, 'asset');
    permit(def, role);
    need((use.variant !== undefined) !== (use.variantFrom !== undefined),
      'Choose exactly one variant or variantFrom for asset ' + use.asset);
    let variant = use.variant;
    if (use.variantFrom !== undefined) {
      need(nonempty(use.variantFrom), 'Expected a variant fact name');
      const facts = (context.facts ?? []).filter(f => f.fact === use.variantFrom);
      need(facts.length === 1, 'Expected one applicable story fact for ' + use.asset + ': ' + use.variantFrom);
      variant = facts[0].value;
    }
    const state = lookup(def.variants, variant, 'variant of ' + use.asset);
    const revision = use.revision ?? state.defaultRevision;
    const design = lookup(state.revisions, revision, 'revision of ' + use.asset + '/' + variant);
    const rep = lookup(design.representations, use.representation, 'representation of ' + use.asset);
    permit(state, role);
    permit(design, role);
    const selected = inspectSource(root, rep, role);
    const controls = names(rep.controls ?? [], 'representation controls');
    const required = names(use.requires ?? [], 'required controls');
    for (const control of required) {
      need(controls.includes(control), 'Missing control "' + control + '" on ' + use.asset + '/' + use.representation);
    }
    need(Array.isArray(rep.dependencies ?? []), 'Representation dependencies must be an array');
    const dependencies = (rep.dependencies ?? []).map(dep =>
      inspectSource(root, typeof dep === 'string' ? {file: dep} : dep, role));
    names([selected.path, ...dependencies.map(dep => dep.path)], 'source and dependencies');
    result.push({asset: use.asset, variant, revision, representation: use.representation,
      controls, requires: required, ...selected, dependencies});
  }
  return result;
}

function checkStamp(info) {
  need(object(info) && Number.isSafeInteger(info.bytes) && info.bytes >= 0 && checksum(info.sha256),
    'Invalid file size or SHA-256');
}

// Recheck the selected bytes at pin time, including files the archive can only
// reference. Native source trees retain paths so an artist can reopen them.
function archiveSource(tmp, root, source, include, archive) {
  checkStamp(source);
  const path = localPath(source.path, 'Selected source');
  const from = realFile(root, path);
  need(typeof source.redistribute === 'boolean', 'Missing source sharing decision: ' + path);
  const stat = statSync(from, {bigint:true});
  // Hard links can give one file several project-relative names.
  const identity = stat.dev + ':' + stat.ino;
  const previous = archive.permissions.get(identity);
  need(previous === undefined || previous === source.redistribute, 'Conflicting redistribution declarations: ' + path);
  archive.permissions.set(identity, source.redistribute);
  const actual = stamp(from);
  need(actual.sha256 === source.sha256 && actual.bytes === source.bytes, 'Source changed before edition pin: ' + path);
  const entry = {sha256: source.sha256, bytes: source.bytes};
  if (!include || !source.redistribute) return entry;
  need(source.redistribute === true && nonempty(source.rights), 'Missing permission to package ' + path);
  const file = 'sources/' + path;
  const output = join(tmp, file);
  if (!archive.files.has(file)) {
    mkdirSync(dirname(output), {recursive: true});
    copyFileSync(from, output, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
    archive.files.add(file);
  }
  entry.path = file;
  entry.rights = source.rights;
  if (source.credit) entry.credit = source.credit;
  if (source.source) entry.source = source.source;
  return entry;
}

function archiveSelection(tmp, root, item, archive) {
  for (const key of ['asset','variant','revision','representation']) {
    need(safeId(item[key]), 'Invalid pinned asset ' + key);
  }
  need(Array.isArray(item.dependencies), 'Missing pinned dependency list');
  return {asset:item.asset, variant:item.variant, revision:item.revision, representation:item.representation,
    ...archiveSource(tmp, root, item, true, archive),
    dependencies:item.dependencies.map(dep => archiveSource(tmp, root, dep, item.redistribute, archive))};
}

function archiveReport(tmp, root, report) {
  need(object(report) && safeId(report.series) && safeId(report.episode) && Array.isArray(report.shots),
    'A series edition needs a resolved episode report');
  names(report.shots.map(shot => shot.id), 'edition shot IDs', safeId);
  const archive = {files:new Set(), permissions:new Map()};
  return report.shots.map(shot => {
    need(object(shot.roles), 'Expected shot roles in edition report');
    const roles = Object.fromEntries(Object.entries(shot.roles).map(([role,packet]) => {
      need(safeId(role) && object(packet) && Array.isArray(packet.assets), 'Invalid role packet for ' + shot.id);
      return [role, {contextSha256: digest(packet), assets:packet.assets.map(item => archiveSelection(tmp, root, item, archive))}];
    }));
    if (shot.scene !== undefined) need(safeId(shot.scene), 'Invalid edition scene ID');
    return {id:shot.id, ...(shot.scene ? {scene:shot.scene} : {}), roles};
  });
}

function archiveDeliverables(tmp, files, exportRoot) {
  need(object(files), 'Declare edition deliverables by role');
  return Object.fromEntries(Object.entries(files).map(([role,source]) => {
    need(workflowRole(role) && typeof source === 'string' && isAbsolute(source), 'Invalid edition deliverable ' + role);
    const name = exportRoot === undefined ? role + extname(source) : relative(resolve(exportRoot),source).split(sep).join('/');
    const path = 'delivery/' + localPath(name, 'Deliverable destination');
    const from = exportRoot === undefined ? source : realFile(exportRoot, name);
    const original = stamp(from), output = join(tmp,path);
    mkdirSync(dirname(output), {recursive:true});
    copyFileSync(from, output, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
    return [role, {path,...original}];
  }));
}

function readInventory(root, subdir = '') {
  const result = [];
  for (const entry of readdirSync(join(root,subdir), {withFileTypes:true})) {
    const name = subdir ? subdir + '/' + entry.name : entry.name;
    if (entry.isDirectory()) result.push(...readInventory(root,name));
    else {
      need(entry.isFile(), 'Unexpected symbolic or special edition entry: ' + name);
      result.push(name);
    }
  }
  return result;
}

export function verifyEdition(dir, expectedRevision) {
  const contents = new Set(readInventory(dir));
  need(contents.delete(editionName), 'Missing edition manifest');
  const manifest = JSON.parse(readFileSync(join(dir,editionName),'utf8'));
  const {revision,...body} = manifest;
  need(manifest.version === 1 && checksum(revision) && revision === digest(body) &&
    (!expectedRevision || expectedRevision === revision), 'Edition manifest revision mismatch');
  need(safeId(manifest.series) && safeId(manifest.episode) && Array.isArray(manifest.shots) &&
    object(manifest.files), 'Invalid series edition');
  const visited = new Map();
  function check(file, folder, required) {
    checkStamp(file);
    if (!required && file.path === undefined) return;
    const path = localPath(file.path, 'Edition entry');
    need(path.startsWith(folder + '/'), 'Wrong edition directory: ' + path);
    if (!visited.has(path)) {
      need(contents.delete(path), 'Missing edition file: ' + path);
      visited.set(path, stamp(realFile(dir, path)));
    }
    const got = visited.get(path);
    need(got.bytes === file.bytes && got.sha256 === file.sha256, 'Edition file changed: ' + path);
  }
  for (const file of Object.values(manifest.files)) check(file,'delivery',true);
  for (const shot of manifest.shots) for (const packet of Object.values(shot.roles)) {
    need(checksum(packet.contextSha256), 'Invalid edition context digest');
    for (const asset of packet.assets) {
      check(asset, 'sources', false);
      for (const dep of asset.dependencies) check(dep, 'sources', false);
    }
  }
  need(!contents.size, 'Unexpected files in edition: ' + [...contents].join(', '));
  return manifest;
}

function workflowReceipt(workflow) {
  need(object(workflow) && safeId(workflow.id) && safeId(workflow.stage) && nonempty(workflow.revision)
    && Array.isArray(workflow.stages), 'Invalid edition workflow receipt');
  const stages = workflow.stages.map(({id, revision, fingerprint, contexts}) => {
    need(safeId(id) && nonempty(revision) && checksum(fingerprint), 'Invalid edition stage receipt');
    const stage = {id, revision, fingerprint};
    if (contexts !== undefined) {
      need(Array.isArray(contexts), 'Invalid stage contexts');
      stage.contexts = contexts.map(({shot,role,sha256}) => {
        need(safeId(shot) && safeId(role) && checksum(sha256), 'Invalid stage context identity');
        return {shot,role,sha256};
      });
    }
    return stage;
  });
  names(stages.map(s => s.id), 'pinned stage IDs', safeId);
  need(stages.some(s => s.id === workflow.stage && s.revision === workflow.revision),
    'Pinned workflow needs its accepted stage revision');
  return {id:workflow.id, stage:workflow.stage, revision:workflow.revision, stages};
}

export function pinEdition(dir, report, files = {}, root, exportRoot) {
  const target = resolve(dir);
  need(!lstatSync(target, {throwIfNoEntry:false}), 'Choose a new edition directory');
  const parent = dirname(target);
  mkdirSync(parent,{recursive:true});
  const tmp = mkdtempSync(join(parent,'.folio-edition-'));
  let reserved = false;
  try {
    const body = {version:1,series:report.series,episode:report.episode,
      shots: archiveReport(tmp,root,report), files:archiveDeliverables(tmp,files,exportRoot)};
    if (report.workflow) body.workflow = workflowReceipt(report.workflow);
    const manifest = {...body,revision:digest(body)};
    writeFileSync(join(tmp,editionName), JSON.stringify(manifest,null,2)+'\n');
    verifyEdition(tmp);
    // mkdir is exclusive, even if another publisher chose the same name while
    // this edition was being assembled. rename only replaces our reservation.
    mkdirSync(target,{mode:0o700});
    reserved = true;
    renameSync(tmp,target);
    reserved = false;
    return manifest;
  } finally {
    rmSync(tmp,{recursive:true,force:true});
    if (reserved && existsSync(target)) rmdirSync(target);
  }
}
