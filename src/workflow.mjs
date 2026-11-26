import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  closeSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync,
  readFileSync, realpathSync, renameSync, rmSync, rmdirSync, statSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { hostname } from 'node:os';
import { parseArgs } from 'node:util';
import { digest, json, safeId, write } from './common.mjs';
import { localPath, realFile, stamp } from './project-file.mjs';
import { inspectSeries, validateBinding, snapshotSeriesFiles } from './series.mjs';
import { withLock } from './integrity.mjs';

const rolePattern = /^[a-z][A-Za-z0-9_-]*$/;
const uuidPattern = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const own = (object, key) => Object.hasOwn(object, key);
const entries = object => Object.entries(object);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (ok, message) => { if (!ok) throw new Error(message); };
const readOptional = file => {
  try { return json(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};

function outputSpecs(id, outputs) {
  need(object(outputs) && entries(outputs).length > 0, id + ' needs at least one output');
  const names = [];
  return Object.fromEntries(entries(outputs).map(([role, raw]) => {
    need(rolePattern.test(role), 'Invalid output role ' + role);
    const spec = typeof raw === 'string' ? { path: raw } : raw;
    need(object(spec), 'Invalid output ' + id + '.' + role);
    const path = localPath(spec.path, id + '.' + role), key = path.toLowerCase();
    need(names.every(n => n !== key && !n.startsWith(key + '/') && !key.startsWith(n + '/')), 'Overlapping outputs in ' + id);
    names.push(key);
    const validate = spec.validate ?? 'file';
    need(['file', 'text', 'json'].includes(validate), 'Unknown output validator ' + validate);
    return [role, { path, validate }];
  }));
}

function sortStages(stages) {
  const done = new Set(), active = new Set(), sorted = [];
  function visit(id) {
    need(stages.has(id), 'Unknown dependency ' + id);
    if (done.has(id)) return;
    need(!active.has(id), 'Dependency cycle at ' + id);
    active.add(id);
    for (const dep of stages.get(id).needs) visit(dep);
    active.delete(id); done.add(id); sorted.push(id);
  }
  for (const id of stages.keys()) visit(id);
  return sorted;
}

function load(file, stateRoot) {
  const manifest = realpathSync(file), root = dirname(manifest), data = json(manifest);
  need(data.version === 1 && safeId(data.id) && Array.isArray(data.stages) && data.stages.length, 'Expected workflow version 1, id and stages');
  const brand = data.brand === undefined && existsSync(join(root, 'brand.json')) ? 'brand.json' : (data.brand ?? null);
  if (brand != null) localPath(brand, 'brand');
  const stages = new Map();
  for (const raw of data.stages) {
    need(object(raw) && safeId(raw.id) && !stages.has(raw.id), 'Invalid or duplicate stage ID');
    const { id, owner } = raw, needs = raw.needs ?? [], inputs = raw.inputs ?? {};
    need(object(owner) && ['manual', 'command', 'agent'].includes(owner.type), 'Unknown owner for ' + id);
    if (owner.type !== 'manual') need(Array.isArray(owner.command) && owner.command.length && owner.command.every(s => typeof s === 'string') && owner.command[0], 'Missing command for ' + id);
    for (const field of ['purpose', 'responsibility']) {
      need(raw[field] === undefined || (typeof raw[field] === 'string' && raw[field].trim()), field + ' must be nonempty text for ' + id);
    }
    need(raw.useBrand === undefined || typeof raw.useBrand === 'boolean', 'useBrand must be boolean for ' + id);
    need(raw.approval === undefined || typeof raw.approval === 'boolean', 'approval must be boolean for ' + id);
    need(Array.isArray(needs) && needs.every(safeId) && new Set(needs).size === needs.length, 'Invalid needs for ' + id);
    need(object(inputs), 'Invalid inputs for ' + id);
    if (raw.seriesContext !== undefined) {
      validateBinding(raw.seriesContext);
      need(!own(inputs, 'seriesContext'), 'seriesContext is reserved for the resolved series input');
    }
    for (const [role, input] of entries(inputs)) {
      need(rolePattern.test(role), 'Invalid input role: ' + role);
      if (typeof input === 'string') localPath(input, id + '.' + role);
      else need(object(input) && needs.includes(input.stage) && typeof input.output === 'string', 'Reference must name a declared dependency: ' + id + '.' + role);
    }
    stages.set(id, { ...raw, needs, inputs, outputs: outputSpecs(id, raw.outputs) });
  }
  const order = sortStages(stages);
  for (const stage of stages.values()) for (const input of Object.values(stage.inputs)) {
    if (object(input)) need(own(stages.get(input.stage).outputs, input.output), 'Unknown output ' + input.stage + '.' + input.output);
  }
  const state = join(resolve(stateRoot || join(root, '.folio/workflows')), data.id + '-' + digest(manifest).slice(0, 12));
  return { id: data.id, manifest, root, brand, stages, order, state };
}

function selected(w, target) {
  if (!target) return w.order;
  need(w.stages.has(target), 'Unknown stage: ' + target);
  const included = new Set();
  function add(id) {
    if (included.has(id)) return;
    included.add(id);
    for (const dep of w.stages.get(id).needs) add(dep);
  }
  add(target);
  return w.order.filter(id => included.has(id));
}

function fileInfo(root, spec) {
  need(!lstatSync(root).isSymbolicLink(), 'Symbolic output directory: ' + root);
  const path = realFile(root, spec.path);
  need(path === join(realpathSync(root), spec.path), 'Symbolic output path: ' + spec.path);
  const info = stamp(path);
  need(info.bytes > 0, 'Empty output: ' + spec.path);
  if (spec.validate !== 'file') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path));
    need(text.trim().length > 0, 'Empty text: ' + spec.path);
    if (spec.validate === 'json') JSON.parse(text);
  }
  return { ...info, path };
}

