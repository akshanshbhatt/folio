import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ROOT} from '../src/common.mjs';
import {pcm,wav} from '../src/speech.mjs';

test('continuous take import retains PCM and sentence positions and refuses conflicting input', () => {
  const work=mkdtempSync(join(tmpdir(),'folio-align-'));
  try {
    const slug='measuring', script=join(work,'episode.json'), source=join(work,'session.wav');
    const transcript=join(work,'captions.json'), takes=join(work,'takes'), dest=join(takes,slug);
    const episode={id:slug,shots:[{id:'ask',voice:'Draw two marks. Count them.'},{id:'show',voice:'Read the interval.'}]};
    const rows=[{start:.1,end:.7,text:'Draw 2 marks.'},{start:.8,end:1.2,text:'Count them.'},
      {start:1.6,end:2.1,text:'Read the interval.'}];
    const audio=Buffer.alloc(24000*2*2.4);
    for(const row of rows){
      for(let sample=Math.round(row.start*24000);sample<Math.round(row.end*24000);sample++)
        audio.writeInt16LE(Math.round(1500*Math.sin(sample*2*Math.PI*220/24000)),2*sample);
    }
    writeFileSync(script,JSON.stringify(episode));
    writeFileSync(source,wav(audio));
    const run=out=>spawnSync('python3',[join(ROOT,'tools/align_take.py'),'--episode',script,
      '--take',source,'--transcript',transcript,'--recordings',out],{encoding:'utf8'});
    writeFileSync(transcript,JSON.stringify(rows));
    const imported=run(takes);assert.equal(imported.status,0,imported.stderr);
    const first=pcm(join(dest,'ask.wav')),second=pcm(join(dest,'show.wav'));
    assert.deepEqual(Buffer.concat([first.bytes,second.bytes]),audio);
    assert.deepEqual(pcm(source).bytes,audio);
    assert.equal(first.duration,1.4);
    const timings=JSON.parse(readFileSync(join(dest,'show.json')));
    assert.deepEqual(timings,[{start:.2,end:.7,text:'Read the interval.'}]);
    assert.match(run(takes).stderr,/Existing recording folder/);

    const wordRows=[rows[0],rows[1],{start:1.6,end:1.72,text:'Read'},
      {start:1.78,end:1.85,text:'the'},{start:1.91,end:2.1,text:'interval.'}];
    writeFileSync(transcript,JSON.stringify(wordRows));
    const wordParent=join(work,'word-takes'),wordImport=run(wordParent);
    assert.equal(wordImport.status,0,wordImport.stderr);
    const detailed=JSON.parse(readFileSync(join(wordParent,slug,'show.json')));
    assert.deepEqual(detailed.spans,timings);
    assert.deepEqual(detailed.words,[{start:.2,end:.32,text:'Read'},
      {start:.38,end:.45,text:'the'},{start:.51,end:.7,text:'interval.'}]);

    rows[0].text='Draw three marks.';
    writeFileSync(transcript,JSON.stringify(rows));
    const rejected=run(join(work,'mismatch'));
    assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/Check recording or transcript/);
    assert.equal(existsSync(join(work,'mismatch',slug)),false);

    writeFileSync(transcript,JSON.stringify([{start:.1,end:1.2,text:'Draw two marks. Count them.'},rows[2]]));
    assert.match(run(join(work,'coarse')).stderr,/crosses a sentence/);
  } finally {rmSync(work,{recursive:true,force:true});}
});
