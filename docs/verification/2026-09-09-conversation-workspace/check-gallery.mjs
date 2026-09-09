// Validate the actual local-file review page, using the same Ego task space.
const fs=await import('node:fs/promises'),p=(await taskSpace(8)).page('p1');
const out='/Users/nefish/Desktop/Coding/Aarre/docs/verification/2026-09-09-conversation-workspace/';
const review=JSON.parse(await fs.readFile(out+'visual-review.json','utf8'));
const records=[];
await p.goto('file://'+out+'index.html',{waitUntil:'domcontentloaded',timeout:30000});
console.log((await p.snapshot()).slice(0,4500));
await p.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0),undefined,{timeout:30000});
for(const width of [1150,420]){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:1109,deviceScaleFactor:1,mobile:false});
 await p.evaluate(()=>document.fonts.ready);
 const record=await p.evaluate(()=>({width:innerWidth,pageWidth:document.documentElement.scrollWidth,images:document.images.length,loaded:[...document.images].filter(i=>i.complete&&i.naturalWidth>0).length,openDetails:document.querySelectorAll('details[open]').length,oldImages:[...document.images].filter(i=>i.src.includes('ui-refinement')).length,title:document.title}));
 if(record.images!==review.count||record.loaded!==review.count||record.pageWidth>width||record.openDetails||record.oldImages)throw Error('Current gallery failed: '+JSON.stringify(record));
 records.push(record);await p.screenshot({path:out+'logs/gallery-'+width+'.png'});
}
await p.goto('file:///Users/nefish/Desktop/Coding/Aarre/docs/verification/2026-09-09-ui-refinement/index.html',{waitUntil:'domcontentloaded',timeout:30000});
const historical=await p.evaluate(()=>({title:document.title,openDetails:document.querySelectorAll('details[open]').length,hasNewLink:[...document.querySelectorAll('a')].some(a=>a.href.includes('conversation-workspace/index.html')),notice:document.body.innerText.slice(0,500)}));
if(historical.openDetails||!historical.hasNewLink)throw Error('Historical redirect notice failed');
await fs.writeFile(out+'gallery-check.json',JSON.stringify({current:records,historical},null,2)+'\n');console.log({current:records,historical});
await p.cdp('Emulation.setDeviceMetricsOverride',{width:1150,height:1109,deviceScaleFactor:1,mobile:false});
await p.goto('file://'+out+'index.html',{waitUntil:'domcontentloaded',timeout:30000});
console.log((await p.snapshot()).slice(0,4500));
