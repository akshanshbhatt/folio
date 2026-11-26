#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const providers = ['anthropic', 'google', 'openai'];
const usage = 'node tools/workflow/model.mjs anthropic|google|openai [--model MODEL] [--max-output-tokens N] [--timeout-ms N]';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
function requireValue(value, message) { if (!value) throw new Error(message); }
function parseJson(value, message) {
  try { return JSON.parse(value); } catch { throw new Error(message); }
}
function integer(value, fallback, label) {
  if (value == null) return fallback;
  const n = Number(value);
  requireValue(Number.isSafeInteger(n) && n > 0 && n <= 2147483647, label + ' must be a positive integer');
  return n;
}

function promptFor(job) {
  requireValue(object(job), 'Expected a JSON request object');
  if (text(job.instructions) && text(job.brief) && Array.isArray(job.operators) && Array.isArray(job.assets)) {
    const { instructions, brief, operators, assets, settings } = job;
    return { format: 'object', input: JSON.stringify({ instructions, brief, operators, assets, settings }) };
  }
  requireValue(text(job.task) && object(job.material), 'Expected a text-agent request or a workflow-design brief');
  const { task, stage, purpose, responsibility, material, brand, format = 'text' } = job;
  requireValue(['text', 'json'].includes(format), 'Select text or JSON output');
  return { format, input: JSON.stringify({ task, stage, purpose, responsibility, material, brand }) };
}

function prepare(provider, model, env, maxTokens, prompt) {
  const system = prompt.format === 'text' ? 'Carry out the supplied task and return its final text.'
    : 'Carry out the supplied task and return ' + (prompt.format === 'object' ? 'one JSON object' : 'one valid JSON value') + ' with no Markdown fences or commentary.';
  if (provider === 'anthropic') {
    requireValue(text(env.ANTHROPIC_API_KEY), 'Set ANTHROPIC_API_KEY for Anthropic');
    return { url: 'https://api.anthropic.com/v1/messages',
      headers: { Authorization: 'Bearer ' + env.ANTHROPIC_API_KEY, 'anthropic-version': '2026-10-21',
        ...(env.ANTHROPIC_WORKSPACE_ID ? {'anthropic-workspace-id': env.ANTHROPIC_WORKSPACE_ID} : {}) },
      body: { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt.input }] } };
  }
  if (provider === 'google') {
    const key = env.GOOGLE_API_KEY || env.GEMINI_API_KEY;
    requireValue(text(key), 'Set GEMINI_API_KEY or GOOGLE_API_KEY for Google');
    requireValue(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(model), 'Use a bare Gemini model ID');
    const generationConfig = { maxOutputTokens: maxTokens };
    if (prompt.format !== 'text') generationConfig.responseMimeType = 'application/json';
    return { url: 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
      headers: { 'x-goog-api-key': key },
      body: { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt.input }] }], generationConfig } };
  }
  requireValue(text(env.OPENAI_API_KEY), 'Set OPENAI_API_KEY for OpenAI');
  const body = { model, instructions: system, input: prompt.input, max_output_tokens: maxTokens, store: false };
  if (prompt.format === 'object') body.text = { format: { type: 'json_object' } };
  return { url: 'https://api.openai.com/v1/responses', headers: { Authorization: 'Bearer ' + env.OPENAI_API_KEY }, body };
}

function stopped(provider, reason, known) {
  // A service may return an arbitrary diagnostic. Include only documented reason codes.
  const label = known.includes(reason) ? reason : 'unexpected stop';
  throw new Error(provider + ' returned ' + label);
}

