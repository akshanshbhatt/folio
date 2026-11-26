import {randomUUID} from 'node:crypto';
import {existsSync, linkSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {digest, safeId} from './common.mjs';
import {withLock} from './integrity.mjs';
import {localPath, realFile, replaceJson} from './project-file.mjs';
import {inspectProject, openSeries} from './series.mjs';

const need = (ok,message) => { if (!ok) throw Error(message); };
const encoded = doc => Buffer.from(JSON.stringify(doc,null,2)+'\n');

// Publish only complete JSON at a filename that does not exist.
function createJson(file, bytes) {
  const temporary = join(dirname(file),'.folio-create-'+randomUUID()+'.tmp');
  try {
    writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});
    linkSync(temporary,file);
  } finally { rmSync(temporary,{force:true}); }
}

function newSeries(file, options) {
  need(safeId(options.id),'Supply a series --id');
  const role = options.role ?? 'creator';
  need(safeId(role),'Choose a role ID');
  const absolute = resolve(file);
  mkdirSync(dirname(absolute),{recursive:true});
  const manifest = join(realpathSync(dirname(absolute)),basename(absolute));
  createJson(manifest,encoded({version:1,id:options.id,roles:[role],channel:{defaults:[]},defaults:[],
    seasons:{},events:[],board:[],assets:{},episodes:[]}));
  return {series:options.id,role,file:manifest};
}

function episodePath(root, requested) {
  if (isAbsolute(requested)) {
    // macOS commonly exposes /private/var through /var. Resolve the existing
    // prefix even when the requested episode itself has not been created.
    const absolute = resolve(requested);
    let ancestor = absolute;
    while (!existsSync(ancestor)) ancestor = dirname(ancestor);
    requested = relative(root,join(realpathSync(ancestor),relative(ancestor,absolute)));
  }
  const path = localPath(requested,'Episode file');
  let parent = root;
  for (const name of path.split('/').slice(0,-1)) {
    const next = join(parent,name);
    if (!existsSync(next)) mkdirSync(next);
    parent = realpathSync(next);
    const rel = relative(root,parent);
    need(rel !== '..' && !rel.startsWith('..'+sep) && !isAbsolute(rel),'Episode directory outside its series');
    need(lstatSync(parent).isDirectory(),'Invalid episode directory');
  }
  return {path,destination:join(parent,basename(path))};
}

function addEpisode(file, options) {
  const {id,season} = options;
  need(safeId(id) && (season === undefined || safeId(season)),'Supply an episode --id and a valid optional season ID');
  const project = openSeries(file);
  need(!project.episodes.has(id),'Episode already registered: '+id);
  const before = readFileSync(project.manifest);
  need(digest(JSON.parse(before)) === digest(project.series),'Series changed before episode creation');
  const {path,destination} = episodePath(project.root,options.file ?? id+'.json');
  const existing = existsSync(destination);
  let episode, bytes;
  if (existing) {
    const source = realFile(project.root,path);
    need(source !== project.manifest,'An episode needs its own file');
    bytes = readFileSync(source);
    episode = JSON.parse(bytes);
    need(episode?.id === id && Array.isArray(episode.scenes),'Existing episode must match --id and declare its scenes');
    need(season === undefined || season === episode.season,'The supplied season differs from the existing episode');
  } else {
    episode = {id,...(season ? {season} : {}),defaults:[],
      scenes:[{id:'opening',defaults:[],shots:[{id:'first-shot',defaults:[],uses:[]}]}]};
    bytes = encoded(episode);
  }

  if (episode.season != null) {
    need(safeId(episode.season),'Invalid episode season ID');
    const seasons = project.series.seasons ??= {};
    if (!Object.hasOwn(seasons,episode.season)) Object.defineProperty(seasons,episode.season,{
      value:{defaults:[]},enumerable:true,writable:true,configurable:true});
  }
  project.series.episodes.push(path);
  project.episodes.set(id,{file:destination,data:episode});
  const inspected = inspectProject(project,{episode:id});

  let created;
  try {
    if (existing) need(bytes.equals(readFileSync(realFile(project.root,path))),'Episode changed during registration');
    else {
      createJson(destination,bytes);
      created = lstatSync(destination);
    }
    replaceJson(project.manifest,before,project.series);
  } catch (error) {
    // Leave a concurrent editor's replacement alone if registration loses its race.
    if (created && existsSync(destination)) {
      const now = lstatSync(destination);
      if (now.dev === created.dev && now.ino === created.ino && bytes.equals(readFileSync(destination))) rmSync(destination);
    }
    throw error;
  }
  return {series:project.series.id,episode:id,season:episode.season ?? null,file:path,
    mode:existing ? 'registered' : 'created',shots:inspected.shots.map(shot => shot.id)};
}

export async function startSeries(action, file, options) {
  if (action === 'init') return newSeries(file,options);
  need(action === 'new-episode','Choose init or new-episode');
  return withLock(join(dirname(realpathSync(file)),'.folio','series-edit.lock'),() => addEpisode(file,options));
}
