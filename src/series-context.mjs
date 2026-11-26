// Resolve one recipient's creative decisions and story knowledge for one shot.
import {isDeepStrictEqual} from 'node:util';
import {safeId} from './common.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const keyName = value => typeof value === 'string' && /^[a-z][a-zA-Z0-9_-]*(?:\.[a-z][a-zA-Z0-9_-]*)*$/.test(value);
const need = (ok, message) => { if (!ok) throw Error(message); };

function list(value, label) {
  if (value === undefined) return [];
  need(Array.isArray(value), label + ' must be an array');
  return value;
}

function recipients(roles) {
  need(Array.isArray(roles) && roles.length && roles.every(safeId)
    && roles.length === new Set(roles).size, 'Context records require explicit, distinct recipient roles');
  return roles;
}

function provenance(row) {
  need(Object.hasOwn(row,'value') && row.value !== undefined, 'Context record requires a value');
  need(text(row.source), 'Context record requires a source');
  need(row.revision === undefined || text(row.revision), 'Source revision must be a nonempty string');
  return {value:structuredClone(row.value), source:row.source, ...(row.revision ? {revision:row.revision} : {})};
}

function locateShot(episode, shotId) {
  need(safeId(shotId), 'Select a shot by ID');
  const scenes = new Set(), shots = new Set();
  let selected;
  for (const scene of list(episode.scenes,'Episode scenes')) {
    need(record(scene) && safeId(scene.id) && !scenes.has(scene.id), 'Invalid or duplicate scene ID');
    scenes.add(scene.id);
    for (const shot of list(scene.shots,'Scene shots')) {
      need(record(shot) && safeId(shot.id) && !shots.has(shot.id), 'Shot IDs must be distinct across this episode');
      shots.add(shot.id);
      if (shot.id === shotId) selected = {scene,shot};
    }
  }
  need(selected, 'Unknown shot: ' + shotId);
  return selected;
}

function decisionsFor(scopes, role) {
  const decisions = new Map();
  for (const [scope, scopeId, document] of scopes) {
    const seen = new Set();
    for (const row of list(document?.defaults,scope + ' defaults')) {
      need(record(row), 'Invalid default');
      if (!recipients(row.roles).includes(role)) continue;
      need(keyName(row.key), 'Invalid decision key');
      need(!seen.has(row.key), 'Conflicting ' + scope + ' defaults for ' + role + ': ' + row.key);
      seen.add(row.key);
      need(row.locked === undefined || typeof row.locked === 'boolean', 'locked must be a boolean');
      const decision = {...provenance(row),scope,scopeId,locked:row.locked === true};
      const prior = decisions.get(row.key);
      const history = [];
      if (prior) {
        const {history:ancestors,...parent} = prior;
        need(!parent.locked || isDeepStrictEqual(parent.value,decision.value),
          'Locked decision ' + row.key + ' from ' + parent.scope + ' conflicts with ' + scope);
        history.push(...ancestors,parent);
        decision.locked ||= parent.locked;
      }
      decisions.set(row.key,{...decision,history});
    }
  }
  return Object.fromEntries(decisions);
}

function storyFor(events, role, storyTime, audienceTime, includeAudience) {
  const applicable = [], audience = [], seen = new Set();
  for (const event of list(events,'Story events')) {
    need(record(event), 'Invalid story event');
    if (!recipients(event.roles).includes(role)) continue;
    need(Number.isSafeInteger(event.at), 'Story event needs an integer story time');
    const inStory = storyTime !== null && event.at <= storyTime;
    const shareReveal = includeAudience && audienceTime !== null && event.audienceRoles !== undefined
      && recipients(event.audienceRoles).includes(role);
    if (shareReveal) need(Number.isSafeInteger(event.audienceAt), 'Audience reveal needs an integer audience time');
    const inAudience = shareReveal && event.audienceAt <= audienceTime;
    if (!inStory && !inAudience) continue;
    need(safeId(event.id) && !seen.has(event.id), 'Invalid or duplicate visible event ID');
    seen.add(event.id);
    need(keyName(event.fact), 'Invalid story fact key');
    const fact = {id:event.id, at:event.at, fact:event.fact, ...provenance(event)};
    if (inAudience) {
      audience.push({...fact,audienceAt:event.audienceAt});
    }
    if (!inStory) continue;
    const learning = event.learned === undefined ? {} : event.learned;
    need(record(learning), 'learned must map character IDs to story times');
    const observed = [];
    for (const [character,at] of Object.entries(learning)) {
      need(safeId(character) && Number.isSafeInteger(at) && at >= event.at,
        'A character can learn an event at or after its story time');
      if (at <= storyTime) observed.push([character,at]);
    }
    applicable.push({...fact,knownBy:observed.map(([id]) => id).sort(), learned:Object.fromEntries(observed)});
  }

  // A character may still believe the earlier state after the world has changed.
  const world = new Map(), cast = new Map();
  for (const event of applicable.sort((a,b) => a.at-b.at)) {
    need(world.get(event.fact)?.at !== event.at,
      'Competing events set ' + event.fact + ' at story time ' + event.at);
    world.set(event.fact,event);
    for (const [character,learnedAt] of Object.entries(event.learned)) {
      if (!cast.has(character)) cast.set(character,new Map());
      cast.get(character).set(event.fact,{value:structuredClone(event.value), event:event.id, learnedAt});
    }
  }
  return {
    facts:[...world.values()],
    knowledge:Object.fromEntries([...cast].map(([id,values]) => [id,Object.fromEntries(values)])),
    ...(includeAudience ? {audience:audience.sort((a,b) => a.audienceAt-b.audienceAt)} : {}),
  };
}

export function resolveContext(series, episode, shotId, role, {includeAudience = false} = {}) {
  need(record(series) && series.version === 1 && safeId(series.id), 'Expected a version 1 series with an ID');
  need(record(episode) && safeId(episode.id) && safeId(role), 'Select an episode and recipient role');
  const {scene,shot} = locateShot(episode,shotId);
  need(series.channel === undefined || record(series.channel), 'Invalid channel scope');
  if (series.channel?.id !== undefined) need(safeId(series.channel.id), 'Invalid channel ID');
  need(series.seasons === undefined || record(series.seasons), 'Seasons must be keyed by ID');
  const season = episode.season ?? null;
  if (season !== null) need(safeId(season) && Object.hasOwn(series.seasons ?? {},season) && record(series.seasons[season]), 'Unknown episode season: ' + season);
  const scopes = [
    ['channel',series.channel?.id ?? 'channel',series.channel], ['series',series.id,series],
    ['season',season,season === null ? undefined : series.seasons[season]],
    ['episode',episode.id,episode], ['scene',scene.id,scene], ['shot',shot.id,shot],
  ];
  const storyTime = shot.storyTime ?? scene.storyTime ?? null;
  const audienceTime = shot.audienceOrder ?? scene.audienceOrder ?? episode.releaseOrder ?? null;
  need(storyTime === null || Number.isSafeInteger(storyTime), 'Use an integer story time');
  need(audienceTime === null || Number.isSafeInteger(audienceTime), 'Use an integer audience order');
  return {
    series:series.id, episode:episode.id, season, scene:scene.id, shot:shot.id, role, storyTime,
    decisions:decisionsFor(scopes,role),
    ...storyFor(series.events,role,storyTime,audienceTime,includeAudience),
  };
}
