// Original cut-paper character rig. Coordinates use the same 960 x 540 set for every shot.
import { createCanvas, Path2D } from '@napi-rs/canvas';

const W = 960, H = 540;
const cachedPaths = new Map();
function shape(c, d, fill, stroke, width = 2) {
  let path = cachedPaths.get(d);
  if (!path) {
    path = new Path2D(d);
    // Most paths are fixed silhouettes. A few have animated control points.
    if (cachedPaths.size < 2500) cachedPaths.set(d, path);
  }
  if (fill) { c.fillStyle = fill; c.fill(path); }
  if (stroke) { c.lineWidth = width; c.strokeStyle = stroke; c.stroke(path); }
}
function oval(c,x,y,rx,ry,fill,rot=0) {
  c.fillStyle=fill; c.beginPath(); c.ellipse(x,y,rx,ry,rot,0,Math.PI*2); c.fill();
}
function rect(c,x,y,w,h,color) { c.fillStyle=color; c.fillRect(x,y,w,h); }
function smooth(t) { t=Math.min(1,Math.max(0,t)); return t*t*(3-2*t); }
function rand(seed) { return () => {seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}; }

function window(c,p) {
  rect(c,40,29,232,230,p.shadow);
  rect(c,54,38,205,208,p.window);
  oval(c,137,84,29,29,p.sun);
  shape(c,'M54 196Q101 142 152 160T259 127V246H54Z','#d7b58c');
  shape(c,'M54 218Q107 183 153 190T259 170V247H54Z','#9fa58a');
  c.save(); c.beginPath();c.rect(54,38,205,208);c.clip();
  shape(c,'M95 253Q112 169 72 63M109 191Q135 154 132 104M90 111L62 97',null,'#747e69',4);
  const leaves=rand(43);
  for(let i=0;i<59;i++) {
    const x=52+leaves()*98,y=67+leaves()*92;
    oval(c,x,y,5+leaves()*8,3+leaves()*3,i%3===0?'#edcd9c':'#a5a582',leaves()*3);
  }
  c.restore();
  rect(c,148,37,7,211,p.sill);rect(c,53,142,205,7,p.sill);
  rect(c,34,244,247,12,p.sill);rect(c,43,254,225,7,'#385754');
}

function makeSet(p) {
  const canvas=createCanvas(W,H), c=canvas.getContext('2d');
  rect(c,0,0,W,H,p.wall);
  const light=c.createLinearGradient(0,0,W,250);
  light.addColorStop(0,'rgba(250,218,155,.34)');light.addColorStop(.69,'rgba(250,218,155,0)');light.addColorStop(1,'rgba(23,47,52,.40)');
  c.fillStyle=light;c.fillRect(0,0,W,H);
  for(let n=0;n<21;n++){const x=n*51+12;rect(c,x,0,1,324,'rgba(30,66,64,.16)');rect(c,x+2,0,1,324,'rgba(236,218,168,.12)');}
  window(c,p);
  rect(c,580,111,290,7,'#24494a'); rect(c,572,101,307,10,p.sill);
  for(const x of [615,810]) shape(c,`M${x} 112l29 0-29 28Z`,'#345656');
  // Bottles, an enamel tin and a hanging copper pan give the set a recognizable layout.
  shape(c,'M617 98l1-33 6-3v-13h14v13l6 3 2 33Z','#9eb0a2','#3c5653',2);
  rect(c,624,46,14,5,'#936d4f');rect(c,621,77,20,13,'#d6c496');
  shape(c,'M656 101l-1-36q12-9 29 0l-1 36Z','#bd8665','#4e6057',2);
  oval(c,670,64,16,4,'#dec09b');rect(c,654,82,32,5,'#9c664f');
  for(let n=0;n<4;n++) {const y=97-4*n;oval(c,760,y,36,5,'#c4c6ae');shape(c,`M725 ${y}q35 8 70 0`,null,'#597775',1.4);}
  shape(c,'M837 143v30m0-12q5 5 1 12',null,'#424f4e',3);
  shape(c,'M837 170l1 42',null,'#ad8b68',8);oval(c,838,238,28,34,'#894e3e',.10);oval(c,834,232,23,27,'#b7744f',.10);
  shape(c,'M825 213q-12 7-11 21',null,'#d49563',3);
  // Mottling is painted once. Shifting noise would flicker during the held performance.
  const speck=rand(315);
  for(let i=0;i<10500;i++) {
    const x=speck()*W,y=speck()*H;rect(c,x,y,1+speck()*2,1,i%2?'rgba(248,227,173,.10)':'rgba(40,47,44,.08)');
  }
  return canvas;
}

function counter(c,p) {
  shape(c,'M-20 356L980 348 982 420-20 432Z',p.table,'#714d42',3);
  shape(c,'M-20 431L982 416 980 558H-20Z',p.apron);
  shape(c,'M-10 431L969 417',null,'#e5a06a',4);
  for(let n=0;n<12;n++) {
    const x=n*103-69,y=364+(n%3)*18;
    shape(c,`M${x} ${y}q48 -2 85 -1t50 -3`,null,'#a4694c',1.2);
  }
  shape(c,'M40 448L468 442 469 501 41 506ZM492 442L914 436 915 495 493 501Z',null,'#514741',2);
  for(const x of [249,708]){oval(c,x,465,19,5,'#513f37');oval(c,x,463,17,4,'#bd9360');}
}

