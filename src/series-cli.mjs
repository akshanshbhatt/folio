import { constants, copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { digest, json, safeId, write } from './common.mjs';
import { withLock } from './integrity.mjs';
import { localPath, realFile, replaceJson } from './project-file.mjs';
import { assetUses, getEpisode, inspectProject, openSeries } from './series.mjs';
import { pinEdition, verifyEdition } from './series-assets.mjs';
import { acceptedSeriesContext, executeWorkflow } from './workflow.mjs';

const usage = `folio series init SERIES.json --id ID [--role ROLE]
folio series new-episode SERIES.json --id ID [--season ID] [--file PATH]
folio series inspect SERIES.json --episode ID [--shot ID] [--role ID] [--audience]
folio series script SERIES.json --episode ID --role ROLE [--shot ID] [--draft FILE]
folio series register SERIES.json --record FILE
folio series why SERIES.json --episode ID --shot ID --role ID --key KEY [--edition DIR --workflow FILE] [--stage ID]
folio series impact SERIES.json --asset ID [--candidate REV] [--edition DIR ...]
folio series adopt SERIES.json --episode ID --shot ID --asset ID --revision REV [--representation ID] [--use INDEX]
folio series suggest SERIES.json --evidence FILE --key KEY --role ROLE [--writer FILE] [--out FILE]
folio series promote SERIES.json --proposal FILE --scope SCOPE [--season ID] [--episode ID] [--scene ID] [--shot ID]
folio series pin SERIES.json --episode ID --workflow WORKFLOW.json --stage ID --dir NEW_DIR [--revision UUID]
folio series verify EDITION_DIR [--revision DIGEST]`;
const allowed = {
  init:['id','role'], 'new-episode':['id','season','file'],
  inspect:['episode','shot','role','audience'], script:['episode','role','shot','draft','audience'], register:['record'], why:['episode','shot','role','key','audience','edition','workflow','state','stage'],
  impact:['episode','shot','asset','candidate','representation','edition'],
  adopt:['episode','shot','asset','revision','representation','use'],
  suggest:['evidence','key','role','writer','out'], promote:['proposal','scope','season','episode','scene','shot'],
  pin:['episode','workflow','stage','dir','revision','state'], verify:['revision'],
};
function need(v, message) { if (!v) throw Error(message); }
function requireFlags(options, keys) {
  for (const key of keys) need(options[key], 'Supply --' + key);
}

function inspect(project, opts) {
  requireFlags(opts,['episode']);
  return inspectProject(project, {...opts, includeAudience:opts.audience ?? false});
}

function why(project, opts) {
  requireFlags(opts,['episode','shot','role','key']);
  let view, edition, stage;
  if (opts.edition) {
    requireFlags(opts,['workflow']);
    need(opts.edition.length === 1 && !opts.audience,'Choose one edition and its recorded audience scope');
    const pinned = verifyEdition(opts.edition[0]);
    need(pinned.series === project.series.id && pinned.episode === opts.episode,'Wrong edition for this series and episode');
    const match = pinned.workflow?.stages.find(s => (!opts.stage || opts.stage === s.id) &&
      s.contexts?.some(c => c.shot === opts.shot && c.role === opts.role));
    need(match,'This edition has no matching stage context');
    const packet = acceptedSeriesContext(opts.workflow,opts.state,pinned.workflow.id,match);
    view = packet.shots.find(s=>s.id===opts.shot)?.roles[opts.role];
    const identity = match.contexts.find(c=>c.shot===opts.shot && c.role===opts.role);
    need(view && digest(view) === identity.sha256,'Local role packet differs from the pinned handoff');
    edition=pinned.revision; stage=match.id;
  } else {
    need(!opts.workflow && !opts.state && !opts.stage,'Historical workflow selectors require --edition');
    view=inspect(project,opts).shots[0].roles[opts.role];
  }
  if (Object.hasOwn(view.decisions,opts.key)) return {episode:opts.episode, shot:opts.shot, role:opts.role,
    key:opts.key, decision:view.decisions[opts.key], ...(edition ? {edition,stage} : {})};
  throw Error('No visible decision for ' + opts.key + ' in this shot and role');
}

function impact(project, opts) {
  requireFlags(opts,['asset']);
  if (opts.shot) requireFlags(opts,['episode']);
  const working = assetUses(project, opts);
  const editions = [];
  for (const dir of opts.edition ?? []) {
    const pinned = verifyEdition(dir);
    need(pinned.series === project.series.id, 'Edition belongs to another series');
    if (opts.episode && pinned.episode !== opts.episode) continue;
    for (const shot of pinned.shots) {
      if (opts.shot && shot.id !== opts.shot) continue;
      for (const [role, ctx] of Object.entries(shot.roles)) {
        for (const asset of ctx.assets) {
          if (asset.asset === opts.asset && (!opts.representation || opts.representation === asset.representation)) {
            editions.push({episode:pinned.episode, edition:pinned.revision, shot:shot.id, role,
              variant:asset.variant, revision:asset.revision, representation:asset.representation, sha256:asset.sha256});
          }
        }
      }
    }
  }
  return {series:project.series.id,asset:opts.asset,working,editions};
}

async function adopt(file, opts) {
  requireFlags(opts,['episode','shot','asset','revision']);
  need(safeId(opts.revision), 'Supply a valid revision ID');
  const root = dirname(realpathSync(file));
  return withLock(join(root,'.folio/series-edit.lock'), () => {
    const project = openSeries(file), ep = getEpisode(project,opts.episode);
    const prior = readFileSync(ep.file);
    need(digest(JSON.parse(prior)) === digest(ep.data), 'Episode changed before adoption');
    const uses = assetUses(project,{...opts, candidate:opts.revision});
    need(uses.length && uses.every(use => !use.candidate.unavailable), 'Candidate unavailable for a selected use: ' +
      (uses.find(row=>row.candidate.unavailable)?.candidate.unavailable ?? opts.asset));
    const shot = ep.data.scenes.flatMap(scene=>scene.shots).find(s=>s.id === opts.shot);
    const matches = shot.uses.filter((use,index) => (opts.use === undefined || index === opts.use) && use.asset === opts.asset &&
      (!opts.representation || use.representation === opts.representation));
    need(matches.length === 1, 'Select a single asset use in this shot with --representation or --use INDEX');
    matches[0].revision = opts.revision;
    const report = inspectProject(project,{episode:opts.episode,shot:opts.shot});
    replaceJson(ep.file,prior,ep.data);
    return {episode:opts.episode,shot:opts.shot,asset:opts.asset,revision:opts.revision,contextDigest:digest(report)};
  });
}

// Pin the role packets on the accepted workflow branch. Inspecting today's entire show
// would also include decisions and assets that were never supplied to this cut.
async function pin(file, opts) {
  requireFlags(opts,['episode','workflow','stage','dir']);
  const project=openSeries(file), manifest=realpathSync(opts.workflow);
  getEpisode(project,opts.episode);
  const settings = {stage:opts.stage, state:opts.state};
  const result = await executeWorkflow('status',manifest,settings);
  const target=result.stages.find(s=>s.id===opts.stage);
  need(target?.state==='complete' && (!opts.revision || opts.revision===target.revision),
    'Select a complete, accepted workflow revision');
  const declarations = json(manifest).stages, shots=new Map(), stages=[];
  for (const row of result.stages) {
    const stageReceipt = {id:row.id, revision:row.revision, fingerprint:row.fingerprint};
    stages.push(stageReceipt);
    if (!row.seriesContext) continue;
    const binding=declarations.find(s=>s.id===row.id).seriesContext;
    need(realFile(dirname(manifest),localPath(binding.file,'series'))===project.manifest &&
      row.seriesContext.episode===opts.episode,'Workflow branch mixes different series or episodes');
    const accepted = json(row.acceptedContext);
    need(digest(accepted) === digest(row.seriesContext),'Stored handoff differs from selected workflow context');
    stageReceipt.contexts = [];
    for (const shot of accepted.shots) {
      const existing=shots.get(shot.id) ?? {id:shot.id,scene:shot.scene,roles:Object.create(null)};
      for (const [role,ctx] of Object.entries(shot.roles)) {
        stageReceipt.contexts.push({shot:shot.id,role,sha256:digest(ctx)});
        if (Object.hasOwn(existing.roles,role)) {
          need(digest(ctx.assets)===digest(existing.roles[role].assets),'Inconsistent shot asset selections');
        } else existing.roles[role]=ctx;
      }
      shots.set(shot.id,existing);
    }
  }
  need(shots.size,'The selected workflow branch needs a seriesContext binding for this episode');
  const report={version:1,series:project.series.id,episode:opts.episode,shots:[...shots.values()],
    workflow:{id:result.workflow,stage:target.id,revision:target.revision,stages}};
  const temp=mkdtempSync(join(tmpdir(),'folio-pin-'));
  try {
    const exported=await executeWorkflow('export',manifest,{...settings,revision:target.revision,dir:join(temp,'accepted')});
    return pinEdition(opts.dir,report,exported.export.files,project.root,exported.export.directory);
  } finally { rmSync(temp,{recursive:true,force:true}); }
}

export async function seriesCli(argv) {
  const types=Object.fromEntries([...new Set(Object.values(allowed).flat())].map(key=>[key,
    key==='audience'?{type:'boolean'}:key==='edition'?{type:'string',multiple:true}:{type:'string'}]));
  const {values:opts,positionals}=parseArgs({args:argv,allowPositionals:true,options:{...types,help:{type:'boolean',short:'h'}}});
  if (!positionals.length || opts.help) { console.log(usage); return; }
  const [action,file]=positionals;
  need(Object.hasOwn(allowed,action) && positionals.length===2,'Supply a series action and a project or edition path');
  for (const flag of Object.keys(opts)) need(allowed[action].includes(flag),'Unexpected --'+flag+' for '+action);
  if (opts.use !== undefined) {
    need(/^(0|[1-9][0-9]*)$/.test(opts.use) && Number.isSafeInteger(Number(opts.use)),'Expected a zero-based --use index');
    opts.use = Number(opts.use);
  }
  let result;
  if (action==='init' || action==='new-episode') {
    requireFlags(opts,['id']);
    const {startSeries}=await import('./series-init.mjs');
    result=await startSeries(action,file,opts);
  } else if (action==='verify') result=verifyEdition(file,opts.revision);
  else if (action==='pin') result=await pin(file,opts);
  else if (action==='register') {
    requireFlags(opts,['record']);
    const {registerAsset}=await import('./series-register.mjs');
    result=await registerAsset(file,opts);
  } else if (action==='script') {
    requireFlags(opts,['episode','role']);
    const report=inspect(openSeries(file),opts);
    const {applyDraft,scriptView}=await import('./series-script.mjs');
    const view=opts.draft ? applyDraft(report,json(opts.draft),opts.role) : report;
    result=scriptView(view,opts.role);
  }
  else if (action==='adopt') result=await adopt(file,opts);
  else if (action==='suggest' || action==='promote') {
    const {suggestionCli}=await import('./series-suggestions.mjs');
    result=await suggestionCli(action,file,opts);
    if (opts.out) {
      const tmp=mkdtempSync(join(tmpdir(),'folio-proposal-'));
      try {
        const source=join(tmp,'proposal.json');write(source,result);
        copyFileSync(source,resolve(opts.out),constants.COPYFILE_EXCL);
      } finally {rmSync(tmp,{recursive:true,force:true});}
    }
  } else {
    const project=openSeries(file);
    result=action==='why'?why(project,opts):action==='impact'?impact(project,opts):inspect(project,opts);
  }
  console.log(JSON.stringify(result,null,2));
}
