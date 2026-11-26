import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {copyFileSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ROOT,ff,json,write} from '../src/common.mjs';
import {render} from '../src/render.mjs';
import {validate} from '../src/model.mjs';
import {inspectBundle} from '../src/integrity.mjs';
import {wav} from '../src/speech.mjs';

const cliPath=join(ROOT,'src/cli.mjs');
function cli(args,env=process.env) {
  return execFileSync(process.execPath,[cliPath,...args],{encoding:'utf8',env,stdio:['ignore','pipe','pipe']}).trim();
}
function workspace(t) {
  const dir=mkdtempSync(join(tmpdir(),'folio-brand-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  return dir;
}

test('init schedules one local example, and its cadence and zone are editable',t=>{
  const channel=workspace(t),tz='Pacific/Kiritimati',env={...process.env,TZ:tz};
  const localDay=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:tz}).format(new Date());
  const before=localDay();
  cli(['init',channel],env);
  const brand=json(join(channel,'brand.json')),cfg=brand.schedule;
  assert.ok([before,localDay()].includes(cfg.start));
  assert.equal(cfg.timezone,tz);
  assert.deepEqual(cfg.shortDays,[new Date(cfg.start+'T12:00:00Z').getUTCDay()||7]);
  assert.equal(cfg.shortTarget,1);
  assert.equal(cfg.longTarget,0);
  let rows=cli(['schedule','--channel',channel]).split('\n');
  assert.equal(rows.length,2);
  assert.ok(rows[1].startsWith('"'+cfg.start+'T18:00","'+tz+'","short","rolling-wheel"'));
  const status=JSON.parse(cli(['status','--channel',channel,'--out',join(channel,'exports')]));
  assert.equal(status.shortsToReserve,1);
  assert.equal(status.longsToReserve,0);
  Object.assign(cfg,{start:'2030-06-01',timezone:'Europe/Paris',shortDays:[1],shortTime:'10:30'});
  write(join(channel,'brand.json'),brand);
  rows=cli(['schedule','--channel',channel]).split('\n');
  assert.ok(rows[1].startsWith('"2030-06-03T10:30","Europe/Paris"'));
});

test('a recorded channel replays with its bundled font, and replacing the face changes the encoded picture',async t=>{
  const dir=workspace(t),channel=join(dir,'source'),cache=join(dir,'cache'),out=join(dir,'out'),recordings=join(dir,'takes');
  const fontDir=join(channel,'type'),fixtures=join(ROOT,'assets/fonts');
  mkdirSync(fontDir,{recursive:true});
  function installFont(file,license) {
    copyFileSync(join(fixtures,file),join(fontDir,'editorial.ttf'));
    copyFileSync(join(fixtures,license),join(fontDir,'OFL.txt'));
  }
  installFont('DMSerifText-Regular.ttf','DMSerifText-LICENSE.txt');
  const brand=json(join(ROOT,'tests/fixtures/studio.json'));
  brand.name='Specimen studio';
  brand.theme.display='Editorial';
  brand.fonts=[{family:'Editorial',file:'type/editorial.ttf',license:'type/OFL.txt',credit:'Fixture font designers'}];
  const episode={id:'specimen',title:'A specimen',format:'short',question:'Which face is on the page?',
    sources:[{id:'sample',title:'Test sheet',url:'https://example.org/sheet',locator:'Panel A',support:'A drawn specimen.'}],
    shots:[{id:'face',heading:'The sample heading',voice:'Here is the specimen.',direction:'Hold the reference letters.',component:'sample',refs:['sample'],motion:0}]};
  write(join(channel,'brand.json'),brand);
  write(join(channel,'episodes',episode.id+'.json'),episode);
  write(join(channel,'components/sample.mjs'),[
    'export default function draw(ctx,{theme}) {',
    '  if(theme.fonts.Editorial !== theme.display) throw Error("Missing font alias");',
    '  ctx.font=\'120px "\'+theme.fonts.Editorial+\'"\';',
    '  ctx.fillStyle=theme.ink;',
    '  ctx.fillText("Ag Qq 123",80,430);',
    '}'].join('\n'));
  mkdirSync(join(recordings,episode.id),{recursive:true});
  const samples=Buffer.alloc(48000);
  for(let i=0;i<24000;i++)samples.writeInt16LE(Math.round(4400*Math.sin(2*Math.PI*440*i/24000)),i*2);
  writeFileSync(join(recordings,episode.id,'face.wav'),wav(samples));
  const settings={channel,brand,e:episode,out,cache,recordings,quiet:true,trackDefinitions:true};
  const first=await render(settings);
  const project=join(first,'project'),face='project/type/editorial.ttf',license='project/type/OFL.txt';
  const files=json(join(first,'receipt.json')).files;
  assert.ok(files[face]?.sha256&&files[license]?.sha256);
  assert.deepEqual(readFileSync(join(first,face)),readFileSync(join(fixtures,'DMSerifText-Regular.ttf')));
  assert.deepEqual(readFileSync(join(first,license)),readFileSync(join(fixtures,'DMSerifText-LICENSE.txt')));
  assert.deepEqual(json(join(project,'brand.json')).fonts,brand.fonts);
  assert.match(readFileSync(join(first,'sources.md'),'utf8'),/Fixture font designers/);
  assert.ok(inspectBundle(first).fullDecode);
  const pictureHash = dir => ff(['-i', join(dir, 'film.mp4'), '-map', '0:v:0',
    '-frames:v', '1', '-f', 'hash', '-hash', 'sha256', '-']);
  const originalPicture = pictureHash(first);
  const cacheKeys=()=>readdirSync(join(cache,'shots')).filter(f=>f.endsWith('.mp4')).sort();
  const keys=cacheKeys();
  assert.equal(keys.length,1);
  const firstPoster=readFileSync(join(first,'poster.png'));
  // A separate Node process has an empty native font registry and picture cache.
  const replay=cli(['render',episode.id,'--channel',project,'--recordings',join(project,'takes'),
    '--out',join(dir,'replay-out'),'--cache',join(dir,'replay-cache'),'--quiet']);
  assert.deepEqual(readFileSync(join(replay,'poster.png')),firstPoster);
  assert.equal(pictureHash(replay), originalPicture);
  assert.deepEqual(readdirSync(join(dir,'replay-cache','shots')).filter(f=>f.endsWith('.mp4')),keys);
  installFont('DMSans.ttf','DMSans-LICENSE.txt');
  const second=await render(settings);
  assert.notEqual(first,second);
  assert.equal(cacheKeys().length,2);
  assert.notDeepEqual(readFileSync(join(second,'poster.png')),firstPoster);
  assert.ok(inspectBundle(second).fullDecode);
  assert.notEqual(pictureHash(second), originalPicture);
  rmSync(join(fontDir,'OFL.txt'));
  assert.throws(()=>validate(episode,channel),/Missing channel font license/);
});
