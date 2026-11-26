import {chromium} from 'playwright-core';
import {loadImage} from '@napi-rs/canvas';
import {pathToFileURL} from 'node:url';
import {inside,exists} from './common.mjs';

const paths=[
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium','/usr/bin/google-chrome','/usr/bin/chromium-browser'
];
// The browser is dedicated to the local production and starts with a temporary profile.
export async function webPlate(channel,shot,theme,width){
  const executablePath=process.env.FOLIOFILM_BROWSER || paths.find(exists);
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1000,height:820},deviceScaleFactor:Math.max(1,width/1000)});
    await page.route(/^https?:/,route=>route.abort());
    await page.goto(pathToFileURL(inside(channel,shot.params.file)).href);
    const paint=async (p,t,directed)=>{
      await page.evaluate(async ({p,t,params,theme,directed})=>{
        if(typeof window.drawPlate!=='function')throw Error('A web plate must expose drawPlate({p,time,params,theme})');
        await window.drawPlate({p,time:t,params,theme,...directed});
        for(const node of document.querySelectorAll('[data-folio-object]')) {
          const id=node.getAttribute('data-folio-object');
          if(!Object.hasOwn(directed.objects,id))throw Error('Undeclared HTML drawing object: '+id);
          const object = directed.objects[id];
          node.style.opacity=String(object.opacity);
          for (const [name, value] of Object.entries(object.properties ?? {})) {
            node.style.setProperty('--folio-' + name, String(value));
          }
        }
        await document.fonts.ready;
      },{p,t,params:shot.params,theme,directed});
      const pixels=await page.screenshot({type:'png',omitBackground:true});
      return loadImage(pixels);
    };
    return {paint,close:()=>browser.close()};
  }catch(e){await browser.close();throw e;}
}
