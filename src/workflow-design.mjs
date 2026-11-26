import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {closeSync,linkSync,lstatSync,openSync,readFileSync,realpathSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve,sep,win32} from 'node:path';
import {parseArgs} from 'node:util';
import {safeId} from './common.mjs';
import {executeWorkflow} from './workflow.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const need = (ok, message) => { if (!ok) throw Error(message); };
const name = value => safeId(value) && !['constructor','prototype'].includes(value);
const roleName = value => typeof value === 'string' && /^[a-z][A-Za-z0-9_-]*$/.test(value) && !['constructor','prototype'].includes(value);
const entries = Object.entries;
function fields(value, keys, label) {
  need(object(value), label + ' must be an object');
  for (const key of Object.keys(value)) need(keys.includes(key), 'Unknown ' + label + ' field: ' + key);
}

function parseJSON(source, label) {
  let value;
  try { value = JSON.parse(source); } catch (error) { throw Error('Invalid JSON in ' + label + ': ' + error.message); }
  // JSON.parse silently accepts repeated keys. Scan the already-valid JSON so
  // an earlier binding or owner cannot disappear during review.
  const stack = [], tokens = /"(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|[{}\[\]]/g;
  for (const [token] of source.matchAll(tokens)) {
    if (token === '{' || token === '[') stack.push(token === '{' ? new Set() : null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token.endsWith(':')) {
      const key = JSON.parse(token.slice(0,-1));
      const keys = stack.at(-1);
      need(!keys.has(key), 'Duplicate key in ' + label + ': ' + key);
      keys.add(key);
    }
  }
  return value;
}
const readJSON = file => parseJSON(readFileSync(file,'utf8'),file);

function checkAsset(root, path, id) {
  need(text(path) && !isAbsolute(path) && !win32.isAbsolute(path) && !path.includes('\\') &&
    !path.includes('\0') && path.split('/').every(p => p && p !== '.' && p !== '..'), 'Asset needs a relative local path: ' + id);
  const actual = realpathSync(join(root,path)), below = relative(root,actual);
  need(below && !isAbsolute(below) && below !== '..' && !below.startsWith('..'+sep) &&
    statSync(actual).isFile(), 'Asset must be a regular file inside the workflow project: ' + id);
}

function validateCatalog(catalog, root) {
  fields(catalog,['version','assets','operators','brand'],'catalog');
  need(catalog.version === 1 && object(catalog.assets) && object(catalog.operators) &&
    entries(catalog.operators).length, 'Catalog needs version 1, assets and operators');
  for (const [id,file] of entries(catalog.assets)) {
    need(name(id),'Invalid asset ID: '+id);
    checkAsset(root,file,id);
  }
  if (catalog.brand != null) need(Object.hasOwn(catalog.assets,catalog.brand),'Unknown catalog brand asset');
  for (const [id, op] of entries(catalog.operators)) {
    need(name(id),'Invalid operator ID: '+id);
    fields(op,['description','owner','inputs','fixedInputs','outputs','useBrand','approval'],'operator '+id);
    need(text(op.description),'Describe operator '+id);
    fields(op.owner,['type','command','settings','model','version'],'owner '+id);
    need(['manual','command','agent'].includes(op.owner.type),'Invalid owner type: '+id);
    if (op.owner.type !== 'manual') need(Array.isArray(op.owner.command) && op.owner.command.length &&
      op.owner.command.every(v => typeof v === 'string') && text(op.owner.command[0]),'Missing trusted command: '+id);
    else need(op.owner.command === undefined && op.owner.model === undefined && op.owner.settings === undefined,
      'Manual operator cannot have runtime settings: '+id);
    if (op.owner.version !== undefined) need(text(op.owner.version),'Invalid operator version: '+id);
    if (op.owner.settings !== undefined) need(object(op.owner.settings),'Invalid operator settings: '+id);
    need(Array.isArray(op.inputs) && op.inputs.every(roleName) && new Set(op.inputs).size === op.inputs.length,'Invalid or duplicate input role: '+id);
    need(object(op.outputs) && entries(op.outputs).length && Object.keys(op.outputs).every(roleName),'Invalid output roles: '+id);
    for (const flag of ['approval','useBrand']) if (op[flag] !== undefined) need(typeof op[flag] === 'boolean','Invalid '+flag+' for '+id);
    need(object(op.fixedInputs ?? {}),'Invalid fixed inputs: '+id);
    for (const [role,asset] of entries(op.fixedInputs ?? {})) need(roleName(role) && !op.inputs.includes(role) &&
      typeof asset === 'string' && Object.hasOwn(catalog.assets,asset),'Invalid fixed input for '+id+': '+role);
  }
}