function complete(provider, response) {
  requireValue(object(response) && !response.error, 'The provider did not return a successful response');
  const pieces = [];
  if (provider === 'anthropic') {
    if (response.stop_reason !== 'end_turn') stopped('Anthropic', response.stop_reason,
      ['max_tokens', 'refusal', 'tool_use', 'pause_turn', 'stop_sequence', 'model_context_window_exceeded']);
    requireValue(Array.isArray(response.content), 'Anthropic returned an invalid content array');
    for (const part of response.content) {
      if (['thinking', 'redacted_thinking'].includes(part?.type)) continue;
      requireValue(part?.type === 'text' && typeof part.text === 'string', 'Anthropic returned non-text content');
      pieces.push(part.text);
    }
  } else if (provider === 'google') {
    const feedback = response.promptFeedback;
    requireValue((!feedback?.blockReason || feedback.blockReason === 'BLOCK_REASON_UNSPECIFIED')
      && !feedback?.safetyRatings?.some(rating => rating.blocked), 'Google blocked the prompt');
    requireValue(Array.isArray(response.candidates) && response.candidates.length === 1, 'Google did not return one candidate');
    const [candidate] = response.candidates;
    if (candidate?.finishReason !== 'STOP') stopped('Google', candidate?.finishReason,
      ['MAX_TOKENS', 'SAFETY', 'RECITATION', 'LANGUAGE', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'MALFORMED_FUNCTION_CALL', 'OTHER']);
    requireValue(!candidate.safetyRatings?.some(rating => rating.blocked), 'Google blocked the candidate');
    requireValue(Array.isArray(candidate.content?.parts), 'Google returned an invalid content array');
    for (const part of candidate.content.parts) {
      if (part?.thought === true) continue;
      requireValue(typeof part?.text === 'string', 'Google returned non-text content');
      pieces.push(part.text);
    }
  } else {
    if (response.status !== 'completed' || response.incomplete_details) stopped('OpenAI', response.incomplete_details?.reason ?? response.status,
      ['queued', 'in_progress', 'failed', 'cancelled', 'incomplete', 'max_output_tokens', 'content_filter']);
    requireValue(Array.isArray(response.output), 'OpenAI returned an invalid output array');
    for (const item of response.output) {
      if (item?.type === 'reasoning') continue;
      requireValue(item?.type === 'message' && item.role === 'assistant' && item.status === 'completed' && Array.isArray(item.content),
        'OpenAI returned an unfinished message or a non-text action');
      for (const part of item.content) {
        requireValue(part?.type !== 'refusal', 'OpenAI declined the request');
        requireValue(part?.type === 'output_text' && typeof part.text === 'string', 'OpenAI returned non-text content');
        if (item.phase !== 'commentary') pieces.push(part.text);
      }
    }
  }
  const result = pieces.join('').trim();
  requireValue(result, 'The provider returned empty final text');
  return result;
}

export async function callModel(provider, job, options = {}) {
  requireValue(providers.includes(provider), 'Select anthropic, google or openai');
  const prompt = promptFor(job), requested = options.model === '{model}' ? job.model : options.model;
  requireValue(!requested || !job.model || requested === job.model, 'Command model conflicts with the request model');
  const model = requested ?? job.model;
  requireValue(text(model) && model !== '{model}' && /^[A-Za-z0-9][A-Za-z0-9_.:@-]*$/.test(model), 'Supply an explicit model ID');
  const tokens = integer(options.maxOutputTokens, 4096, 'Output token limit');
  const timeout = integer(options.timeoutMs, 90000, 'Timeout');
  const spec = prepare(provider, model, options.env ?? process.env, tokens, prompt);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    let response;
    try {
      response = await (options.fetchImpl ?? fetch)(spec.url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...spec.headers }, body: JSON.stringify(spec.body),
        redirect: 'error', signal: controller.signal,
      });
    } catch { throw new Error(controller.signal.aborted ? 'The provider request timed out' : 'The provider request failed before an HTTP response'); }
    if (!response.ok) {
      try { await response.body?.cancel(); } catch { /* The diagnostic only uses the status code. */ }
      throw new Error(provider + ' returned HTTP ' + response.status);
    }
    let data;
    try { data = await response.json(); }
    catch { throw new Error(controller.signal.aborted ? 'The provider response timed out' : 'The provider returned an unreadable response'); }
    const result = complete(provider, data);
    if (prompt.format === 'text') return result;
    const parsed = parseJson(result, 'The provider returned invalid JSON');
    requireValue(prompt.format !== 'object' || object(parsed), 'The workflow designer must return a JSON object');
    return result;
  } finally { clearTimeout(timer); }
}

async function main() {
  let args;
  try {
    args = parseArgs({ allowPositionals: true, options: { model: { type: 'string' },
      'max-output-tokens': { type: 'string' }, 'timeout-ms': { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  } catch { throw new Error(usage); }
  if (args.values.help) { console.log(usage); return; }
  requireValue(args.positionals.length === 1 && providers.includes(args.positionals[0]), usage);
  const job = parseJson(readFileSync(0, 'utf8'), 'Standard input must contain one JSON object');
  const result = await callModel(args.positionals[0], job, { model: args.values.model,
    maxOutputTokens: args.values['max-output-tokens'], timeoutMs: args.values['timeout-ms'] });
  process.stdout.write(result + '\n');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
