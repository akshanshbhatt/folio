import assert from 'node:assert/strict';
import { json as read, write } from '../src/common.mjs';
import { executeWorkflow } from '../src/workflow.mjs';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const writer = `import {readFileSync, writeFileSync} from 'node:fs';
const q = JSON.parse(readFileSync(0, 'utf8'));
const first = q.inputs.from && readFileSync(q.inputs.from,'utf8');
if (q.settings.fail) throw Error('deliberate provider failure');
if (q.settings.changeInput) writeFileSync(q.project + '/topic.txt','moved');
if (q.settings.delay) await new Promise(done => setTimeout(done, q.settings.delay));
if (q.settings.skip) process.exit(0);
for (const [role, path] of Object.entries(q.outputs)) {
  const payload = {stage:q.stage,from:first,model:q.model,brand:q.brand,role};
  writeFileSync(path, JSON.stringify(payload));
}
if (q.settings.touchCopy) writeFileSync(q.inputs.from,'changed inside provider');
`;

function setup(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'foliofilm-workflow-'))), manifest = join(root, 'flow.json');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(join(root, 'brand.json'), { name: 'Test' }); write(join(root, 'worker.mjs'), writer);
  write(join(root, 'topic.txt'), 'sound'); write(join(root, 'note.txt'), 'first manual note');
  const stages = [];
  const manual = (id, outputs, other = {}) => stages.push({ id, owner: { type: 'manual' }, outputs, ...other });
  const cmd = (id, other = {}, settings = {}) => stages.push({ id, owner: {
    type: 'agent', command: [process.execPath, 'worker.mjs'], model: 'fixture', settings,
  }, outputs: { result: { path: 'nested/result.json', validate: 'json' } }, ...other });
  const save = () => write(manifest, { version: 1, id: 'fixture', stages });
  const act = (name, options) => executeWorkflow(name, manifest, options);
  const run = options => act('run', options);
  const row = (report, id) => report.stages.find(s => s.id === id);
  return { root, manifest, stages, cmd, manual, save, act, run, row };
}

test('a manual fork can wait for approval while an independent branch finishes; selective runs and receipts survive retries', async t => {
  const x = setup(t);
  x.cmd('conclusion', { needs: ['research'], inputs: { from: { stage: 'research', output: 'note' } } }, { touchCopy: true });
  x.manual('research', { note: 'note.txt', table: { path: 'table.json', validate: 'json' } }, { approval: true });
  x.cmd('independent', { inputs: { from: 'topic.txt', implementation: 'worker.mjs' } }); x.save();
  const plan = await x.act('plan');
  assert.deepEqual(plan.order, ['research', 'conclusion', 'independent']);
  assert.equal(existsSync(plan.state), false);
  const initial = await x.run();
  assert.equal(x.row(initial, 'research').state, 'awaiting-input');
  assert.equal(x.row(initial, 'conclusion').state, 'blocked');
  const independent = x.row(initial, 'independent');
  assert.equal(independent.state, 'complete');
  assert.deepEqual(read(independent.artifacts.result.path), {
    stage: 'independent', from: 'sound', model: 'fixture', brand: join(x.root, 'brand.json'), role: 'result',
  });
  const partial = x.row(await x.act('override', { stage: 'research', role: 'note', file: join(x.root, 'note.txt') }), 'research');
  assert.equal(partial.state, 'awaiting-input'); assert.deepEqual(partial.missing, ['table']);
  await assert.rejects(x.act('approve', { stage: 'research' }), /awaiting approval/);
  await assert.rejects(x.act('override', { stage: 'research', role: 'table', file: join(x.root, 'note.txt') }));
  assert.equal(x.row(await x.act('status'), 'research').revision, partial.revision);
  const target = join(x.root, 'valid.json'); write(target, { count: 3 });
  const review = x.row(await x.act('override', { stage: 'research', role: 'table', file: target }), 'research');
  assert.equal(review.state, 'awaiting-approval');
  await assert.rejects(x.act('approve', { stage: 'research', revision: partial.revision }), /changed/);
  await x.act('approve', { stage: 'research', revision: review.revision });
  const result = await x.run({ stage: 'conclusion' });
  assert.deepEqual(result.stages.map(s => s.id), ['research', 'conclusion']);
  const conclusion = x.row(result, 'conclusion');
  assert.equal(read(conclusion.artifacts.result.path).from, 'first manual note');
  assert.equal(readFileSync(review.artifacts.note.path, 'utf8'), 'first manual note');
  assert.equal(x.row(await x.run(), 'conclusion').revision, conclusion.revision);
  write(join(x.root, 'note.txt'), 'revised');
  const revised = x.row(await x.act('override', { stage: 'research', role: 'note', file: join(x.root, 'note.txt') }), 'research');
  assert.equal(revised.state, 'awaiting-approval'); assert.equal(revised.approved, false);
  assert.equal(x.row(await x.act('status'), 'conclusion').state, 'blocked');
  await x.act('approve', { stage: 'research', revision: revised.revision });
  assert.equal(x.row(await x.act('status'), 'conclusion').state, 'stale');
  assert.equal(x.row(await x.run(), 'independent').revision, independent.revision);
  assert.equal(readFileSync(review.artifacts.note.path, 'utf8'), 'first manual note');
});