function mouse(c,x,y,scale,face,colors,kind,pose) {
  c.save();c.translate(x,y);c.scale(face*scale,scale);c.translate(0,pose.breathe);
  const {fur,cheek,shirt,bib,ear,eye}=colors;
  // Shirt and hand-sewn bib, behind the overlapping neck.
  shape(c,'M-42 19Q-70 35-71 95L-82 133 68 133 51 60Q48 27 24 17Z',shirt,'#544e43',2);
  shape(c,'M-46 34l12-9 17 45 34-3 8-45 10 6-6 51 20 56-97 3 19-58Z',bib);
  shape(c,'M-29 92q19 4 37 0l-1 22q-20 8-35 0Z',null,'rgba(255,231,184,.55)',1.8);
  shape(c,'M-62 80q12 14 20 10M41 53l7 23',null,'rgba(58,50,40,.36)',2);
  c.save();c.translate(0,-1);c.rotate(pose.tilt);
  oval(c,12,-51,24,28,fur,-.2);oval(c,13,-51,15,19,ear,-.2);
  oval(c,-38,-45,30,34,fur,-.4);oval(c,-39,-45,19,24,ear,-.4);
  shape(c,'M-50-20Q-43-57-12-55Q22-60 37-35Q46-20 61-13Q74-8 66 0Q46 12 29 21Q16 38-11 34Q-43 32-55 13L-48 9-59 7-50 1-60-1Z',fur);
  shape(c,'M5 9Q17-10 38-12Q56-11 66-7Q63 6 31 20Q18 29 0 27Q-2 17 5 9Z',cheek);
  if(kind==='kit') {
    shape(c,'M-18-50Q-25-66-31-62Q-22-60-22-49Q-36-54-37-49L-25-43Z','#885c4e');
    for(const [a,b] of [[14,8],[21,4],[22,12]])oval(c,a,b,1.7,1.3,ear);
  } else {
    shape(c,'M-44-9Q-63-12-66-5L-52 2Q-62 3-62 10L-41 11Z','#a47759');
    oval(c,-42,-17,4,5,'#e6bd66');
  }
  const brow=pose.brow==='raised'?9:0;
  shape(c,`M10 ${-28-brow}Q17 ${-34-brow} 28 ${-29-brow*.3}`,null,eye,3.5);
  const blink=pose.blink;
  oval(c,22,-15,3.5,blink?1.1:5,eye);
  if(!blink)oval(c,23,-17,1.1,1.3,'#ffedce');
  oval(c,65,-8,6.4,4.6,eye,-.25);
  if(pose.mouth>0.07)oval(c,47,5.2,5.5,1.1+pose.mouth*3.7,'#5f3f37',-.2);
  else shape(c,'M36 8q8 3 15-2',null,'#705449',1.5);
  shape(c,'M52-1l25-5m-24 10 24 1m-25 2 18 7',null,'#524d46',1.05);
  c.restore();c.restore();
}

function paw(c,x,y,scale,color,face=1) {
  c.save();c.translate(x,y);c.scale(face*scale,scale);
  shape(c,'M-17 8q-17-14-11-23t16 4q-4-21 4-21 6 0 11 15-3-13 3-14 7 1 10 18 10 4 6 13Q14 19-2 17Z',color,'#7c5b49',1.4);
  c.restore();
}

function ware(c,x,y,s,mug,turn,showShard=false) {
  c.save();c.translate(x,y);c.scale(s,s);
  oval(c,0,1,67,9,'rgba(47,45,36,.23)');oval(c,-3,-4,60,8,'#708a79');
  oval(c,-3,-6,58,7,'#c2c2a1');oval(c,-3,-6,47,4,'#a0a88c');
  const h=mug.handleWidth;
  shape(c,'M38-64C82-82 81-29 43-26',null,'#936c48',h+4);
  shape(c,'M38-65C82-83 81-30 43-27',null,mug.glaze,h);
  shape(c,'M-48-76Q-1-87 47-75L42-20Q38-7 4-6Q-31-6-40-18Z',mug.glaze,'#865f45',1.7);
  shape(c,'M-47-75Q-35-69-30-60L-24-22Q-20-12 5-8Q-33-8-40-19Z',mug.shade);
  // The chip is a bite out of the actual silhouette, drawn down to the dark cavity behind the lip.
  oval(c,-.5,-75,47,8,mug.rim);
  oval(c,-.5,-74,41,4.3,mug.inside);
  const chipX=9+turn*mug.rimAngle;
  if(mug.chipped) {
    shape(c,`M${chipX-9}-81l9 14 10-14Z`,mug.inside);
    shape(c,`M${chipX-8}-80l8 12 8-10`,null,'#f9dca2',1.6);
  } else {
    shape(c,`M${chipX-8}-79l9 12 8-10m-7 10 4 10-4 8`,null,mug.join,2.1);
  }
  c.save();c.translate(turn*8,0);
  for(const [ox,oy] of [[-15,-39],[3,-33],[19,-43]]) {
    shape(c,`M${ox-6} ${oy-9}q10 0 10 10-11 0-10-10Z`,mug.motif);
    shape(c,`M${ox+3} ${oy}l5 6`,null,mug.motif,1.5);
  }
  c.restore();
  if(showShard)shape(c,'M-83-7l13-4-7 12Z',mug.rim,'#926b4b',1);
  c.restore();
}

