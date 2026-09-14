// Prepend state and geometry data from the saved ledger.
const page=await figma.getNodeByIdAsync(state.pageId);await figma.setCurrentPageAsync(page);
await Promise.all([figma.loadFontAsync({family:'Inter',style:'Regular'}),figma.loadFontAsync({family:'Inter',style:'Semi Bold'}),figma.loadFontAsync({family:'Noto Sans SC',style:'Regular'}),figma.loadFontAsync({family:'Noto Sans SC',style:'Medium'})]);
const root=await figma.getNodeByIdAsync(state.reviewId);
const hugFrames=[...root.findAll(n=>n.type==='FRAME'&&n.height===1),root];
for(const n of hugFrames)n.layoutSizingVertical='HUG';
const diagram=await figma.getNodeByIdAsync(state.diagramId);
if(diagram.children.length)throw new Error('Construction already exists; inspect before changing.');
const variables={};for(const [k,id] of Object.entries(state.variables))variables[k]=await figma.variables.getVariableByIdAsync(id);
const rgb=hex=>({r:parseInt(hex.slice(1,3),16)/255,g:parseInt(hex.slice(3,5),16)/255,b:parseInt(hex.slice(5,7),16)/255});
const paint=(key,opacity=1)=>[{...figma.variables.setBoundVariableForPaint({type:'SOLID',color:rgb(data.palette[key])},'color',variables[key]),opacity}];
const created=[];const record=n=>{created.push(n.id);return n;};
function groupFrame(name){const n=record(figma.createFrame());n.name=name;n.resize(384,384);n.fills=[];n.clipsContent=false;diagram.appendChild(n);n.x=0;n.y=0;return n;}
function line(parent,name,x1,y1,x2,y2,key,opacity=1,weight=1){
  const n=record(figma.createVector());n.name=name;const x=Math.min(x1,x2),y=Math.min(y1,y2);
  n.vectorPaths=[{windingRule:'NONE',data:`M ${x1-x} ${y1-y} L ${x2-x} ${y2-y}`}];n.fills=[];n.strokes=paint(key,opacity);n.strokeWeight=weight;parent.appendChild(n);n.x=x;n.y=y;return n;
}
const grid=groupFrame('01 / 16u grid');
grid.opacity=0.16;
for(let k=0;k<=128;k+=16){line(grid,`x=${k}u`,k*3,0,k*3,384,'aubergine',k===64?0.22:0.07);line(grid,`y=${k}u`,0,k*3,384,k*3,'aubergine',k===64?0.22:0.07);}
const circles=groupFrame('02 / Nine construction circles');
circles.opacity=0.55;
const circleIds=[];
for(const [i,shape] of data.regular.entries())for(const [j,c] of shape.circles.entries()){
  const circle=record(figma.createEllipse());circle.name=`Stone ${i+1} / C${j+1} · (${c.x}, ${c.y}) R${c.r}`;circle.resize(c.r*6,c.r*6);circle.fills=[];circle.strokes=paint('poppy',0.55);circle.strokeWeight=1.2;circles.appendChild(circle);circle.x=(c.x-c.r)*3;circle.y=(c.y-c.r)*3;circleIds.push(circle.id);
}
const contour=groupFrame('03 / Final three vector contours');
for(const shape of data.regular){const v=record(figma.createVector());v.name=shape.name;v.vectorPaths=[{windingRule:'NONZERO',data:shape.localPath}];v.rescale(3);v.fills=[];v.strokes=paint('aubergine');v.strokeWeight=1.6;contour.appendChild(v);v.x=shape.bounds.x*3;v.y=shape.bounds.y*3;}
const tangents=groupFrame('04 / Nine common external tangents');
for(const [i,shape] of data.regular.entries())for(const [j,t] of shape.tangents.entries())line(tangents,`Stone ${i+1} / tangent ${j+1}`,t.from.x*3,t.from.y*3,t.to.x*3,t.to.y*3,'poppy',1,2);
const centers=groupFrame('05 / Circle centers and radii');
centers.opacity=0.7;
for(const [i,shape] of data.regular.entries())for(const [j,c] of shape.circles.entries()){
  line(centers,`Center ${i+1}.${j+1} / x`,c.x*3-3,c.y*3,c.x*3+3,c.y*3,'aubergine',0.65,1);
  line(centers,`Center ${i+1}.${j+1} / y`,c.x*3,c.y*3-3,c.x*3,c.y*3+3,'aubergine',0.65,1);
  const t=record(figma.createText());t.name=`Radius ${i+1}.${j+1}`;t.fontName={family:'Noto Sans SC',style:'Regular'};t.fontSize=10;t.lineHeight={unit:'PIXELS',value:14};t.characters=`R${c.r}`;t.fills=paint('aubergine',0.7);centers.appendChild(t);t.x=c.x*3+5;t.y=c.y*3-17;
}
figma.currentPage.selection=[root];figma.viewport.scrollAndZoomIntoView([root]);
return {createdNodeIds:created,mutatedNodeIds:hugFrames.map(n=>n.id).concat([diagram.id]),circleIds,constructionLayers:diagram.children.map(n=>({id:n.id,name:n.name})),reviewBounds:{x:root.x,y:root.y,width:root.width,height:root.height}};