function proposalRequest(brief, catalog, writer) {
  return {
    version:1, brief, model:writer.model ?? null, settings:writer.settings ?? {},
    assets:Object.keys(catalog.assets),
    operators:entries(catalog.operators).map(([id,op]) => ({
      id,description:op.description,owner:op.owner.type,inputs:op.inputs,outputs:Object.keys(op.outputs),
      approval:op.approval ?? false
    })),
    instructions:'Return only one JSON object with version 1, a lowercase kebab-case id, and stages. '+
      'Each stage has a unique kebab-case id, a human-readable purpose, a catalog operator, and bindings for every listed input role. '+
      'Bind with {"asset":"asset-id"} or {"stage":"stage-id","output":"role"}. Inputs imply dependencies. '+
      'Use optional needs for additional ordering and optional responsibility to name a person or team. '+
      'Keep independent stages independent. Use only catalog IDs, and never include filesystem paths, commands, models or settings.'
  };
}

async function askWriter(file, brief, catalog) {
  const writer = readJSON(file);
  fields(writer,['command','model','settings','timeoutMs'],'writer');
  const argv = writer.command;
  need(Array.isArray(argv) && argv.length && argv.every(s=>typeof s==='string') && text(argv[0]),'Writer needs an executable argument array');
  if (writer.settings !== undefined) need(object(writer.settings),'Writer settings must be an object');
  const timeout = writer.timeoutMs ?? 120000;
  need(Number.isSafeInteger(timeout) && timeout > 0,'Invalid writer timeoutMs');
  const request = proposalRequest(brief,catalog,writer);
  const reply = await new Promise((ok,fail) => {
    const child = execFile(argv[0],argv.slice(1),{cwd:dirname(resolve(file)),timeout,maxBuffer:4*1024*1024,
      shell:false,encoding:'utf8'},(error,stdout,stderr) => {
      if (error) fail(Error('Workflow writer failed: ' + (stderr.trim().slice(-400) || error.message)));
      else ok(stdout);
    });
    child.stdin.on('error',error => { if (error.code !== 'EPIPE') fail(error); });
    child.stdin.end(JSON.stringify(request)+'\n');
  });
  return parseJSON(reply,'writer response');
}

