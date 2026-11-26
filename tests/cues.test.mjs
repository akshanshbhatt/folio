import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ROOT,json,write,run} from '../src/common.mjs';
import {validateDirection,quoteRange,resolveActions,cueState,speechSegments} from '../src/cues.mjs';
import {validateTimings,wav,pcm,phrases,voiceSession} from '../src/speech.mjs';
import {samples} from '../src/video.mjs';
import {render} from '../src/render.mjs';
import {inspectBundle} from '../src/integrity.mjs';

const voice='Read the lamp. Read the lamp.';
const objects={lamp:{anchor:[750,410],opacity:0},home:{anchor:[500,410]}};
function testShot() {
  return {id:'lamp',voice,objects,actions:[
    {id:'pan-lamp',type:'pan',target:'lamp',at:{quote:'lamp',occurrence:2},curve:'linear',duration:.4},
    {id:'zoom-lamp',type:'zoom',scale:2,at:{quote:'lamp',occurrence:2},duration:.4,curve:'linear'},
    {id:'light-lamp',type:'reveal',target:'lamp',at:{mark:'switch'},duration:.2,curve:'linear'}
  ]};
}
const timing={
  spans:[{start:.1,end:.55,text:'Read the lamp.'},{start:.7,end:1.18,text:'Read the lamp.'}],
  words:[{start:.1,end:.19,text:'read'},{start:.21,end:.28,text:'the'},{start:.3,end:.55,text:'lamp'},
    {start:.7,end:.8,text:'read'},{start:.83,end:.9,text:'the'},{start:1,end:1.18,text:'lamp.'}],
  marks:[{id:'switch',start:1,end:1.2}]
};
const settings={lead:.1,frames:90,fps:30};

test('exact, case-sensitive quotes select an occurrence and require both measured boundaries',()=>{
  const s=testShot();validateDirection(s);
  assert.throws(()=>quoteRange(s,{quote:'lamp'}),/ambiguous/);
  assert.throws(()=>quoteRange(s,{quote:'Lamp',occurrence:1}),/does not match/);
  assert.throws(()=>quoteRange(s,{quote:'amp',occurrence:1}),/does not match/);
  assert.throws(()=>quoteRange(s,{quote:'the, lamp',occurrence:1}),/does not match/);
  assert.throws(()=>quoteRange(s,{quote:'lamp',occurrence:3}),/does not exist/);
  assert.throws(()=>resolveActions(s,{spans:timing.spans},settings),/no measured boundaries/);
  assert.throws(()=>resolveActions(s,{...timing,marks:[]},settings),/missing take mark/);
  const events=resolveActions(s,timing,settings);
  assert.deepEqual(events.map(e=>[e.startFrame,e.endFrame]),[[33,45],[33,45],[33,39]]);
  assert.deepEqual(events[0].source,{kind:'quote',text:'lamp',occurrence:2,start:1,end:1.18});
  assert.equal(events[2].source.kind,'mark');
  const end={...s,actions:[{...s.actions[0],at:{quote:'lamp',occurrence:1,edge:'end',offset:.05},duration:0}]};
  assert.equal(resolveActions(end,timing,settings)[0].startFrame,21);
  assert.throws(()=>resolveActions({...s,actions:[{...s.actions[0],duration:99}]},timing,settings),/outside the shot/);
  assert.throws(()=>validateDirection({...s,objects:{lamp:{anchor:[1001,2]}}}),/artboard/);
  assert.throws(()=>validateTimings({...timing,marks:[timing.marks[0],timing.marks[0]]},2,'fixture'),/duplicate/);
  assert.deepEqual(speechSegments(s,phrases(voice)),[['Read the lamp.'],['Read the','lamp.']]);
});

test('independent tracks overlap; a later pan starts at the visible pose, and the same frame can be sought twice',()=>{
  const s=testShot();
  s.actions.push({id:'back',type:'pan',target:'home',at:{mark:'return'},duration:.4,curve:'linear'});
  const rows={...timing,marks:[...timing.marks,{id:'return',start:1.2,end:1.4}]};
  s.resolvedActions=resolveActions(s,rows,settings);
  const mid=cueState(s,1.4);
  assert.ok(Math.abs(mid.camera.focus[0]-593.75)<1e-8);
  assert.ok(Math.abs(mid.camera.scale-1.75)<1e-8);
  assert.equal(mid.objects.lamp.opacity,1);
  assert.deepEqual(cueState(s,0).camera,{focus:[500,410],scale:1});
  assert.deepEqual(cueState(s,1.4),mid);
  assert.ok(Math.abs(cueState(s,1.2).objects.lamp.opacity-.5)<1e-8);
  const selected=samples(90,30,{...s,motion:0},[],false);
  for(let frame=33;frame<=51;frame++)assert.ok(selected.includes(frame));
  assert.ok(!selected.includes(17));
});

