// Original diagrams. All distances are on a 1280 × 720 illustration surface.
const ink='#1c2b2c', dark='#203835', ivory='#f5ebd8', page='#f0e7d4', mint='#a1ceba';
const red='#a54324', pale='#ddd4c1', quiet='#596960', brass='#bc954d', black='#182824';
const sans='"DM Sans"', serif='"DM Serif Text"';
const clamp=(x,l=0,h=1)=>Math.max(l,Math.min(h,x));
function text(c,s,x,y,px,color=ink,style='500',align='left',face=sans){
  c.font=style+' '+px+'px '+face;c.fillStyle=color;c.textAlign=align;c.textBaseline='alphabetic';c.fillText(String(s),x,y);
}
function box(c,x,y,w,h,color){c.fillStyle=color;c.fillRect(x,y,w,h);}
function line(c,x,y,xx,yy,color,width=1){c.beginPath();c.moveTo(x,y);c.lineTo(xx,yy);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
function ring(c,x,y,r,color,width=1){c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
function disc(c,x,y,r,color){c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=color;c.fill();}
function paper(c,x,y,w,h){
  c.save();c.shadowColor='rgba(28,37,29,.19)';c.shadowBlur=12;c.shadowOffsetY=5;box(c,x,y,w,h,ivory);c.restore();
  line(c,x+1,y+h-2,x+w-2,y+h-2,'#d7c7a6',2);
}
function ground(c){
  const g=c.createLinearGradient(0,0,1280,720);g.addColorStop(0,'#e6ddc9');g.addColorStop(1,'#c9bfa8');box(c,0,0,1280,720,g);
}
function screw(c,x,y){disc(c,x,y,4,'#899287');line(c,x-2,y+2,x+2,y-2,dark,1);}
function card(c,x,y,w,h,n,active=false){
  box(c,x+1,y+3,w,h,'#b8aa8b');box(c,x,y,w,h,active?dark:'#e8ddc5');
  line(c,x+4,y+3,x+w-4,y+3,active?'#4d6960':'#fbf3db',1);
  text(c,String(n).padStart(2,'0'),x+w/2,y+h*.69,Math.min(h*.55,w*.55),active?ivory:ink,'500','center');
}
// Return the visible card and elapsed time from independent complete card intervals.
export function clockAt(outputFrame,originFrame,clock,filmFps){
  const delta=Math.max(0,outputFrame-originFrame),seconds=delta/filmFps;
  return {card:Math.min(clock.cards,Math.floor(delta*clock.fps/filmFps)+1),
    elapsed:Math.min(seconds,clock.cards/clock.fps),done:delta*clock.fps>=clock.cards*filmFps};
}
function count(c,state){
  const {time,span}=state;
  ground(c);
  c.save();c.translate(23,-16);c.rotate(-.018);
  paper(c,52,62,824,610);
  const from=span[1].start+.15,through=Math.min(span[1].end-.25,from+3.25);
  const count=Math.floor(9*clamp((time-from)/(through-from)));
  for(let i=0;i<45;i++)card(c,88+(i%9)*84,101+Math.floor(i/9)*97,72,78,i+1,i>=36&&i<36+count);
  text(c,'Fred Ott  /  numbered diagram',90,632,26,quiet);
  c.restore();
  c.save();c.translate(922,246);c.rotate(.028);
  paper(c,-8,-8,271,220);box(c,0,0,255,204,dark);
  for(const x of [13,242])for(const y of [13,190])screw(c,x,y);
  box(c,28,32,199,112,black);
  text(c,String(36+count),127,127,100,ivory,'500','center');
  text(c,'FRAMES',127,178,23,mint,'600','center');
  c.restore();
}
function sample(c,state){
  const {time,span}=state;
  ground(c);
  const progress=clamp((time-span[0].start-.45)/(span.at(-1).end-span[0].start-1.25));
  const n=1+Math.min(44,Math.floor(progress*45));
  paper(c,41,135,647,449);
  const gx=71,gy=170,dx=66,dy=68,w=54,h=54;
  for(let i=0;i<45;i++)card(c,gx+i%9*dx,gy+Math.floor(i/9)*dy,w,h,i+1);
  const sx=gx+(n-1)%9*dx,sy=gy+Math.floor((n-1)/9)*dy;
  c.save();c.strokeStyle=red;c.lineWidth=5;c.strokeRect(sx-5,sy-5,w+10,h+10);c.restore();
  disc(c,sx+w+4,sy-5,5,red);
  text(c,'Rephotography  /  schematic',71,551,25,quiet);
  // The light path physically ties the window to the viewfinder.
  c.save();c.globalAlpha=.16;c.fillStyle=brass;c.beginPath();c.moveTo(690,338);c.lineTo(768,299);c.lineTo(768,420);c.closePath();c.fill();c.restore();
  box(c,738,299,48,121,black);box(c,748,289,30,141,'#50645a');
  box(c,774,133,459,449,black);box(c,784,143,439,425,dark);
  for(const x of [803,1204])for(const y of [165,548])screw(c,x,y);
  box(c,830,213,352,280,black);
  card(c,859,240,293,218,n,true);
  for(const [x,y,a,b] of [[848,228,1,1],[1162,228,-1,1],[848,471,1,-1],[1162,471,-1,-1]]){
    line(c,x,y,x+a*23,y,mint,3);line(c,x,y,x,y+b*17,mint,3);
  }
}
function clock(c,x,y,clock,val,tint){
  const n=String(val.card).padStart(2,'0');
  c.save();c.shadowColor='rgba(20,28,24,.32)';c.shadowBlur=16;c.shadowOffsetY=8;box(c,x-5,y-5,542,365,black);c.restore();
  box(c,x,y,532,352,dark);
  for(const dx of [12,520])for(const dy of [13,340])screw(c,x+dx,y+dy);
  text(c,clock.fps+' cards / second',x+30,y+52,33,ivory,'600');
  line(c,x+30,y+73,x+500,y+73,'#678178');
  box(c,x+32,y+101,177,141,black);text(c,n,x+121,y+211,91,ivory,'500','center');
  text(c,'CARD',x+120,y+266,18,mint,'600','center');
  const bx=x+355,by=y+173,rad=78;
  ring(c,bx,by,rad,'#6b8276',2);
  for(let i=0;i<45;i++){
    const angle=-Math.PI/2+(i/45)*Math.PI*2;
    const a=i%5===0?rad-12:rad-5;
    line(c,bx+a*Math.cos(angle),by+a*Math.sin(angle),bx+rad*Math.cos(angle),by+rad*Math.sin(angle),i<val.card?tint:'#52695e',i%5===0?3:2);
  }
  const angle=-Math.PI/2+Math.PI*2*val.elapsed/3;
  line(c,bx,by,bx+(rad-21)*Math.cos(angle),by+(rad-21)*Math.sin(angle),tint,4);
  disc(c,bx,by,6,tint);
  text(c,val.elapsed.toFixed(2)+' s',bx,y+283,37,ivory,'600','center');
  for(let i=0;i<45;i++)box(c,x+31+i*10.5,y+312,7,10,i<val.card?tint:'#416057');
}
function clocks(c,state){
  const {frame,fps,span,shot}=state;
  ground(c);
  const starts=span.slice(1,3).map(s=>Math.ceil(s.start*fps));
  const origin=frame>=starts[1]?starts[1]:starts[0];
  const [slow,fast]=shot.clocks;
  clock(c,63,169,slow,clockAt(frame,origin,slow,fps),mint);
  clock(c,684,169,fast,clockAt(frame,origin,fast,fps),'#f1ba76');
  paper(c,452,564,377,57);text(c,'Hypothetical display rates',640,603,25,ink,'500','center');
}
function limit(c,state){
  const {time,span,clocks}=state;
  ground(c);
  const enter=clamp((time-span[0].start+.15)/.75),ease=enter*enter*(3-2*enter);
  const k=1-.54*ease,dy=169-130*ease;
  for(const [i,clockData] of clocks.entries()){
    const x=i?684:63;
    c.save();c.translate(x+(1-k)*234,dy);c.scale(k,k);
    clock(c,0,0,clockData,{card:clockData.cards,elapsed:clockData.durationSeconds,done:true},i?'#f1ba76':mint);c.restore();
  }
  c.save();c.translate(0,430*(1-ease));c.rotate(-.009);
  paper(c,127,254,1024,414);
  text(c,'Library of Congress',178,321,39,ink,'400','left',serif);
  text(c,'2025169913',177,383,28,ink,'600');text(c,'Photographic record · 45 frames',421,383,27,quiet);
  text(c,'00694192',177,430,28,ink,'600');text(c,'Viewing copy · still rephotographed',421,430,27,quiet);
  line(c,177,460,1090,460,'#c6b99c');
  text(c,'Playback interval in these catalog passages',177,509,28,ink);
  const amt=clamp((time-span.at(-1).start)/.5);
  if(amt>0){
    c.save();c.globalAlpha=amt;text(c,'Unspecified.',173,609,83,red,'400','left',serif);c.restore();
  }else{line(c,179,594,480,594,'#bdaf94',2);}
  c.restore();
}
export function plate(c,state){
  ({count,recover:sample,clocks,limit})[state.shot.beat](c,state);
}
export function cover(c){
  ground(c);
  c.save();c.translate(-66,14);c.rotate(-.062);paper(c,50,90,667,563);
  for(let i=0;i<45;i++)card(c,96+(i%9)*65,131+Math.floor(i/9)*89,52,67,i+1,i===44);
  text(c,'Fred Ott  /  45 drawn frames',93,608,29,quiet);c.restore();
  for(const [i,rate] of [15,30].entries()){
    const set={cards:45,fps:rate,durationSeconds:45/rate};
    c.save();c.translate(709,53+i*339);c.scale(.91,.84);
    clock(c,0,0,set,{card:45,elapsed:45/rate,done:true},i?'#f1ba76':mint);c.restore();
  }
}