test('input, implementation, model and brand changes invalidate outputs and approvals; manual override supersedes a command', async t => {
  const x = setup(t);
  x.cmd('produce', { approval: true, inputs: { from: 'topic.txt', implementation: 'worker.mjs' } }); x.save();
  async function approved() {
    const row = x.row(await x.run(), 'produce'); assert.equal(row.state, 'awaiting-approval');
    return x.row(await x.act('approve', { stage: 'produce', revision: row.revision }), 'produce');
  }
  let before = await approved();
  for (const change of [
    () => write(join(x.root, 'topic.txt'), 'revised'),
    () => write(join(x.root, 'worker.mjs'), writer + '\n// changed\n'),
    () => { x.stages[0].owner.model = 'version-two'; x.save(); },
    () => write(join(x.root, 'brand.json'), { name: 'Another' }),
  ]) {
    change(); assert.equal(x.row(await x.act('status'), 'produce').state, 'stale');
    await assert.rejects(x.act('approve', { stage: 'produce', revision: before.revision }), /awaiting approval/);
    const after = await approved(); assert.notEqual(after.revision, before.revision); before = after;
  }
  const hand = join(x.root, 'hand.json'); write(hand, { manual: true });
  const override = x.row(await x.act('override', { stage: 'produce', file: hand }), 'produce');
  assert.equal(override.origin, 'manual-override');
  assert.equal(x.row(await x.run(), 'produce').revision, override.revision);
  await x.act('approve', { stage: 'produce' }); assert.deepEqual(read(override.artifacts.result.path), { manual: true });
  write(override.artifacts.result.path, { edited: true });
  assert.equal(x.row(await x.act('status'), 'produce').state, 'damaged-override');
  assert.equal(x.row(await x.run(), 'produce').revision, override.revision);
  await x.act('release', { stage: 'produce', revision: override.revision });
  assert.equal(x.row(await x.run(), 'produce').state, 'awaiting-approval');
});

test('missing inputs, failed or incomplete commands and in-flight changes keep earlier receipts available; forks can progress', async t => {
  const x = setup(t);
  x.cmd('missing', { inputs: { from: 'not-here.txt' } });
  x.cmd('fails', {}, { fail: true }); x.cmd('dependent', { needs: ['fails'] });
  x.cmd('empty', {}, { skip: true }); x.cmd('fine'); x.save();
  let result = await x.run();
  assert.equal(x.row(result, 'missing').state, 'missing-input');
  assert.deepEqual(Object.keys(result.failures), ['fails', 'empty']);
  assert.equal(x.row(result, 'dependent').state, 'blocked'); assert.equal(x.row(result, 'fine').state, 'complete');
  assert.match(readFileSync(join(x.row(result, 'fails').attempt.directory, 'stderr.log'), 'utf8'), /deliberate provider failure/);
  write(join(x.root, 'not-here.txt'), 'present');
  x.stages[1].owner.settings = {}; x.stages[3].owner.settings = {}; x.save();
  result = await x.run(); assert.equal(result.stages.every(s => s.state === 'complete'), true);
  const baseline = x.row(result, 'fine');
  x.stages[4].inputs = { from: 'topic.txt' }; x.stages[4].owner.settings.changeInput = true; x.save();
  result = await x.run({ stage: 'fine' }); assert.match(result.failures.fine, /changed/);
  assert.equal(x.row(result, 'fine').revision, baseline.revision);
  assert.equal(existsSync(baseline.artifacts.result.path), true);
});

test('parallel requests reuse one completed revision', async t => {
  const x = setup(t);
  x.cmd('slow', {}, { delay: 100 }); x.save();
  const first = x.run();
  let active;
  for (let attempt = 0; attempt < 40; attempt++) {
    active = x.row(await x.act('status'), 'slow');
    if (active.state === 'running') break;
    await new Promise(done => setTimeout(done, 5));
  }
  assert.equal(active.state, 'running');
  const [a, b] = await Promise.all([first, x.run()]);
  assert.equal(x.row(a, 'slow').revision, x.row(b, 'slow').revision);
  assert.equal(x.row(a, 'slow').attempt.directory, x.row(b, 'slow').attempt.directory);
});

