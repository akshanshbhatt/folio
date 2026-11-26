import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCanvas} from '@napi-rs/canvas';
import {ROOT,json,write} from '../src/common.mjs';
import {inspectBundle} from '../src/integrity.mjs';
import {wav} from '../src/speech.mjs';

test('CLI isolates one recorded shot with its measured reveal, image, captions and source', t=>{
  const dir=mkdtempSync(join(tmpdir(),'folio-proof-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const ch=join(dir,'channel'),out=join(dir,'exports'),cache=join(dir,'cache'),takes=join(dir,'takes');
  const brand=json(join(ROOT,'tests/fixtures/studio.json'));
  const samples=Buffer.alloc(48000);
  for(let i=0;i<samples.length/2;i++)samples.writeInt16LE(Math.round(4400*Math.sin(2*Math.PI*440*i/24000)),i*2);
  const episode='bench-indicator',id='reveal';
  const e={id:episode,title:'The bench indicator',format:'short',question:'Which lamp is active?',sources:[
    {id:'unused',title:'Earlier question',url:'https://example.org/first',locator:'demo',support:'Separate claim.'},
    {id:'indicator',title:'Indicator swatch',url:'https://example.org/indicator',locator:'sample',support:'The sample lamp is amber.'}],
    shots:[{id:'ask',heading:'Ask first',voice:'Here is a different question.',direction:'Hold before the answer.',component:'media',refs:['unused'],params:{file:'one.png',credit:'Studio',rights:'Original'}},
      {id,heading:'Read the lamp',section:'Indicator check',voice:'Watch the bench. Read the lamp.',direction:'Frame the amber lamp.',component:'media',
        params:{file:'one.png',credit:'Studio',rights:'Original'},refs:['indicator'],motionAt:{sentence:2,edge:'start'},lead:.1,hold:.1,motion:0}]};
  write(join(ch,'brand.json'),brand);write(join(ch,'episodes',episode+'.json'),e);mkdirSync(join(ch,'components'));
  const canvas=createCanvas(24,24),ctx=canvas.getContext('2d');ctx.fillStyle='#e5c782';ctx.fillRect(0,0,24,24);writeFileSync(join(ch,'one.png'),canvas.toBuffer('image/png'));
  mkdirSync(join(takes,episode),{recursive:true});writeFileSync(join(takes,episode,id+'.wav'),wav(samples));
  write(join(takes,episode,id+'.json'),[{start:0,end:.38,text:'Watch the bench.'},{start:.53,end:1,text:'Read the lamp.'}]);
  const master=join(out,episode,'master','latest.json');write(master,{revision:'protected'});const prior=readFileSync(master);
  const cli=(...args)=>execFileSync(process.execPath,[join(ROOT,'src/cli.mjs'),...args,'--channel',ch,'--cache',cache,'--out',out,'--quiet'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  assert.throws(()=>cli('proof',episode,'--shot','missing'),/Expected one shot/);
  const bundle=cli('proof',episode,'--shot',id,'--recordings',takes,'--subs','both');
  assert.ok(bundle.startsWith(join(out,'shot-proofs',id,episode,'review')+'/'));
  const q=inspectBundle(bundle),clip=json(join(bundle,'project','episodes',episode+'.json'));
  assert.equal(q.narration,'recorded');assert.equal(q.subtitleMode,'both');assert.equal(clip.shots.length,1);
  assert.equal(clip.proofOf.ordinal,2);assert.equal(clip.proofOf.shotCount,2);assert.equal(clip.shots[0].heading,'Read the lamp');assert.match(clip.shots[0].section,/Shot proof.*Indicator check/);
  assert.deepEqual(clip.sources.map(s=>s.id),['indicator']);assert.deepEqual(clip.shots[0].refs,['indicator']);
  assert.ok(Math.abs(json(join(bundle,'timeline.json')).shots[0].motionStart-.63)<1e-6);
  assert.ok(existsSync(join(bundle,'poster.png')));assert.equal(readFileSync(join(bundle,'poster.png')).readUInt32BE(16),720);
  assert.deepEqual(readFileSync(master),prior);assert.ok(!existsSync(join(out,episode,'review')));
});
