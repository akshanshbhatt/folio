// Caption changes are measured at sentence boundaries. Long sentences are split at
// nearby quiet regions in the delivered narration. A recorded take can supply exact cues.
export function captions(spans,pcm,rate=24000) {
  const result=[];
  for(const span of spans){
    const words=span.text.trim().split(/\s+/);
    const groups=[];
    const count=Math.max(1,Math.min(Math.ceil(span.text.length/73),Math.floor((span.end-span.start)/1.1),Math.floor(words.length/3)));
    let cursor=0;
    for(let left=count;left>1;left--){
      const target=words.slice(cursor).join(' ').length/left;
      let best=Infinity,cut=cursor+1;
      for(let i=cursor+2;i<=words.length-(left-1)*2;i++){
        const length=words.slice(cursor,i).join(' ').length;
        const cost=Math.abs(length-target)-(/[,:;.!?]$/.test(words[i-1])?8:0);
        if(cost<best){cut=i;best=cost;}
        if(length>target+22)break;
      }
      groups.push(words.slice(cursor,cut).join(' '));cursor=cut;
    }
    groups.push(words.slice(cursor).join(' '));
    let start=span.start, used=0;
    const total=groups.reduce((n,g)=>n+g.length,0);
    for(const [i,group] of groups.entries()){
      used+=group.length;
      let end=span.end;
      if(i<groups.length-1){
        const guess=span.start+(span.end-span.start)*used/total;
        const window=Math.min(.32,(guess-start)/3,(span.end-guess)/3);
        let best=Infinity;
        const minDwell=Math.min(1.05,(span.end-span.start)/groups.length*.75);
        const low=Math.max(guess-window,start+minDwell);
        const high=Math.min(guess+window,span.end-(groups.length-i-1)*minDwell);
        end=Math.max(start+minDwell,Math.min(guess,span.end-(groups.length-i-1)*minDwell));
        for(let t=low;t<=high;t+=.01){
          const a=Math.max(0,Math.round((t-.015)*rate)),b=Math.min(pcm.length/2,Math.round((t+.015)*rate));
          let energy=0;for(let k=a;k<b;k+=6) energy+=Math.abs(pcm.readInt16LE(2*k));
          const score=energy/Math.max(1,(b-a)/6)+Math.abs(guess-t)*260;
          if(score<best){best=score;end=t;}
        }
      }
      result.push({start,end,text:group});start=end;
    }
  }
  return result;
}
function stamp(s,sep) {
  const ms=Math.round(s*1000);
  return [Math.floor(ms/3600000),Math.floor(ms/60000)%60,Math.floor(ms/1000)%60].map(n=>String(n).padStart(2,'0')).join(':')+sep+String(ms%1000).padStart(3,'0');
}
export const subtitleText=(cues,vtt=false)=>(vtt?'WEBVTT\n\n':'')+cues.map((c,i)=>(vtt?'':i+1+'\n')+stamp(c.start,vtt?'.':',')+' --> '+stamp(c.end,vtt?'.':',')+'\n'+c.text+'\n').join('\n');