function compile(plan,catalog) {
  fields(plan,['version','id','stages'],'proposal');
  need(plan.version===1 && name(plan.id) && Array.isArray(plan.stages) && plan.stages.length,'Proposal needs version 1, an ID and stages');
  const ids = new Set();
  const stages = plan.stages.map(s => {
    fields(s,['id','purpose','responsibility','operator','bindings','needs'],'proposal stage');
    need(name(s.id) && !ids.has(s.id),'Invalid or duplicate stage ID: '+s.id); ids.add(s.id);
    need(text(s.purpose) && (s.responsibility === undefined || text(s.responsibility)),'Stage needs a purpose or valid responsibility: '+s.id);
    need(typeof s.operator === 'string' && Object.hasOwn(catalog.operators,s.operator),'Unknown operator: '+s.operator);
    const op = catalog.operators[s.operator], bindings=s.bindings ?? {}, extra=s.needs ?? [];
    need(object(bindings) && op.inputs.length===Object.keys(bindings).length && op.inputs.every(role=>Object.hasOwn(bindings,role)),
      'Missing or unknown input bindings for '+s.id);
    need(Array.isArray(extra) && extra.every(name) && new Set(extra).size===extra.length,'Invalid or duplicate needs in '+s.id);
    const needs=new Set(extra), inputs=Object.fromEntries(entries(op.fixedInputs ?? {}).map(([role,asset])=>[role,catalog.assets[asset]]));
    for (const [role,binding] of entries(bindings)) {
      need(object(binding),'Binding must name a catalog asset or upstream output: '+role);
      if (Object.hasOwn(binding,'asset')) {
        fields(binding,['asset'],'asset binding');
        need(typeof binding.asset === 'string' && Object.hasOwn(catalog.assets,binding.asset),'Unknown asset: '+binding.asset);
        inputs[role]=catalog.assets[binding.asset];
      } else {
        fields(binding,['stage','output'],'stage binding');
        need(name(binding.stage) && typeof binding.output==='string' && roleName(binding.output),'Invalid upstream output binding: '+role);
        needs.add(binding.stage); inputs[role]={stage:binding.stage,output:binding.output};
      }
    }
    return {id:s.id,purpose:s.purpose,...(s.responsibility ? {responsibility:s.responsibility} : {}),operator:s.operator,
      needs:[...needs],inputs,outputs:op.outputs,owner:op.owner,...(op.useBrand!==undefined ? {useBrand:op.useBrand} : {}),
      ...(op.approval!==undefined ? {approval:op.approval} : {})};
  });
  return {version:1,id:plan.id,brand:catalog.brand != null ? catalog.assets[catalog.brand] : null,stages};
}

export async function designWorkflow({brief,catalog,proposal,writer,out}) {
  need([brief,catalog,out].every(text) && Boolean(writer)!==Boolean(proposal),
    'Supply --brief, --catalog, --out and exactly one of --proposal or --writer');
  const output=resolve(out), root=realpathSync(dirname(output));
  need(!lstatSync(output,{throwIfNoEntry:false}),'Choose a new workflow manifest: '+output);
  const creative=readFileSync(brief,'utf8');
  need(text(creative),'Creative brief is empty');
  const trusted=readJSON(catalog);
  validateCatalog(trusted,root);
  const spec=compile(proposal ? readJSON(proposal) : await askWriter(writer,creative,trusted),trusted);
  // The runner resolves paths beside the manifest. Validate a private sibling,
  // then publish the finished file with an exclusive hard link, including if
  // another designer chose the same destination while the writer was running.
  const temp=join(root,'.foliofilm-design-'+randomUUID()+'.json'), fd=openSync(temp,'wx',0o600);
  try {
    try { writeFileSync(fd,JSON.stringify(spec,null,2)+'\n'); } finally { closeSync(fd); }
    const checked=await executeWorkflow('plan',temp);
    const missing=checked.stages.find(s=>s.state==='missing-input');
    if (missing) throw Error('Unusable catalog input for '+missing.id+': '+missing.error);
    try { linkSync(temp,output); }
    catch (error) { if (error.code==='EEXIST') throw Error('Choose a new workflow manifest: '+output); throw error; }
    return {manifest:output,id:spec.id,order:checked.order};
  } finally { rmSync(temp,{force:true}); }
}

export async function workflowDesignCli(argv) {
  const {values}=parseArgs({args:argv,options:Object.fromEntries(['brief','catalog','proposal','writer','out'].map(key=>[key,{type:'string'}])
    .concat([['help',{type:'boolean',short:'h'}]]))});
  if (values.help) {
    console.log('foliofilm workflow design --brief BRIEF.md --catalog CATALOG.json (--proposal PLAN.json | --writer WRITER.json) --out NEW-WORKFLOW.json');
    return;
  }
  console.log(JSON.stringify(await designWorkflow(values),null,2));
}
