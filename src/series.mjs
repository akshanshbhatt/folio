import { constants, copyFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { digest, json, safeId } from './common.mjs';
import { localPath, realFile, stamp } from './project-file.mjs';
import { resolveAssets } from './series-assets.mjs';
import { scriptFor } from './series-script.mjs';
import { resolveContext } from './series-context.mjs';

function need(value, message) { if (!value) throw Error(message); }
const list = (value, label) => {
  need(Array.isArray(value), 'Expected a list of ' + label);
  return value;
};

export function validateBinding(binding) {
  need(binding && typeof binding === 'object' && !Array.isArray(binding), 'Invalid seriesContext');
  for (const key of Object.keys(binding)) need(['file','episode','role','shot','includeAudience'].includes(key), 'Unknown seriesContext field: ' + key);
  localPath(binding.file, 'seriesContext.file');
  need(safeId(binding.episode) && safeId(binding.role), 'seriesContext needs an episode and a role');
  need(binding.includeAudience === undefined || typeof binding.includeAudience === 'boolean', 'Invalid seriesContext.includeAudience');
  need(binding.shot === undefined || safeId(binding.shot), 'Invalid seriesContext.shot');
}

export function openSeries(file) {
  const manifest = realpathSync(file), root = dirname(manifest), series = json(manifest);
  need(series?.version === 1 && safeId(series.id), 'Expected series version 1 and a series ID');
  const episodes = new Map();
  for (const path of list(series.episodes, 'episode files')) {
    const source = realFile(root, localPath(path, 'episode'));
    const episode = json(source);
    need(safeId(episode.id) && !episodes.has(episode.id), 'Invalid or duplicate episode ID: ' + episode.id);
    episodes.set(episode.id, {file: source, data: episode});
  }
  return {manifest, root, series, episodes};
}

export function getEpisode(project, id) {
  need(project.episodes.has(id), 'Unknown episode: ' + id);
  return project.episodes.get(id);
}

function shotList(episode) {
  const ids = new Set(), scenes = new Set(), shots = [];
  for (const scene of list(episode.scenes, 'scenes')) {
    need(safeId(scene.id) && !scenes.has(scene.id), 'Invalid or duplicate scene: ' + scene.id);
    scenes.add(scene.id);
    for (const shot of list(scene.shots, 'shots')) {
      need(safeId(shot.id) && !ids.has(shot.id), 'Invalid or duplicate shot: ' + shot.id);
      ids.add(shot.id);
      shots.push({scene, shot});
    }
  }
  return shots;
}

function roleNames(series, episode, shots) {
  const names = new Set(list(series.roles ?? [], 'roles'));
  const collect = rows => {
    for (const row of rows ?? []) for (const role of row.roles ?? []) names.add(role);
  };
  collect(series.channel?.defaults); collect(series.defaults); collect(series.seasons?.[episode.season]?.defaults);
  collect(series.events); collect(series.board); collect(episode.defaults); collect(episode.beats);
  const structure = Object.hasOwn(episode,'structure') ? episode.structure : series.structure;
  if (structure && Object.hasOwn(series.structures ?? {},structure)) collect(series.structures[structure].beats);
  for (const {scene, shot} of shots) { collect(scene.defaults); collect(shot.defaults); collect(shot.uses); }
  need(names.size && [...names].every(safeId), 'Declare series roles or assign roles to creative decisions');
  return [...names].sort();
}

function boardNotes(series, episode, scene, shot, role) {
  const notes = list(series.board ?? [], 'board notes'), ids = new Set();
  for (const note of notes) {
    need(safeId(note?.id) && !ids.has(note.id), 'Invalid or duplicate board note');
    ids.add(note.id);
    need(Array.isArray(note.roles) && note.roles.length && note.roles.every(safeId), 'Declare board note recipients');
    for (const scope of ['episode','scene','shot'])
      need(note[scope] === undefined || safeId(note[scope]), 'Invalid board ' + scope);
  }
  return notes.filter(note =>
    Array.isArray(note.roles) && note.roles.includes(role) &&
    (!note.episode || note.episode === episode.id) && (!note.scene || note.scene === scene.id) &&
    (!note.shot || note.shot === shot.id)).map(note => {
    need(safeId(note.id) && typeof note.note === 'string' && note.note.trim() &&
      typeof note.source === 'string' && note.source.trim(), 'Board notes need an ID, annotation and source');
    return {id:note.id, note:note.note, source:note.source};
  });
}

export function inspectProject(project, {episode: id, shot: shotId, role, includeAudience = false}) {
  const {series, root} = project, episode = getEpisode(project, id).data;
  const shots = shotList(episode);
  if (shotId) need(shots.some(({shot}) => shot.id === shotId), 'Unknown shot: ' + shotId);
  const available = roleNames(series, episode, shots);
  if (role) need(available.includes(role), 'Unknown series role: ' + role);
  const rows = [];
  for (const {scene,shot} of shots) {
    if (shotId && shot.id !== shotId) continue;
    const entries = (role ? [role] : available).map(name => {
      const context = resolveContext(series, episode, shot.id, name, {includeAudience});
      const assets = resolveAssets(root, series, shot, context, name);
      const board = boardNotes(series, episode, scene, shot, name);
      const script = scriptFor(series,episode,scene,shot,name);
      return [name, {...context, assets, board, script}];
    });
    rows.push({id:shot.id, scene:scene.id, roles:Object.fromEntries(entries)});
  }
  return {version:1, series:series.id, episode:id, shots:rows};
}

export function inspectSeries(file, selection) { return inspectProject(openSeries(file), selection); }

export function snapshotSeriesFiles(report, root, dest) {
  mkdirSync(dest, {recursive:true, mode:0o700});
  const copied = new Map();
  for (const shot of report.shots) {
    for (const context of Object.values(shot.roles)) {
      for (const asset of context.assets) {
        for (const entry of [asset, ...asset.dependencies]) {
          const path = localPath(entry.path, 'series asset'), target = join(dest, path);
          if (copied.has(path)) {
            need(copied.get(path) === entry.sha256, 'Inconsistent series asset: ' + path);
            continue;
          }
          mkdirSync(dirname(target), {recursive:true, mode:0o700});
          need(!existsSync(target), 'Overlapping series files: ' + path);
          copyFileSync(realFile(root,path), target, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
          need(stamp(target).sha256 === entry.sha256, 'Series asset changed during snapshot: ' + path);
          copied.set(path, entry.sha256);
        }
      }
    }
  }
}

// Only registered project workflows participate. A downstream cut may use a shot
// through several intermediate stages, including approval-only dependencies.
function workflowConsumers(project, episode) {
  const graphs = [];
  const paths = list(episode.workflows ?? [], 'episode workflows');
  for (const path of new Set(paths)) {
    const manifest = realFile(project.root,localPath(path,'episode workflow'));
    const spec = json(manifest);
    need(spec.version === 1 && Array.isArray(spec.stages), 'Invalid registered workflow: ' + path);
    const stages = new Map(spec.stages.map(stage => [stage.id,stage]));
    need(stages.size === spec.stages.length, 'Duplicate stage in ' + path);
    const bindings = new Map();
    for (const stage of stages.values()) {
      need(safeId(stage.id) && Array.isArray(stage.needs ?? []) &&
        (stage.needs ?? []).every(dep => stages.has(dep)), 'Invalid workflow dependencies in ' + path);
      if (!stage.seriesContext) continue;
      validateBinding(stage.seriesContext);
      const binding = stage.seriesContext;
      if (binding.episode === episode.id && realFile(dirname(manifest),binding.file) === project.manifest)
        bindings.set(stage.id,binding);
    }
    graphs.push({path,stages,bindings});
  }
  return (shot,role) => graphs.flatMap(({path,stages,bindings}) => {
    const hits = new Set([...bindings].filter(([,b]) => b.role === role && (!b.shot || b.shot === shot)).map(([id])=>id));
    const direct = new Set(hits);
    for (let size = -1; size !== hits.size;) {
      size = hits.size;
      for (const stage of stages.values()) {
        if ((stage.needs ?? []).some(id => hits.has(id))) hits.add(stage.id);
      }
    }
    return [...hits].map(id => ({workflow:path,stage:id,direct:direct.has(id),outputs:Object.keys(stages.get(id).outputs ?? {})}));
  });
}

// A candidate is resolved against the same role, facts, controls and files as the working shot.
export function assetUses(project, selection) {
  const {asset, candidate, episode: episodeId, shot: shotId, representation} = selection;
  need(safeId(asset) && Object.hasOwn(project.series.assets ?? {}, asset), 'Unknown series asset: ' + asset);
  if (episodeId) getEpisode(project,episodeId);
  const uses = [];
  for (const {data:episode} of project.episodes.values()) {
    if (episodeId && episode.id !== episodeId) continue;
    const report = inspectProject(project, {episode:episode.id,shot:shotId});
    const shots = new Map(shotList(episode).map(({shot}) => [shot.id,shot]));
    const consumers = workflowConsumers(project,episode);
    for (const row of report.shots) {
      for (const [role, context] of Object.entries(row.roles)) {
        const shot = shots.get(row.id);
        const visible = (shot.uses ?? []).filter(use => use.roles.includes(role));
        for (const [i,binding] of context.assets.entries()) {
          if (binding.asset !== asset || (representation && binding.representation !== representation)) continue;
          const use = shot.uses.indexOf(visible[i]);
          if (selection.use !== undefined && use !== selection.use) continue;
          const record = {episode:episode.id,scene:row.scene,shot:row.id,role,use,asset,
            variant:binding.variant,representation:binding.representation,revision:binding.revision,sha256:binding.sha256,consumers:consumers(row.id,role)};
          if (candidate) {
            const base = visible[i];
            try {
              const [next] = resolveAssets(project.root, project.series,
                {...shot, uses:[{...base,revision:candidate}]}, context, role);
              record.candidate = {revision:next.revision, sha256:next.sha256,
                changed:digest(binding) !== digest(next)};
            } catch (error) { record.candidate = {revision:candidate, unavailable:error.message}; }
          }
          uses.push(record);
        }
      }
    }
  }
  return uses;
}
