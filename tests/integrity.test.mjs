import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync,truncateSync,unlinkSync} from 'node:fs';
import {ROOT,json,write,ff} from '../src/common.mjs';
import {inspectBundle} from '../src/integrity.mjs';
import {render,verifyMovie} from '../src/render.mjs';
import {wav} from '../src/speech.mjs';

test('a damaged export and cached shot recover together; normalized takes replay the original track', async t=>{
  const dir=mkdtempSync(join(tmpdir(),'folio-integrity-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const channel=join(dir,'channel'),out=join(dir,'out'),cache=join(dir,'cache'),takes=join(dir,'takes');
  const brand=json(join(ROOT,'tests/fixtures/studio.json'));
  const e={id:'repair-test',title:'Read the ruler',question:'Where is its mark?',format:'short',
    sources:[{id:'source',title:'Example ruler',url:'https://example.org/ruler',locator:'fixture',support:'A centred marker.'}],
    shots:[{id:'ruler',heading:'One mark',voice:'One visible mark.',direction:'Place the mark in the middle.',
      component:'mark',refs:['source'],motion:0,lead:.1,hold:.1}]};
  write(join(channel,'brand.json'),brand);write(join(channel,'episodes',e.id+'.json'),e);
  write(join(channel,'components','mark.mjs'),'export default function draw(c){c.fillRect(480,360,40,100)}');
  const samples=Buffer.alloc(48000*2);
  for(let i=0;i<samples.length/2;i++)samples.writeInt16LE(Math.round(4000*Math.sin(2*Math.PI*440*i/24000)),i*2);
  mkdirSync(join(takes,e.id),{recursive:true});writeFileSync(join(takes,e.id,'ruler.wav'),wav(samples));
  const settings={channel,out,cache,brand,e,recordings:takes,subs:'both',quiet:true};
  const first=await render(settings), firstQc=inspectBundle(first);
  assert.equal(firstQc.audioRemaster,undefined);assert.equal(firstQc.subtitleMode,'both');assert.match(firstQc.runtimeSources['src/mediaplate.mjs'],/^[a-f0-9]{64}$/);
  const relative=join('project','takes',e.id);
  assert.deepEqual(readFileSync(join(first,relative,'ruler.wav')),wav(samples));
  assert.deepEqual(json(join(first,relative,'ruler.json')),[{start:0,end:2,text:'One visible mark.'}]);

  const movie=join(first,'film.mp4'),bytes=readFileSync(movie);bytes[bytes.length>>1]^=1;writeFileSync(movie,bytes);
  assert.throws(()=>inspectBundle(first),/SHA-256/);
  unlinkSync(join(first,'captions.srt'));
  const pictures=join(cache,'shots'),shot=readdirSync(pictures).find(f=>f.endsWith('.mp4'));
  truncateSync(join(pictures,shot),90);
  const [fixed,other]=await Promise.all([render(settings),render(settings)]);
  assert.equal(fixed,other);assert.notEqual(first,fixed);assert.equal(inspectBundle(fixed).inputDigest,firstQc.inputDigest);
  assert.throws(()=>inspectBundle(first),/captions.srt/);
  assert.ok(readdirSync(pictures).some(f=>f.startsWith(shot+'.damaged-')));
  assert.equal(json(join(out,e.id,'review','latest.json')).revision,inspectBundle(fixed).revision);
  const second=await render({...settings,channel:join(fixed,'project'),out:join(dir,'replay'),recordings:join(fixed,'project','takes')});
  assert.deepEqual(readFileSync(join(fixed,'narration.wav')),readFileSync(join(second,'narration.wav')));
  assert.deepEqual(json(join(fixed,'timeline.json')).captions,json(join(second,'timeline.json')).captions);
  for(const subs of ['sidecar','burn','none']){
    const variant=await render({...settings,subs});
    assert.equal(inspectBundle(variant).subtitleMode,subs);
    assert.equal(readdirSync(variant).includes('captions.vtt'),subs==='sidecar');
  }
});

test('technical verification rejects a decodable file whose video clock is wrong', t=>{
  const dir=mkdtempSync(join(tmpdir(),'folio-clock-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'wrong-clock.mp4');
  ff(['-f','lavfi','-i','color=blue:s=160x90:r=15:d=2','-f','lavfi','-i','sine=frequency=501:duration=1',
    '-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-ar','48000',file]);
  assert.throws(()=>verifyMovie(file,{width:160,height:90,frames:30,fps:30}),/frame rate/);
});

test('the master corrects decoded AAC peaks and keeps the original picture and timing',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'folio-aac-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const channel=join(dir,'channel'),out=join(dir,'out'),cache=join(dir,'cache'),takes=join(dir,'takes');
  const brand=json(join(ROOT,'tests/fixtures/studio.json'));
  const e={id:'aac-peak',title:'Transient test',format:'short',question:'Where is the transient?',
    sources:[{id:'tone',title:'Tone generator',url:'https://example.org/signal',locator:'fixture',support:'A set of brief tone bursts.'}],
    shots:[{id:'tone',heading:'Tone bursts',voice:'Listen to the change.',component:'mark',
      refs:['tone'],direction:'Hold the grid.',lead:0,hold:0,motion:0}]};
  write(join(channel,'brand.json'),brand);
  write(join(channel,'components/mark.mjs'),'export default function draw(c){c.fillRect(90,200,120,25)}');
  const rate=24000,samples=Buffer.alloc(3*rate*2);
  // High-frequency transients over a quiet bed stress AAC reconstruction.
  // The later steady tone puts the integrated loudness in the speech range.
  for(let i=0;i<3*rate;i++){
    const time=i/rate,phase=i%12000;
    const bed=.035*Math.sin(2*Math.PI*440*time)*(.8+.2*Math.cos(2*Math.PI*4*time));
    const inBurst=time<1.5&&phase>=1751&&phase<1931;
    const burst=inBurst ? 0.5*Math.sign(Math.sin(2*Math.PI*6000*time)) : 0;
    const tail=time>1.55 ? 0.145*Math.sin(2*Math.PI*354*time) : 0;
    samples.writeInt16LE(Math.round((bed+burst+tail)*32767),2*i);
  }
  mkdirSync(join(takes,e.id),{recursive:true});writeFileSync(join(takes,e.id,'tone.wav'),wav(samples));
  const bundle=await render({channel,out,cache,brand,e,recordings:takes,quiet:true});
  const qc=inspectBundle(bundle),movie=join(bundle,'film.mp4');
  assert.ok(qc.audioRemaster.length>=1&&qc.audioRemaster.length<=2);
  assert.ok(qc.audioRemaster[0].truePeakDBTP>-.8);
  assert.ok(qc.audioRemaster[0].attenuationDb>0);
  const verified=verifyMovie(movie,qc);
  assert.ok(verified.truePeakDBTP<=-.8&&Math.abs(verified.integratedLUFS+17)<=2);
  assert.equal(verified.frames,90);assert.equal(verified.audioSeconds,3);
  const pictureDir=join(cache,'shots'),pictures=readdirSync(pictureDir).filter(f=>f.endsWith('.mp4'));
  assert.equal(pictures.length,1);
  const frameHash=file=>ff(['-i',file,'-map','0:v:0','-f','hash','-hash','sha256','-']);
  assert.equal(frameHash(movie),frameHash(join(pictureDir,pictures[0])));
});