function liveLock(file) {
  const owner = readOptional(file);
  if (!owner || owner.host !== hostname()) return owner;
  try { process.kill(owner.pid, 0); return owner; }
  catch (error) { if (error.code === 'ESRCH') return null; return owner; }
}

function sample(w, ids) {
  const lock = liveLock(join(w.state, 'workflow.lock'));
  let brand = null, brandHash = null, brandError;
  try { if (w.brand) { brand = realFile(w.root, w.brand); brandHash = stamp(brand).sha256; } }
  catch (error) { brandError = error.message; }
  const rows = new Map();
  for (const id of ids) {
    const stage = w.stages.get(id), folder = join(w.state, id);
    const row = { id, owner: stage.owner.type, approvalRequired: !!stage.approval, needs: stage.needs,
      inputs: {}, inputHashes: {}, outputs: stage.outputs, artifacts: {}, revision: null, state: 'ready' };
    if (stage.purpose) row.purpose = stage.purpose;
    if (stage.responsibility) row.responsibility = stage.responsibility;
    rows.set(id, row);
    const current = readOptional(join(folder, 'current.json'));
    if (current) {
      need(uuidPattern.test(current.revision), 'Invalid current revision in ' + id);
      row.revision = current.revision;
    }
    const last = readOptional(join(folder, 'attempt.json'));
    if (last) row.attempt = last;
    const blockedBy = stage.needs.filter(dep => rows.get(dep).state !== 'complete');
    if (blockedBy.length) { row.state = 'blocked'; row.blockedBy = blockedBy; continue; }
    const hashes = [];
    const useBrand = stage.useBrand ?? !stage.seriesContext;
    try {
      if (useBrand && brandError) throw Error(brandError);
      for (const [role, input] of entries(stage.inputs)) {
        const path = typeof input === 'string' ? realFile(w.root, input) : rows.get(input.stage).artifacts[input.output].path;
        row.inputs[role] = path;
        row.inputHashes[role] = typeof input === 'string' ? stamp(path).sha256 : rows.get(input.stage).artifacts[input.output].sha256;
        hashes.push([role, row.inputHashes[role]]);
      }
      if (stage.seriesContext) {
        const { file, ...selection } = stage.seriesContext;
        const seriesFile = realFile(w.root, localPath(file, 'series manifest'));
        row.seriesContext = inspectSeries(seriesFile, selection);
        row.inputHashes.seriesContext = digest(row.seriesContext);
        hashes.push(['seriesContext', row.inputHashes.seriesContext]);
      }
    } catch (error) { row.state = 'missing-input'; row.error = error.message; continue; }
    const upstream = stage.needs.map(dep => [dep, rows.get(dep).revision, rows.get(dep).fingerprint]);
    row.brand = useBrand ? brand : null;
    const brandInput = useBrand ? [w.brand || null, brandHash] : null;
    row.fingerprint = digest('workflow/v1', w.id, stage, brandInput, hashes, upstream);
    if (current) {
      const revision = join(folder, 'revisions', current.revision);
      const released = readOptional(join(folder, 'release.json'))?.revision === current.revision;
      row.origin = current.origin;
      try {
        const receiptFile = join(revision, 'receipt.json');
        need(stamp(receiptFile).sha256 === current.receiptSha256, 'Revision receipt changed');
        const receipt = json(receiptFile);
        need(receipt.revision === current.revision && receipt.id === id && object(receipt.artifacts), 'Invalid revision receipt');
        row.receipt = receiptFile;
        if (receipt.seriesContext) {
          const contextFile = realFile(revision,'series-context.json');
          need(stamp(contextFile).sha256 === receipt.seriesContext.sha256, 'Accepted series context changed');
          row.acceptedContext = contextFile;
        }
        const sameInputs = receipt.fingerprint === row.fingerprint;
        const artifacts = {}, errors = [];
        for (const [role, entry] of entries(receipt.artifacts)) {
          try {
            const spec = sameInputs ? stage.outputs[role] : { path: localPath(entry.path, role), validate: 'file' };
            need(spec, 'Unexpected output role ' + role);
            const got = fileInfo(join(revision, 'files'), spec);
            need(got.sha256 === entry.sha256 && got.bytes === entry.bytes, 'Output changed: ' + role);
            artifacts[role] = got;
          } catch (error) { errors.push(error.message); }
        }
        row.origin = receipt.origin;
        if (released || !sameInputs) row.previousArtifacts = artifacts;
        else row.artifacts = artifacts;
        need(!errors.length, errors.join('; '));
        if (released || !sameInputs) row.state = released ? 'ready' : 'stale';
        else {
          row.missing = Object.keys(stage.outputs).filter(role => !own(row.artifacts, role));
          const approved = readOptional(join(folder, 'approval.json'));
          row.approved = approved?.revision === current.revision && approved.fingerprint === row.fingerprint;
          row.state = row.missing.length ? 'awaiting-input' : stage.approval && !row.approved ? 'awaiting-approval' : 'complete';
        }
      } catch (error) { row.state = 'damaged'; row.error = error.message; }
      row.manualOverrideProtected = row.origin === 'manual-override' && !released;
      if (row.manualOverrideProtected && ['stale', 'damaged'].includes(row.state)) {
        row.state = row.state === 'stale' ? 'stale-override' : 'damaged-override';
      }
    } else if (stage.owner.type === 'manual') row.state = 'awaiting-input';
    if (last?.state === 'running' && lock && last.lock === lock.id) row.state = 'running';
    if (last?.fingerprint === row.fingerprint && last.state === 'failed') {
      if (last.mode === 'rerun' && last.previousRevision === row.revision && row.revision) {
        row.refreshFailure = { revisionRetained: row.revision, error: last.error, directory: last.directory };
      }
      if (['ready', 'stale', 'damaged'].includes(row.state)) row.state = 'failed';
    }
  }
  return rows;
}

