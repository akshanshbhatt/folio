import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ROOT } from '../src/common.mjs';
import { callModel } from '../tools/workflow/model.mjs';

const env = { ANTHROPIC_API_KEY: 'test-anthropic', GOOGLE_API_KEY: 'test-google', GEMINI_API_KEY: 'test-gemini', OPENAI_API_KEY: 'test-openai' };
const job = { stage: 'narration', purpose: 'Explain the judgment.', responsibility: 'Editor', model: 'test-model',
  format: 'json', task: 'Write a line of JSON.', material: { note: 'A supplied observation.' } };
const designer = { version: 1, brief: 'Arrange the operator.', instructions: 'Return a workflow proposal.', operators: [], assets: [], model: 'test-model' };
const messages = (content, stop_reason = 'end_turn') => ({ type: 'message', role: 'assistant', content, stop_reason });
const google = (parts, finishReason = 'STOP') => ({ candidates: [{ content: { role: 'model', parts }, finishReason }] });
const message = (content, extra = {}) => ({ type: 'message', role: 'assistant', status: 'completed', content, ...extra });
const openai = (...output) => ({ status: 'completed', error: null, incomplete_details: null, output });
const gText = text => ({ text });
const aText = text => ({ type: 'text', text });
const oText = text => ({ type: 'output_text', text });
const bridge = join(ROOT, 'tools/workflow/model.mjs');

function mock(response) {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) });
    return Response.json(response);
  } };
}

test('each provider uses its native endpoint, header and terminal text blocks with one explicit model', async () => {
  const returns = {
    anthropic: messages([{ type: 'thinking', thinking: 'private' }, { type: 'redacted_thinking', data: 'opaque' }, aText('[1,'), aText('2]')]),
    google: google([{ thought: true, text: 'private' }, gText('[1,'), gText('2]')]),
    openai: openai({ type: 'reasoning' }, message([oText('progress')], { phase: 'commentary' }), message([oText('[1,'), oText('2]')])),
  };
  for (const [provider, reply] of Object.entries(returns)) {
    const mocked = mock(reply);
    const result = await callModel(provider, job, { env, fetchImpl: mocked.fetchImpl, model: '{model}', maxOutputTokens: 971 });
    assert.deepEqual(JSON.parse(result), [1, 2]); assert.equal(mocked.calls.length, 1);
    const [request] = mocked.calls; const { body, url, headers } = request;
    assert.equal(request.redirect, 'error'); assert.equal(request.method, 'POST'); assert.ok(request.signal instanceof AbortSignal);
    let prompt;
    if (provider === 'anthropic') {
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      assert.equal(headers.Authorization, 'Bearer test-anthropic'); assert.equal(headers['anthropic-version'], '2026-10-21');
      assert.equal(body.model, job.model); assert.equal(body.max_tokens, 971); assert.equal(body.fallbacks, undefined);
      prompt = JSON.parse(body.messages[0].content);
    } else if (provider === 'google') {
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent');
      assert.equal(headers['x-goog-api-key'], env.GOOGLE_API_KEY); assert.equal(body.generationConfig.maxOutputTokens, 971);
      assert.equal(body.generationConfig.responseMimeType, 'application/json'); prompt = JSON.parse(body.contents[0].parts[0].text);
    } else {
      assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(headers.Authorization, 'Bearer test-openai');
      assert.equal(body.model, job.model); assert.equal(body.max_output_tokens, 971); assert.equal(body.store, false);
      prompt = JSON.parse(body.input);
    }
    assert.deepEqual(prompt.material, job.material); assert.equal(prompt.purpose, job.purpose); assert.equal(prompt.responsibility, job.responsibility);
    for (const key of Object.values(env)) { assert.equal(url.includes(key), false); assert.equal(JSON.stringify(body).includes(key), false); }
  }
});

test('truncated, filtered, refused, intermediate, empty or nontext responses never become artifacts', async () => {
  const cases = [
    ['anthropic', messages([aText('looks complete')], 'max_tokens')],
    ['anthropic', messages([aText('partial')], 'refusal')],
    ['anthropic', messages([{ type:'tool_use' }, aText('partial')])],
    ['anthropic', messages([{ type:'thinking', thinking:'not an answer' }])],
    ['google', { ...google([gText('partial')]), promptFeedback:{ blockReason:'SAFETY' } }],
    ['google', google([gText('partial')], 'MAX_TOKENS')], ['google', google([gText('partial')], 'RECITATION')],
    ['google', google([{ functionCall:{ name:'do-something' } }])],
    ['google', { candidates:[{ finishReason:'STOP', content:{parts:[gText('partial')]}, safetyRatings:[{blocked:true}] }] }],
    ['openai', { ...openai(message([oText('partial')])), status:'incomplete', incomplete_details:{reason:'max_output_tokens'} }],
    ['openai', openai(message([{type:'refusal',refusal:'protected diagnostic'}]))],
    ['openai', openai(message([oText('partial')], {status:'incomplete'}))],
    ['openai', openai({type:'function_call'}, message([oText('partial')]))],
    ['openai', openai(message([oText('not final')], {phase:'commentary'}))],
  ];
  for (const [provider, response] of cases) {
    const fake = mock(response);
    await assert.rejects(callModel(provider, { ...job, format:'text' }, { env, fetchImpl:fake.fetchImpl }));
    assert.equal(fake.calls.length, 1, 'A failed answer must never trigger a second request');
  }
  await assert.rejects(callModel('openai', job, {env, fetchImpl:mock(openai(message([oText('invalid JSON')]))).fetchImpl}), /invalid JSON/);
  await assert.rejects(callModel('openai', designer, {env, fetchImpl:mock(openai(message([oText('[]')]))).fetchImpl}), /JSON object/);
});

