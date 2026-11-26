import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {json,ROOT,write} from '../src/common.mjs';

test('brief and draft carry a custom channel’s local example, component inputs and research notes through the CLI', t=>{
  const dir=mkdtempSync(join(tmpdir(),'folio-brief-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const channel=join(dir,'optics'),cli=(...args)=>execFileSync(process.execPath,[join(ROOT,'src/cli.mjs'),...args,'--channel',channel],{encoding:'utf8'}).trim();
  write(join(channel,'brand.json'),{name:'Optical Bench',description:'One measurable optical experiment.',modules:['optics']});
  write(join(channel,'optics','spectrometer.mjs'),'export default function draw(c,{params}){c.fillText(params.mode,0,0)}');
  write(join(channel,'optics','math.mjs'),'export function distance(a,b){return Math.abs(a-b)}');
  const empty=JSON.parse(cli('brief','Where does violet light end?'));
  assert.equal(empty.example,null);assert.ok(empty.episodeFields.shot.includes('component'));
  assert.deepEqual(empty.components,['media','spectrometer','web']);
  const source={id:'bench',title:'Bench readings',url:'https://example.org/optics',locator:'Table 4',support:'Centred readings.'};
  function ep(id,title,shots){return {id,title,question:title,format:'short',sources:[source],shots:shots.map((params,i)=>({
    id:'reading-'+(i+1),heading:'Read '+params.mode,voice:'Watch the marked scale.',direction:'Move the slit to '+params.mode+'.',
    component:'spectrometer',refs:['bench'],params}))};}
  write(join(channel,'episodes','dark-sky.json'),ep('dark-sky','Which hours are dark?',[{mode:'night',angle:25}]));
  const bands=[{nm:401,value:6},{nm:420,value:20}];
  write(join(channel,'episodes','violet-line.json'),ep('violet-line','Where does the violet spectrum end?',[{mode:'violet',bands}]));
  const briefFile=join(dir,'brief.json');cli('brief','Where does violet meet the spectrum?','--file',briefFile);
  const brief=json(briefFile);assert.equal(brief.channel,'Optical Bench');assert.equal(brief.example.id,'violet-line');
  assert.equal(brief.exampleFile,'episodes/violet-line.json');assert.equal(brief.componentGuide.spectrometer.module,'optics/spectrometer.mjs');
  const evidence=brief.componentGuide.spectrometer;
  assert.deepEqual(evidence.observedParams,{angle:'number',bands:'array',mode:'string'});
  assert.deepEqual(evidence.examples[0].params,{mode:'violet',bands});assert.equal(evidence.examples[0].use,'Move the slit to violet.');
  assert.deepEqual(Object.keys(brief.componentGuide).sort(), ['media', 'spectrometer', 'web']);
  brief.sourceNotes=[{url:source.url,locator:source.locator,support:source.support}];write(briefFile,brief);
  const writer=join(dir,'writer.mjs');write(writer,`
    import {readFileSync} from 'node:fs';
    const prompt=readFileSync(0,'utf8'),brief=JSON.parse(prompt.trimEnd().split('\\n').at(-1));
    const draft={...brief.example,id:'violet-draft',title:brief.question};
    const shot=draft.shots[0];shot.params=brief.componentGuide[shot.component].examples[0].params;
    console.log(JSON.stringify(draft));
  `);
  const config=join(dir,'provider.json');write(config,{command:[process.execPath,writer]});
  const dest=join(dir,'draft.json');cli('draft',briefFile,'--provider',config,'--file',dest);
  assert.deepEqual(json(dest).shots[0].params,{mode:'violet',bands});assert.equal(json(dest).id,'violet-draft');
});