function produce(w, stage, row, paths, origin, beforeCommit) {
  const folder = join(w.state, stage.id), revision = randomUUID(), revisions = join(folder, 'revisions');
  mkdirSync(revisions, { recursive: true, mode: 0o700 });
  const temp = join(revisions, '.' + revision), files = join(temp, 'files');
  mkdirSync(files, { recursive: true, mode: 0o700 });
  try {
    const artifacts = {};
    for (const [role, src] of entries(paths)) {
      const spec = stage.outputs[role], dst = join(files, spec.path);
      need(statSync(src).isFile(), 'Expected a regular file for ' + role);
      mkdirSync(dirname(dst), { recursive: true, mode: 0o700 }); copyFileSync(src, dst, constants.COPYFILE_FICLONE);
      const { sha256, bytes } = fileInfo(files, spec);
      artifacts[role] = { path: spec.path, sha256, bytes };
    }
    const receipt = {version:1, id:stage.id, revision, fingerprint:row.fingerprint, origin, artifacts};
    if (row.seriesContext) {
      const packet = join(temp, 'series-context.json');
      write(packet,row.seriesContext);
      receipt.seriesContext = stamp(packet);
    }
    write(join(temp, 'receipt.json'), receipt);
    const receiptSha256 = stamp(join(temp, 'receipt.json')).sha256;
    beforeCommit();
    renameSync(temp, join(revisions, revision));
    write(join(folder, 'current.json'), { revision, receiptSha256, origin });
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

async function command(argv, req, cwd, attempt) {
  const stdout = openSync(join(attempt, 'stdout.log'), 'w', 0o600), stderr = openSync(join(attempt, 'stderr.log'), 'w', 0o600);
  try {
    await new Promise((done, fail) => {
      const child = spawn(argv[0], argv.slice(1), { cwd, stdio: ['pipe', stdout, stderr], shell: false });
      child.once('error', fail);
      child.once('close', (status, signal) => status === 0 ? done() : fail(Error('Command exited ' + (signal || status) + '. See ' + join(attempt, 'stderr.log'))));
      child.stdin.on('error', error => { if (error.code !== 'EPIPE') fail(error); });
      child.stdin.end(JSON.stringify(req) + '\n');
    });
  } finally { closeSync(stdout); closeSync(stderr); }
}

function checkFresh(w, options, row) {
  const now = load(w.manifest, options.state);
  need(now.state === w.state && now.stages.has(row.id), 'Workflow changed during the operation');
  const again = sample(now, selected(now, row.id)).get(row.id);
  need(again.fingerprint && again.fingerprint === row.fingerprint && again.revision === row.revision, 'Inputs or upstream revisions changed during ' + row.id);
  return again;
}

function snapshotInputs(w, stage, row, attempt) {
  const inputs = {};
  for (const [role, source] of entries(stage.inputs)) {
    const relativePath = typeof source === 'string' ? join('project', source)
      : join('upstream', source.stage, w.stages.get(source.stage).outputs[source.output].path);
    const file = join(attempt, 'inputs', relativePath);
    if (!existsSync(file)) {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      copyFileSync(row.inputs[role], file, constants.COPYFILE_FICLONE);
    }
    need(stamp(file).sha256 === row.inputHashes[role], 'Input changed before execution: ' + role);
    inputs[role] = file;
  }
  return inputs;
}

async function runStage(w, stage, row, options, mode = 'run') {
  const attempt = join(w.state, stage.id, 'attempts', randomUUID()), files = join(attempt, 'files');
  mkdirSync(files, { recursive: true, mode: 0o700 });
  const outputs = Object.fromEntries(entries(stage.outputs).map(([role, spec]) => [role, join(files, spec.path)]));
  for (const path of Object.values(outputs)) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const log = join(w.state, stage.id, 'attempt.json');
  const meta = { directory: attempt, lock: json(join(w.state, 'workflow.lock')).id,
    mode, previousRevision: row.revision, fingerprint: row.fingerprint, startedAt: new Date().toISOString() };
  write(log, { ...meta, state: 'running' });
  try {
    checkFresh(w, options, row);
    const inputs = snapshotInputs(w, stage, row, attempt);
    const request = { version: 1, workflow: w.id, stage: stage.id, project: w.root, brand: row.brand,
      purpose: stage.purpose ?? null, responsibility: stage.responsibility ?? null,
      inputs, outputs, model: stage.owner.model ?? null, settings: stage.owner.settings ?? {} };
    if (stage.seriesContext) {
      const base = dirname(realFile(w.root, stage.seriesContext.file));
      request.seriesRoot = join(attempt, 'inputs', 'series-files');
      snapshotSeriesFiles(row.seriesContext, base, request.seriesRoot);
      inputs.seriesContext = join(attempt, 'inputs', 'series-context.json');
      write(inputs.seriesContext, row.seriesContext);
    }
    write(join(attempt, 'request.json'), request);
    await command(stage.owner.command, request, w.root, attempt);
    for (const spec of Object.values(stage.outputs)) fileInfo(files, spec);
    produce(w, stage, row, outputs, stage.owner.type, () => checkFresh(w, options, row));
    write(log, { ...meta, state: 'succeeded' });
    rmSync(files, { recursive: true, force: true });
    rmSync(join(attempt, 'inputs'), { recursive: true, force: true });
  } catch (error) {
    write(log, { ...meta, state: 'failed', error: error.message });
    return error.message;
  }
}

function exportFiles(w, stage, row, destination, options) {
  need(destination, 'export requires --dir pointing to a new directory');
  need(row.state === 'complete', 'Export needs a complete, accepted revision');
  const target = resolve(destination);
  need(!existsSync(target), 'Choose a new export directory: ' + target);
  const requestedParent = dirname(target);
  let ancestor = requestedParent;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const parent = join(realpathSync(ancestor), relative(ancestor, requestedParent));
  const rel = relative(realpathSync(w.state), parent);
  need(rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel), 'Choose an export directory outside workflow state');
  mkdirSync(parent, { recursive: true });
  const temp = mkdtempSync(join(parent, '.folio-export-'));
  let reserved = false;
  try {
    for (const [role, artifact] of entries(row.artifacts)) {
      const spec = stage.outputs[role], dest = join(temp, spec.path);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(artifact.path, dest, constants.COPYFILE_FICLONE);
      need(stamp(dest).sha256 === artifact.sha256, 'Output changed during export: ' + role);
    }
    need(checkFresh(w, options, row).state === 'complete', 'Revision changed during export');
    mkdirSync(target, { mode: 0o700 }); reserved = true;
    renameSync(temp, target); reserved = false;
    return { directory: target, revision: row.revision, files: Object.fromEntries(entries(stage.outputs).map(([role,spec]) => [role, join(target, spec.path)])) };
  } finally {
    rmSync(temp, { recursive: true, force: true });
    if (reserved) {
      try { rmdirSync(target); } catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
    }
  }
}

// Historical investigation must work after the project's current inputs change.
export function acceptedSeriesContext(file, stateRoot, workflowId, stage) {
  const w = load(file,stateRoot);
  need(w.id === workflowId && safeId(stage.id) && uuidPattern.test(stage.revision),'Wrong workflow or stage revision');
  const base = stage.id + '/revisions/' + stage.revision + '/';
  const receipt = json(realFile(w.state,base + 'receipt.json'));
  need(receipt.id === stage.id && receipt.revision === stage.revision && receipt.fingerprint === stage.fingerprint,
    'Local workflow revision differs from the pinned stage');
  const packet = realFile(w.state,base + 'series-context.json');
  need(stamp(packet).sha256 === receipt.seriesContext?.sha256,'Historical series context changed');
  return json(packet);
}

export async function executeWorkflow(action, file, options = {}) {
  need(['plan', 'status', 'run', 'rerun', 'approve', 'override', 'release', 'export'].includes(action), 'Unknown workflow action: ' + action);
  need(typeof file === 'string' && file, 'Supply a workflow manifest');
  need((!options.file && !options.role) || action === 'override', '--file and --role apply to override');
  need(!options.dir || action === 'export', '--dir applies to export');
  const w = load(file, options.state), ids = selected(w, options.stage);
  const result = () => ({ workflow: w.id, state: w.state, stages: [...sample(w, ids).values()] });
  if (options.revision) need(['approve', 'override', 'release', 'export', 'rerun'].includes(action) && uuidPattern.test(options.revision), '--revision must identify the revision to act on');
  if (action === 'status' || action === 'plan') return { ...result(), ...(action === 'plan' ? { order: ids } : {}) };
  mkdirSync(w.state, { recursive: true, mode: 0o700 });
  return withLock(join(w.state, 'workflow.lock'), async () => {
    const active = load(file, options.state);
    need(active.state === w.state && digest([...active.stages], active.brand) === digest([...w.stages], w.brand), 'Workflow changed while waiting for another writer; retry');
    if (action === 'run') {
      const failures = {};
      for (const id of ids) {
        const stage = w.stages.get(id), row = sample(w, selected(w, id)).get(id);
        if (stage.owner.type === 'manual' || !['ready', 'stale', 'damaged', 'failed'].includes(row.state)) continue;
        const error = await runStage(w, stage, row, options);
        if (error) failures[id] = error;
      }
      return { ...result(), failures };
    }
    need(options.stage, action + ' requires --stage');
    const stage = w.stages.get(options.stage), row = sample(w, ids).get(stage.id);
    need(row.fingerprint, 'Resolve inputs and dependencies for ' + stage.id);
    if (options.revision) need(row.revision === options.revision, 'Selected revision has changed');
    if (action === 'rerun') {
      need(stage.owner.type !== 'manual', 'Only a command or agent stage can rerun');
      need(!row.manualOverrideProtected, 'Release the human override before rerunning ' + stage.id);
      const error = await runStage(w, stage, row, options, 'rerun');
      return { ...result(), failures: error ? { [stage.id]: error } : {} };
    }
    if (action === 'export') return { ...result(), export: exportFiles(w, stage, row, options.dir, options) };
    if (action === 'release') {
      need(['command', 'agent'].includes(stage.owner.type) && row.origin === 'manual-override', 'Release requires a human override of an automated stage');
      write(join(w.state, stage.id, 'release.json'), { revision: row.revision, releasedAt: new Date().toISOString() });
    } else if (action === 'approve') {
      need(row.state === 'awaiting-approval' || (row.state === 'complete' && stage.approval), 'No current complete revision awaiting approval');
      need(['awaiting-approval', 'complete'].includes(checkFresh(w, options, row).state), 'Revision changed before approval');
      write(join(w.state, stage.id, 'approval.json'), { revision: row.revision, fingerprint: row.fingerprint, approvedAt: new Date().toISOString() });
    } else {
      need(options.file, 'override requires --file');
      const role = options.role || (Object.keys(stage.outputs).length === 1 && Object.keys(stage.outputs)[0]);
      need(role && own(stage.outputs, role), 'Choose an output with --role');
      const paths = Object.fromEntries(entries(row.artifacts).filter(([name]) => name !== role).map(([name, info]) => [name, info.path]));
      paths[role] = realpathSync(options.file);
      produce(w, stage, row, paths, 'manual-override', () => checkFresh(w, options, row));
    }
    return result();
  });
}

export async function workflowCli(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    stage: { type: 'string' }, dir: { type: 'string' }, revision: { type: 'string' }, role: { type: 'string' }, file: { type: 'string' }, state: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help || !positionals.length) {
    console.log('folio workflow design --help\nfolio workflow plan|graph|status|run|rerun|approve|override|release|export WORKFLOW.json [--stage ID] [--revision UUID] [--dir NEW_DIRECTORY] [--role ROLE --file FILE] [--state DIRECTORY]');
    return;
  }
  need(positionals.length === 2, 'Supply one action and one workflow manifest');
  const [action, file] = positionals;
  if (action === 'graph') {
    need(!values.dir && !values.file && !values.role && !values.revision, 'graph accepts an optional --stage');
    const workflow = load(file, values.state);
    const lines = ['flowchart TD'];
    for (const id of selected(workflow, values.stage)) {
      const stage = workflow.stages.get(id);
      const label = id + ' · ' + stage.owner.type + (stage.approval ? ' · approval' : '');
      lines.push('    stage_' + id + '["' + label + '"]');
      for (const dep of stage.needs) lines.push('    stage_' + dep + ' --> stage_' + id);
    }
    console.log(lines.join('\n'));
    return;
  }
  const result = await executeWorkflow(action, file, values);
  console.log(JSON.stringify(result, null, 2));
  if (Object.keys(result.failures || {}).length || (action === 'run' && result.stages.some(row => row.state === 'missing-input'))) process.exitCode = 1;
}