test('cycles, undeclared edges, overlapping artifact paths and escaped files are rejected', async t => {
  const x = setup(t);
  x.cmd('first', { needs: ['next'] }); x.cmd('next', { needs: ['first'] }); x.save();
  await assert.rejects(x.act('plan'), /cycle/);
  x.stages[0].needs = []; x.stages[0].inputs = { previous: { stage: 'next', output: 'result' } }; x.save();
  await assert.rejects(x.act('plan'), /declared dependency/);
  x.stages[0].inputs = {}; x.stages[0].outputs = { one: '../bad' }; x.save();
  await assert.rejects(x.act('plan'), /relative path/);
  x.stages[0].outputs = { one: 'dir', two: 'dir/sub' }; x.save();
  await assert.rejects(x.act('plan'), /Overlapping/);
  x.stages[0].outputs = { one: 'one.txt' }; x.stages[0].inputs = { from: 'escaped' };
  const outside = mkdtempSync(join(tmpdir(), 'outside-workflow-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  write(join(outside, 'out'), 'outside'); symlinkSync(join(outside, 'out'), join(x.root, 'escaped')); x.save();
  assert.equal(x.row(await x.act('plan'), 'first').state, 'missing-input');
});

test('unbranded work remains fresh across a palette change and human work remains protected until released', async t => {
  const x = setup(t);
  x.cmd('source', { useBrand: false, inputs: { from: 'topic.txt' } });
  x.cmd('picture', { needs: ['source'] }); x.save();
  const a = await x.run(), source = x.row(a, 'source');
  assert.equal(read(source.artifacts.result.path).brand, null);
  const custom = join(x.root, 'custom.json'); write(custom, { picture: 'manual' });
  const human = x.row(await x.act('override', { stage: 'picture', file: custom }), 'picture');
  write(join(x.root, 'brand.json'), { name: 'changed' });
  const b = await x.run();
  assert.equal(x.row(b, 'source').revision, source.revision);
  assert.equal(x.row(b, 'picture').state, 'stale-override');
  assert.equal(x.row(b, 'picture').previousArtifacts.result.path, human.artifacts.result.path);
  await x.act('release', { stage: 'picture', revision: human.revision });
  const auto = x.row(await x.run(), 'picture');
  assert.equal(auto.state, 'complete'); assert.notEqual(auto.revision, human.revision);
  assert.deepEqual(read(human.artifacts.result.path), { picture: 'manual' });
  rmSync(join(x.root, 'brand.json')); x.save();
  const noBrand = x.row(await x.run(), 'picture');
  assert.equal(noBrand.state, 'complete'); assert.equal(read(noBrand.artifacts.result.path).brand, null);
});

test('export copies only the accepted outputs into a new directory and refuses stale or unapproved revisions', async t => {
  const x = setup(t);
  x.cmd('deliver', { approval: true, outputs: { cut: 'film/data.json', notes: 'notes.txt' } });
  x.save();
  const stage = 'deliver', dir = join(x.root, 'export');
  const a = x.row(await x.run(), stage);
  await assert.rejects(x.act('export', { stage, dir }), /accepted revision/);
  await x.act('approve', { stage, revision: a.revision });
  const out = await x.act('export', { stage, dir, revision: a.revision });
  assert.equal(out.export.files.cut, join(dir, 'film/data.json'));
  assert.deepEqual(read(out.export.files.cut), read(a.artifacts.cut.path));
  assert.equal(existsSync(join(dir, 'receipt.json')), false);
  await assert.rejects(x.act('export', { stage, dir }), /new export directory/);
  write(out.export.files.notes, 'changed independently'); assert.doesNotMatch(readFileSync(a.artifacts.notes.path, 'utf8'), /independently/);
  write(join(x.root, 'brand.json'), { name: 'changed' });
  await assert.rejects(x.act('export', { stage, dir:join(x.root, 'another-export') }), /accepted revision/);
});

test('repairing one damaged manual file carries intact sibling outputs forward', async t => {
  const x = setup(t); x.manual('review', { notes: 'notes.txt', count: 'count.txt' }); x.save();
  const file = join(x.root, 'note.txt'), stage = 'review';
  await x.act('override', { stage, role:'notes', file });
  const before = x.row(await x.act('override', { stage, role:'count', file }), stage);
  write(before.artifacts.count.path, 'bad edit');
  const damaged = x.row(await x.act('status'), stage);
  assert.equal(damaged.state, 'damaged-override'); assert.equal(damaged.artifacts.notes.sha256, before.artifacts.notes.sha256);
  const repaired = x.row(await x.act('override', { stage, role:'count', file }), stage);
  assert.equal(repaired.state, 'complete'); assert.equal(repaired.artifacts.notes.sha256, before.artifacts.notes.sha256);
});

test('rerun requests one fresh external result, preserves good output on failure and requires a fresh approval on success', async t => {
  const x = setup(t), stage = 'retrieval', external = join(x.root, 'simulated-publication.txt');
  write(join(x.root, 'retrieval.mjs'), `import {readFileSync, writeFileSync} from 'node:fs';
const q = JSON.parse(readFileSync(0, 'utf8'));
const edition = readFileSync(q.project + '/simulated-publication.txt', 'utf8');
if (edition === 'unavailable') throw Error('Retrieval unavailable');
writeFileSync(q.outputs.result, JSON.stringify({edition}));`);
  write(external, 'morning');
  x.cmd('index');
  x.cmd(stage, { needs: ['index'], approval: true, inputs: { implementation: 'retrieval.mjs' },
    owner: { type: 'command', command: [process.execPath, 'retrieval.mjs'] } });
  x.cmd('next', { needs: [stage], inputs: { from: { stage, output: 'result' } } });
  x.cmd('sibling'); x.save();
  await assert.rejects(x.act('rerun'), /requires --stage/);
  await assert.rejects(x.act('rerun', { stage }), /Resolve inputs and dependencies/);
  const initial = await x.run(); const a = x.row(initial, stage);
  assert.equal(a.state, 'awaiting-approval');
  await x.act('approve', { stage, revision: a.revision });
  const accepted = await x.run(), next = x.row(accepted, 'next');
  write(external, 'unavailable');
  const retry = await x.act('rerun', { stage, revision: a.revision });
  assert.ok(retry.failures[stage]); const preserved = x.row(retry, stage);
  assert.equal(preserved.state, 'complete'); assert.equal(preserved.approved, true);
  assert.equal(preserved.refreshFailure.revisionRetained, a.revision);
  assert.deepEqual(read(preserved.artifacts.result.path), { edition: 'morning' });
  assert.equal(x.row(await x.run(), 'next').revision, next.revision);
  write(external, 'evening');
  const refreshed = x.row(await x.act('rerun', { stage, revision: a.revision }), stage);
  assert.equal(refreshed.fingerprint, a.fingerprint); assert.notEqual(refreshed.revision, a.revision);
  assert.equal(refreshed.approved, false); assert.equal(refreshed.state, 'awaiting-approval');
  assert.deepEqual(read(refreshed.artifacts.result.path), { edition: 'evening' });
  assert.deepEqual(read(a.artifacts.result.path), { edition: 'morning' });
  const status = await x.act('status');
  assert.equal(x.row(status, 'index').revision, x.row(accepted, 'index').revision);
  assert.equal(x.row(status, 'sibling').revision, x.row(accepted, 'sibling').revision);
  assert.equal(x.row(status, 'next').revision, next.revision);
  assert.equal(x.row(status, 'next').state, 'blocked');
  await assert.rejects(x.act('rerun', { stage, revision: a.revision }), /changed/);
  const human = x.row(await x.act('override', { stage, file: a.artifacts.result.path }), stage);
  await assert.rejects(x.act('rerun', { stage }), /Release the human override/);
  await x.act('release', { stage, revision: human.revision });
  const released = x.row(await x.act('rerun', { stage }), stage);
  assert.equal(released.state, 'awaiting-approval'); assert.equal(released.origin, 'command');
  const sameBytes = x.row(await x.act('rerun', { stage }), stage);
  assert.equal(sameBytes.artifacts.result.sha256, released.artifacts.result.sha256);
  assert.notEqual(sameBytes.revision, released.revision);
  x.manual('hand', { notes: 'notes.txt' }); x.save();
  await assert.rejects(x.act('rerun', { stage: 'hand' }), /Only a command or agent/);
});

test('stage purpose and responsibility reach the owner and participate in revision freshness', async t => {
  const x = setup(t);
  write(join(x.root, 'handoff.mjs'), `import {readFileSync,writeFileSync} from 'node:fs';
const q = JSON.parse(readFileSync(0,'utf8'));
writeFileSync(q.outputs.result, JSON.stringify({purpose:q.purpose,responsibility:q.responsibility}));`);
  x.cmd('edit', { purpose: 'Remove the repeated sentence.', responsibility: 'Sound editor',
    owner: { type:'command', command:[process.execPath,'handoff.mjs'] } }); x.save();
  const first = x.row(await x.run(), 'edit');
  assert.deepEqual(read(first.artifacts.result.path), { purpose: first.purpose, responsibility: first.responsibility });
  assert.equal(first.purpose, 'Remove the repeated sentence.'); assert.equal(first.responsibility, 'Sound editor');
  for (const [field, value] of [['purpose','Keep the response intact.'], ['responsibility','Interview producer']]) {
    x.stages[0][field] = value; x.save();
    assert.equal(x.row(await x.act('status'), 'edit').state, 'stale');
    const current = x.row(await x.run(), 'edit');
    assert.equal(read(current.artifacts.result.path)[field], value);
  }
});
