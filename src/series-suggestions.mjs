import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdirSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {digest, json, safeId} from './common.mjs';
import {withLock} from './integrity.mjs';
import {localPath, realFile, replaceJson, stamp} from './project-file.mjs';
import {resolveContext} from './series-context.mjs';
import {getEpisode, openSeries} from './series.mjs';

const need = (ok, message) => { if (!ok) throw Error(message); };
const text = value => typeof value === 'string' && value.trim().length > 0;
const equal = isDeepStrictEqual;

// Each vote identifies a different shot and a different place in the cited material.
function readObservations(project, evidence, key, role) {
  const doc = json(realFile(project.root,localPath(evidence,'Evidence')));
  need(doc.version === 1 && Array.isArray(doc.observations),'Expected version 1 observations');
  const shots = new Set(), citations = new Set(), stamps = new Map(), rows = [];
  for (const row of doc.observations) {
    if (row?.key !== key || row.role !== role) continue;
    const episode = getEpisode(project,row.episode).data;
    resolveContext(project.series,episode,row.shot,role);
    need(Object.hasOwn(row,'value') && text(row.locator),'Observations need a value and a frame, timecode or document locator');
    localPath(row.source,'Observation source');
    const file = realFile(project.root,row.source);
    const shotIdentity = JSON.stringify([row.episode,row.shot]), citation = JSON.stringify([file,row.locator]);
    need(!shots.has(shotIdentity) && !citations.has(citation),'Duplicate shot or source locator in evidence');
    shots.add(shotIdentity); citations.add(citation);
    if (!stamps.has(file)) stamps.set(file,stamp(file).sha256);
    rows.push({episode:row.episode,shot:row.shot,source:row.source,locator:row.locator,
      sha256:stamps.get(file),value:row.value});
  }
  need(rows.length >= 2,'Select at least two distinct observations for the requested key and role');
  return rows;
}

function selectChoice(rows, key, role, writer) {
  const choices = [];
  for (const row of rows) {
    const seen = choices.find(choice => equal(choice.value,row.value));
    if (seen) seen.count++;
    else choices.push({value:row.value,count:1});
  }
  choices.sort((a,b) => b.count-a.count);
  if (!writer) {
    need(choices[0].count > (choices[1]?.count ?? 0),'No single most frequent value. Review the examples or select a writer.');
    return {method:'frequency', value:choices[0].value,
      reason:`${choices[0].count} of ${rows.length} selected shots use this value.`};
  }

  const configFile = realpathSync(writer), config = json(configFile);
  need(Array.isArray(config.command) && config.command.length && config.command.every(text),'Writer needs an executable and arguments');
  need(config.model === undefined || text(config.model),'Invalid writer model');
  const timeout = config.timeoutMs ?? 120000;
  need(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 2147483647,'Invalid writer timeoutMs');
  const argv = config.command.map(arg => {
    if (arg !== '{model}') return arg;
    need(text(config.model),'Set a model to use {model}');
    return config.model;
  });
  const request = {task:'Choose one of the observed creative choices. Return {"choice":<zero-based index>,"reason":<brief rationale>}.',
    format:'json',stage:'series-preference',model:config.model ?? null,
    material:{key,role,choices,observations:rows.map(({episode,shot,value}) => ({episode,shot,value}))}};
  const result = spawnSync(argv[0],argv.slice(1),{cwd:dirname(configFile),input:JSON.stringify(request),
    encoding:'utf8',timeout,maxBuffer:1024*1024});
  need(!result.error && result.status === 0,'Preference writer failed or timed out');
  let reply;
  try { reply = JSON.parse(result.stdout); } catch { throw Error('Preference writer returned invalid JSON'); }
  need(reply && Number.isInteger(reply.choice) && reply.choice >= 0 && reply.choice < choices.length
    && text(reply.reason), 'Preference writer must choose an observed value and supply its reason');
  return {method:'writer',...(config.model ? {model:config.model} : {}),value:choices[reply.choice].value,reason:reply.reason};
}

function suggest(file, options) {
  const {evidence,key,role,writer} = options;
  need(text(evidence) && safeId(role) && typeof key === 'string' && /^[a-z][a-zA-Z0-9_-]*(?:\.[a-z][a-zA-Z0-9_-]*)*$/.test(key),
    'Select --evidence, a valid --key and a --role');
  const project = openSeries(file), path = relative(project.root,realpathSync(evidence));
  const rows = readObservations(project,path,key,role), choice = selectChoice(rows,key,role,writer);
  const proposal = {version:1,id:randomUUID(),series:project.series.id,key,role,evidence:path,...choice,
    support:rows.filter(row => equal(row.value,choice.value)),counterexamples:rows.filter(row => !equal(row.value,choice.value))};
  const receipts = join(project.root,'.folio','preferences');
  mkdirSync(receipts,{recursive:true,mode:0o700});
  writeFileSync(join(receipts,proposal.id+'.json'),JSON.stringify({proposal,seriesDigest:digest(project.series),
    episodes:Object.fromEntries([...project.episodes].map(([id,{data}]) => [id,digest(data)]))}),{flag:'wx',mode:0o600});
  return proposal;
}