const html='<!doctype html><style>*{margin:0}#lamp{position:absolute;left:730px;top:390px;width:40px;height:40px;background:red}</style>'+
  '<div id="lamp" data-folio-object="lamp"></div><script>window.drawPlate=({objects,camera,actions})=>{'+
  'if(!objects.lamp||!Array.isArray(camera.focus)||!actions["light-lamp"])throw Error("missing HTML cue state")}</script>';
const canvas='export default function draw(ctx,{objects,actions,camera,drawObject}){'+
  'if(!objects.lamp||!camera.focus||!actions["light-lamp"])throw Error("missing native cue state");'+
  'drawObject("lamp",()=>{ctx.fillStyle="red";ctx.fillRect(730,390,40,40)})}';
const browser=[process.env.FOLIOFILM_BROWSER,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge','/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium','/usr/bin/google-chrome','/usr/bin/chromium-browser'].some(file=>file && existsSync(file));
function pixel(path,t,x,y) {
  const frame=run('ffmpeg',['-v','error','-ss',String(t),'-i',join(path,'film.mp4'),'-frames:v','1','-vf',
    'format=rgb24,crop=1:1:'+x+':'+y,'-f','rawvideo','pipe:1'],{encoding:null});
  return [...frame.subarray(0,3)];
}
const red=([r,g,b])=>r>190&&g<60&&b<60;
for(const component of ['panel','web'])test(component+' delivers the reveal and camera in the encoded movie, sidecar mode', {
  skip:component==='web'&&!browser?'No local browser installed':false
},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'foliofilm-directed-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const channel=join(dir,'channel'),cache=join(dir,'cache'),out=join(dir,'out'),recordings=join(dir,'takes');
  const brand=json(join(ROOT,'channels/starter/brand.json')),shot={...testShot(),heading:'Lamp',direction:'Read the switch.',
    component,motion:0,lead:.1,hold:.3,refs:['ref']};
  if(component==='web')shot.params={file:'lamp.html',credit:'Fixture',rights:'Original'};
  const e={id:'switch-test',format:'short',title:'A switch',question:'Where is the second lamp?',
    sources:[{id:'ref',title:'Fixture',url:'https://example.org',locator:'A',support:'A simulated lamp.'}],shots:[shot]};
  write(join(channel,'brand.json'),brand);write(join(channel,'episodes',e.id+'.json'),e);
  write(join(channel,'components/panel.mjs'),canvas);write(join(channel,'lamp.html'),html);
  const take=join(recordings,e.id,shot.id);mkdirSync(join(recordings,e.id),{recursive:true});
  const sound=Buffer.alloc(48000*2);for(let i=0;i<48000;i++)sound.writeInt16LE(Math.round(4400*Math.sin(i*Math.PI/60)),i*2);
  writeFileSync(take+'.wav',wav(sound));write(take+'.json',timing);
  const opts={e,channel,brand,cache,out,recordings,quiet:true,subs:'sidecar'};
  const first=await render(opts);assert.ok(inspectBundle(first).fullDecode);
  assert.deepEqual(json(join(first,'project/takes',e.id,shot.id+'.json')),timing);
  assert.ok(!red(pixel(first,.9,360,640)));
  assert.ok(red(pixel(first,1.6,360,640)),'pan moved the target to frame centre');
  assert.ok(red(pixel(first,1.6,381,640)),'zoom doubled the size of the coloured square');
  const event=json(join(first,'timeline.json')).shots[0].actions[1];
  assert.equal(event.filmStartFrame,33);assert.equal(event.filmEndFrame,45);
  if(component==='panel'){
    const changed=structuredClone(timing);changed.marks[0].start=.25;changed.marks[0].end=.5;
    write(take+'.json',changed);
    const second=await render(opts);assert.notEqual(first,second);
    assert.equal(readdirSync(join(cache,'shots')).filter(name=>name.endsWith('.mp4')).length,2);
    assert.ok(red(pixel(second,.85,525,640)),'same WAV, different mark produced a different visible hold');
  }
});

