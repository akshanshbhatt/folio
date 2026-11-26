import {join} from 'node:path';
import {digest,json,safeId} from './common.mjs';
import {render} from './render.mjs';

export async function shotProof({channel,episodeId,shotId,out,...settings}) {
  if(!safeId(episodeId)||!safeId(shotId))throw Error('Use proof EPISODE --shot SHOT_ID');
  const episode=json(join(channel,'episodes',episodeId+'.json'));
  if(episode.id!==episodeId)throw Error('Episode ID differs from its filename: '+episodeId);
  const matches=episode.shots.filter(s=>s.id===shotId);
  if(matches.length!==1)throw Error('Expected one shot named '+shotId+' in '+episodeId);
  const shot=matches[0],ordinal=episode.shots.indexOf(shot)+1;
  const selection={
    ...episode,
    title:'Shot proof · '+episode.title+' · '+shot.heading,
    proofOf:{episode:episode.id,shot:shot.id,ordinal,shotCount:episode.shots.length,episodeDigest:digest(episode)},
    sources:episode.sources.filter(source=>shot.refs.includes(source.id)),
    shots:[{...shot,section:'Shot proof · '+(shot.section||'shot '+ordinal+' of '+episode.shots.length)}]
  };
  // Keep the real episode and shot IDs so the normal take lookup and source
  // project are usable even when none of the other shots has been recorded.
  return render({...settings,channel,e:selection,brand:json(join(channel,'brand.json')),out:join(out,'shot-proofs',shot.id)});
}