function door(c) {
  shape(c,'M0 0H139L112 16 101 540H0Z','#22494b');
  shape(c,'M108 8l16-8-12 540H98Z','#886b53');
  shape(c,'M0 0H960V29L108 18Z','#244546');
  shape(c,'M888 0h72v540h-84Z','#214549');shape(c,'M883 0h8l-11 540h-9Z','#a78360');
  oval(c,80,337,6,13,'#ab8c58');oval(c,79,335,3,9,'#d1b16f');
}
function steam(c,x,y,t) {
  for(let n=0;n<3;n++) {
    const p=(t*.22+n*.333)%1, dx=Math.sin(p*6+n)*6;
    shape(c,`M${x+n*9+dx} ${y-45*p}q-7-10 2-22`,null,'rgba(255,239,193,'+(.18*Math.sin(p*Math.PI))+')',2);
  }
}

/** Paint one frame. The animator explicitly chooses cameras the set supports. */
export function makeFrame(set,cast,mug) {
  const backdrop=makeSet(set),canvas=createCanvas(W,H),c=canvas.getContext('2d');
  c.lineCap='round';c.lineJoin='round';
  return ({camera,cadence,eyebrow,acting,frame,frames,fps,mouth=0})=>{
    if(!['wide','doorway','insert'].includes(camera)) throw Error('Kitchen set has no camera: '+camera);
    const t=frame/fps, held=Math.floor(frame/cadence)*cadence/fps,p=frame/Math.max(1,frames-1);
    c.save();
    if(camera==='doorway'){c.translate(-29,-16);c.scale(1.07,1.07);}
    if(camera==='insert'){
      const zoom=2.25+.10*smooth(p);
      c.translate(480,310);c.scale(zoom,zoom);c.translate(-495,-349);
    }
    c.drawImage(backdrop,0,0);
    const kit={breathe:Math.sin(held*2)*1.3,tilt:acting==='inspect'?.10+.07*Math.sin(held*1.4):.038,
      brow:eyebrow,blink:Math.abs(held-1.75)<.08||Math.abs(held-5.4)<.09,mouth:0};
    const rue={breathe:Math.sin(held*1.7+.7)*1.2,tilt:acting==='speak'?-.14*smooth(p*4):-.025,
      brow:'rest',blink:Math.abs(held-2.55)<.08,mouth:acting==='speak'?mouth:0};
    mouse(c,327,243,1.38,1,cast.kit,'kit',kit);
    if(['speak','offer'].includes(acting))mouse(c,722,239,1.45,-1,cast.rue,'rue',rue);
    counter(c,set);
    const mugX=acting==='offer'?584-110*smooth(p*1.6):490;
    ware(c,mugX,383,1.03,mug,acting==='hold'?0:smooth(p*1.5)-.5,acting==='inspect' && p<.47);
    if(acting==='offer')steam(c,mugX-4,303,t);
    if(acting==='inspect'||acting==='mend') {
      const reach=acting==='mend'?1-smooth((p-.37)*2.5):smooth(p*1.6);
      const lift=acting==='inspect'?smooth((p-.45)*2.5):0;
      const x=359+reach*(acting==='mend'?125:44), y=356-reach*(acting==='mend'?52:-18)-lift*29;
      shape(c,`M341 330Q350 338 ${x-8} ${y+6}`,null,cast.kit.shirt,18);
      paw(c,x,y,.56,cast.kit.cheek);
      if((acting==='mend'&&p<.38)||(acting==='inspect'&&p>=.47)) shape(c,`M${x+6} ${y-10}l11-3-5 11Z`,mug.rim,'#946f4a',1);
    } else {
      if(acting==='speak'){
        const tuck=smooth((p-.35)*2.5),clothX=380-34*tuck,clothY=352-10*tuck;
        shape(c,`M${clothX-12} ${clothY-13}l24 1 17 19-30-4-15 2Z`,'#99aba2','#607e76',1.3);
        paw(c,clothX-8,clothY-6,.57,cast.kit.cheek);
      }else paw(c,366,353,.57,cast.kit.cheek);
      if(acting==='offer'||acting==='speak') {
        const rx=acting==='offer'?mugX+68:682;
        shape(c,`M700 320Q685 339 ${rx} 351`,null,cast.rue.shirt,20);
        paw(c,rx,349,.58,cast.rue.cheek,-1);
      }
    }
    c.restore();
    if(camera==='doorway')door(c);
    return canvas;
  };
}