function selectTarget(project, options) {
  const {scope,episode:id,season,scene,shot} = options;
  const needSelectors = (wanted, optional = []) => {
    for (const name of ['season','episode','scene','shot']) {
      if (wanted.includes(name)) need(safeId(options[name]),'Scope '+scope+' needs --'+name);
      else need(options[name] === undefined || (optional.includes(name) && safeId(options[name])),'Unexpected --'+name+' for '+scope);
    }
  };
  const {series,manifest} = project;
  if (scope === 'series' || scope === 'channel') {
    needSelectors([]);
    return {doc:series,file:manifest,node:scope === 'series' ? series : (series.channel ??= {})};
  }
  if (scope === 'season') {
    needSelectors(['season']); need(Object.hasOwn(series.seasons ?? {},season),'Unknown season');
    return {doc:series,file:manifest,node:series.seasons[season]};
  }
  need(['episode','scene','shot'].includes(scope),'Choose a supported --scope');
  needSelectors(scope === 'episode' ? ['episode'] : ['episode',scope],scope === 'shot' ? ['scene'] : []);
  const {data:doc,file} = getEpisode(project,id);
  if (scope === 'episode') return {doc,file,node:doc};
  const scenes = doc.scenes.filter(row => !scene || row.id === scene);
  const matches = scope === 'scene' ? scenes : scenes.flatMap(row => row.shots.filter(item => item.id === shot));
  need(matches.length === 1,'Select an existing, unambiguous '+scope);
  return {doc,file,node:matches[0]};
}

function promote(file, options) {
  need(text(options.proposal),'Select --proposal');
  const project = openSeries(file), proposal = json(options.proposal);
  need(typeof proposal?.id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(proposal.id),
    'Invalid proposal ID');
  const receipt = json(realFile(project.root,'.folio/preferences/'+proposal.id+'.json'));
  need(equal(proposal,receipt.proposal) && proposal.series === project.series.id,'Proposal differs from its local review receipt');
  const current = readObservations(project,proposal.evidence,proposal.key,proposal.role);
  need(equal(proposal.support,current.filter(row => equal(row.value,proposal.value))) &&
    equal(proposal.counterexamples,current.filter(row => !equal(row.value,proposal.value))),'Cited evidence changed. Suggest again.');
  need(digest(project.series) === receipt.seriesDigest,'Series changed since suggestion. Suggest again.');
  if (options.episode) need(digest(getEpisode(project,options.episode).data) === receipt.episodes[options.episode],
    'Episode changed since suggestion. Suggest again.');
  const {node,file:destination,doc} = selectTarget(project,options);
  const before = readFileSync(destination);
  const expected = destination === project.manifest ? receipt.seriesDigest : receipt.episodes[options.episode];
  need(digest(JSON.parse(before)) === expected,'Destination changed since suggestion. Suggest again.');
  const defaults = node.defaults ??= [];
  need(!defaults.some(row => row.key === proposal.key && row.roles.includes(proposal.role)),
    'The selected scope already declares this preference for this role');
  defaults.push({key:proposal.key,value:proposal.value,roles:[proposal.role],source:'Creator-approved preference',revision:proposal.id});

  // Test the proposed edit against every affected shot, including manual locks.
  let shots = 0;
  for (const {data:episode} of project.episodes.values()) {
    if (options.episode && episode.id !== options.episode || options.season && episode.season !== options.season) continue;
    for (const scene of episode.scenes) {
      if (options.scene && scene.id !== options.scene) continue;
      for (const shot of scene.shots) {
        if (options.shot && shot.id !== options.shot) continue;
        resolveContext(project.series,episode,shot.id,proposal.role);
        shots++;
      }
    }
  }
  if (destination !== project.manifest) need(digest(json(project.manifest)) === receipt.seriesDigest,
    'Series changed during promotion. Suggest again.');
  replaceJson(destination,before,doc);
  return {promoted:proposal.id,scope:options.scope,key:proposal.key,role:proposal.role,shotsChecked:shots,
    file:relative(project.root,destination)};
}

export async function suggestionCli(action, file, options) {
  if (action === 'suggest') return suggest(file,options);
  need(action === 'promote','Choose suggest or promote');
  return withLock(join(dirname(realpathSync(file)),'.folio','series-edit.lock'),() => promote(file,options));
}