test('credentials, model conflicts, HTTP errors and timeouts produce bounded diagnostics without retrying', async () => {
  const noCall = () => assert.fail('Unexpected request');
  for (const provider of ['anthropic', 'google', 'openai']) {
    await assert.rejects(callModel(provider, job, {env:{}, fetchImpl:noCall}), /API_KEY/);
    await assert.rejects(callModel(provider, {...job,model:null}, {env, fetchImpl:noCall}), /explicit model/);
    await assert.rejects(callModel(provider, job, {env, model:'another-model', fetchImpl:noCall}), /conflicts/);
  }
  await assert.rejects(callModel('google', {...job,model:'../other'}, {env, fetchImpl:noCall}), /model ID/);
  const goog = mock(google([gText('text')]));
  assert.equal(await callModel('google', {...job, model:null, format:'text'}, {env:{GEMINI_API_KEY:env.GEMINI_API_KEY}, model:'test-model', fetchImpl:goog.fetchImpl}), 'text');
  assert.equal(goog.calls[0].headers['x-goog-api-key'], env.GEMINI_API_KEY);
  let calls = 0;
  const failure = () => { calls++; return new Response('contains private request and test-openai', {status:429}); };
  await assert.rejects(callModel('openai', job, {env, fetchImpl:failure}), error => error.message === 'openai returned HTTP 429');
  assert.equal(calls, 1);
  await assert.rejects(callModel('openai', job, {env, fetchImpl:async () => { throw Error('contains private network diagnostics and test-openai'); }}),
    error => !error.message.includes('private') && !error.message.includes(env.OPENAI_API_KEY));
  await assert.rejects(callModel('openai', job, {env, timeoutMs:12, fetchImpl:(_url, {signal}) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(Error('sensitive internal message')), {once:true});
  })}), /timed out/);
});

test('the executable works behind the text-agent adapter and the workflow-design writer using injected fetch only', t => {
  const dir = mkdtempSync(join(tmpdir(), 'folio-model-protocols-'));
  t.after(() => rmSync(dir, {recursive:true, force:true}));
  const preload = join(dir, 'fetch-fixture.mjs'), fixture = join(ROOT, 'examples/workflow-design');
  cpSync(fixture, dir, {recursive:true, filter:p => !p.includes('/.folio')});
  const proposal = JSON.parse(readFileSync(join(dir, 'proposal.json'), 'utf8'));
  writeFileSync(preload, `globalThis.fetch = async (url, init) => {
    if (url !== 'https://api.openai.com/v1/responses') throw Error('Wrong destination');
    const body = JSON.parse(init.body), prompt = JSON.parse(body.input);
    if (body.model !== 'test-model' || init.headers.Authorization !== 'Bearer local-test') throw Error('Wrong routing');
    let text = prompt.task ? prompt.material.note : JSON.stringify(` + JSON.stringify(proposal) + `);
    if (prompt.operators && body.text.format.type !== 'json_object') throw Error('Designer must ask for an object');
    return Response.json({status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text}]}]});
  };`);
  const command = [process.execPath, '--import', preload, bridge, 'openai', '--model', '{model}'];
  const vars = { ...process.env, OPENAI_API_KEY:'local-test' };
  const note = join(dir, 'note.txt'), reply = join(dir, 'answer.txt');
  writeFileSync(note, 'A standalone answer.');
  const req = { stage:'draft', model:'test-model', inputs:{note}, outputs:{reply}, settings:{
    command, instruction:'Repeat the note.', roles:['note'], format:'text',
  } };
  const stage = spawnSync(process.execPath, [join(ROOT,'tools/workflow/text-agent.mjs')], {env:vars, input:JSON.stringify(req), encoding:'utf8'});
  assert.equal(stage.status, 0, stage.stderr); assert.equal(readFileSync(reply, 'utf8').trim(), 'A standalone answer.');
  const writer = join(dir, 'writer.json'), out = join(dir, 'workflow.json');
  writeFileSync(writer, JSON.stringify({command, model:'test-model'}));
  const design = spawnSync(process.execPath, [join(ROOT,'src/cli.mjs'),'workflow','design','--brief',join(dir,'brief.md'),
    '--catalog',join(dir,'catalog.json'),'--writer',writer,'--out',out], {env:vars, encoding:'utf8'});
  assert.equal(design.status, 0, design.stderr); assert.equal(JSON.parse(readFileSync(out,'utf8')).id, proposal.id);
});