test('speech workers measure quoted clips using their actual sample counts and retain full caption sentences',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'foliofilm-cue-voice-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const worker=join(dir,'worker.mjs'),config=join(dir,'config.json');
  write(worker,`import {writeFileSync} from 'node:fs';
    import {createInterface} from 'node:readline';
    import {wav} from ${JSON.stringify(new URL('../src/speech.mjs',import.meta.url).href)};
    const counts={'The wheel':4251,'stops':3907,'here.':832,'See it.':9522};
    for await(const line of createInterface({input:process.stdin})){
      const {text,output}=JSON.parse(line);writeFileSync(output,wav(Buffer.alloc(2*counts[text])));
      console.log(JSON.stringify({ok:true}));
    }`);
  write(config,{version:'fixture-one',command:[process.execPath,worker]});
  const shot={id:'stop',voice:'The wheel stops here. See it.',objects:{wheel:{anchor:[300,300]}},
    actions:[{id:'move',type:'pan',target:'wheel',at:{quote:'stops'}}]};
  const session=voiceSession({cache:join(dir,'cache'),brand:{voice:{}},workerConfig:config});
  try{
    const result=await session.cue({id:'demo'},shot);
    assert.deepEqual(result.spans.map(row=>row.text),phrases(shot.voice));
    assert.equal(result.spans[1].start,(4251+3907+832+3600)/24000);
    const [event]=resolveActions(shot,result,{lead:0,frames:100,fps:30});
    assert.equal(event.source.start,4251/24000);
    assert.equal(event.source.end,(4251+3907)/24000);
    assert.equal(result.bytes.length/2,4251+3907+832+3600+9522);
  }finally{session.close();}
});

test('bundled reference take has exact measured clip lengths for every quoted action',()=>{
  const base=join(ROOT,'channels/starter'),e=json(join(base,'episodes/rolling-wheel.json')),shot=e.shots.find(s=>s.id==='fixed-axle');
  const take=join(base,'reference-takes',e.id,shot.id),audio=pcm(take+'.wav'),data=JSON.parse(readFileSync(take+'.json'));
  validateTimings(data,audio.duration,take);
  const frames=Math.ceil((.12+audio.duration+shot.hold)*30);
  const cues=resolveActions(shot,data,{lead:.12,frames,fps:30});
  assert.deepEqual(cues.map(c=>[c.id,c.startFrame,c.endFrame]),[['find-contact',188,212],['closer',188,219],['read-zero',224,238]]);
});

test('a component can seek an arbitrary numeric rig property and interrupt it on a measured word', () => {
  const s = testShot();
  s.objects.lamp.properties = {angle: -20, aperture: .35};
  s.actions = [
    {id:'turn',type:'animate',target:'lamp',property:'angle',to:100,at:{mark:'switch'},duration:.8,curve:'linear'},
    {id:'reverse',type:'animate',target:'lamp',property:'angle',to:0,
      at:{quote:'lamp',occurrence:2,offset:.4},duration:.4,curve:'linear'},
  ];
  validateDirection(s);
  s.resolvedActions = resolveActions(s,timing,settings);
  const pose = t => cueState(s,t).objects.lamp.properties;
  assert.deepEqual(pose(0), {angle:-20,aperture:.35});
  assert.ok(Math.abs(pose(1.5).angle - 40) < 1e-8);
  assert.ok(Math.abs(pose(1.7).angle - 20) < 1e-8);
  assert.deepEqual(pose(2), {angle:0,aperture:.35});
  assert.deepEqual(s.objects.lamp.properties, {angle:-20,aperture:.35});
  assert.throws(()=>validateDirection({...s, actions:[{...s.actions[0],property:'tilt'}]}), /declared object property/);
  s.actions = [{...s.actions[0], curve:[0,0,0,1]}];
  validateDirection(s);
  s.resolvedActions = resolveActions(s,timing,settings);
  // x(t)=t³. At one eighth of the duration t=1/2 and y(t)=1/2.
  assert.ok(Math.abs(pose(1.2).angle - 40) < .001);
  assert.throws(()=>validateDirection({...s, actions:[{...s.actions[0],curve:[0,0,1,2]}]}), /Bezier/);
});
