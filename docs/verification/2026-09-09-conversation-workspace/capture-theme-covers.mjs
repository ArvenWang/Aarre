// Verify through the actual theme button, and wait for visible images to decode.
const fs=await import('node:fs/promises'),p=(await taskSpace(8)).page('p1');
const out='/Users/nefish/Desktop/Coding/Aarre/docs/verification/2026-09-09-conversation-workspace/';
await p.goto('http://127.0.0.1:5173/manager.html',{waitUntil:'domcontentloaded',timeout:30000});await p.waitForSelector('.library-masonry',{state:'visible',timeout:30000});
const results=[];
for(const [width,height] of [[1280,900],[420,820],[320,640]]){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 if(await p.evaluate(()=>document.documentElement.dataset.theme==='dark'))await p.click('.manager-theme-button');
 await p.click('.manager-theme-button');
 await p.waitForFunction(()=>[...document.querySelectorAll('.library-card-cover img')].filter(e=>e.closest('.library-card').getBoundingClientRect().top<innerHeight).every(e=>e.complete&&e.naturalWidth>0),undefined,{timeout:30000});
 await p.evaluate(async()=>{await Promise.all([...document.querySelectorAll('.library-card-cover img')].filter(e=>e.closest('.library-card').getBoundingClientRect().top<innerHeight).map(e=>e.decode().catch(()=>{})));});
 await p.screenshot({path:out+`final/manager-${width}-dark.png`});
 results.push(await p.evaluate(()=>({theme:document.documentElement.dataset.theme,width:innerWidth,pageWidth:document.documentElement.scrollWidth,images:[...document.querySelectorAll('.library-card-cover img')].filter(e=>e.closest('.library-card').getBoundingClientRect().top<innerHeight).map(e=>({src:e.currentSrc,complete:e.complete,naturalWidth:e.naturalWidth,displayHeight:e.getBoundingClientRect().height}))})));
}
await fs.writeFile(out+'theme-image-check.json',JSON.stringify({method:'Actual theme button; visible images decoded. Early programmatic capture kept only in logs, not accepted.',results},null,2));console.log(results);console.log(await p.snapshot());
