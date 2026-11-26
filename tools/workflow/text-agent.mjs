// Adapt a text-in, text-out provider to a single editorial stage.
import {spawnSync} from 'node:child_process';
import {readFileSync, statSync, writeFileSync} from 'node:fs';

const request = JSON.parse(readFileSync(0, 'utf8'));
const {command, instruction, roles, format = 'text'} = request.settings ?? {};
if (!Array.isArray(command) || !command.length || !command.every(a => typeof a === 'string' && a.length))
  throw Error('settings.command must be an executable and its arguments');
if (!instruction?.trim() || !Array.isArray(roles) || !roles.every(role => Object.hasOwn(request.inputs, role)))
  throw Error('Declare an instruction and the text input roles to send to the provider');
const outputPaths = Object.values(request.outputs);
if (outputPaths.length !== 1 || !['text', 'json'].includes(format)) throw Error('Choose one text or JSON output');

function readText(path) {
  if (statSync(path).size > 2_000_000) throw Error('Select a smaller text input for the model');
  return new TextDecoder('utf-8', {fatal:true}).decode(readFileSync(path));
}
const material = Object.fromEntries(roles.map(role => [role, readText(request.inputs[role])]));
const instructions = {task: instruction, stage: request.stage, model: request.model ?? null, format, material};
for (const field of ['purpose', 'responsibility']) {
  if (request[field]) instructions[field] = request[field];
}
if (request.settings.includeBrand === true && request.brand) instructions.brand = readText(request.brand);
const argv = command.map(arg => {
  if (arg !== '{model}') return arg;
  if (typeof request.model !== 'string' || !request.model) throw Error('Set owner.model for the {model} argument');
  return request.model;
});
const result = spawnSync(argv[0], argv.slice(1), {
  input: JSON.stringify(instructions), encoding:'utf8', stdio:['pipe','pipe','inherit'], maxBuffer:8_000_000,
});
if (result.error) throw result.error;
if (result.status !== 0) throw Error('Provider exited with ' + (result.signal || result.status));
const reply = result.stdout.trim();
if (!reply) throw Error('Provider returned empty output');
writeFileSync(outputPaths[0], (format === 'json' ? JSON.stringify(JSON.parse(reply), null, 2) : reply) + '\n');
