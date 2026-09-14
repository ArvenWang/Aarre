// Figma Plugin API script. Prepend `const data = <geometry.json>;`.
// No raster assets, image generation, SVG import, or automatic tracing.
const page = await figma.getNodeByIdAsync('5203:2821');
await figma.setCurrentPageAsync(page);
if (page.children.some(n=>n.name==='Aarre / Mark')) throw new Error('Aarre masters already exist: inspect before modifying.');
const created = [];
const record = node => { created.push(node.id); return node; };
const rgb = hex => ({r:parseInt(hex.slice(1,3),16)/255,g:parseInt(hex.slice(3,5),16)/255,b:parseInt(hex.slice(5,7),16)/255});
const collection = figma.variables.createVariableCollection('Aarre / Brand colors');
const mode = collection.modes[0].modeId;
collection.renameMode(mode,'Brand');
const variables = {};
const styles = {};
for (const [name,hex] of Object.entries(data.palette)) {
  const variable = figma.variables.createVariable(name,collection,'COLOR');
  variable.scopes = ['FRAME_FILL','SHAPE_FILL','TEXT_FILL','STROKE_COLOR'];
  variable.setValueForMode(mode,rgb(hex));
  variable.setVariableCodeSyntax('WEB',`var(--aarre-brand-${name})`);
  variables[name] = variable;
  const style = figma.createPaintStyle();
  style.name = `Aarre / ${name}`;
  style.paints = [figma.variables.setBoundVariableForPaint({type:'SOLID',color:rgb(hex)},'color',variable)];
  styles[name] = style;
}
const paint = name => [figma.variables.setBoundVariableForPaint({type:'SOLID',color:rgb(data.palette[name])},'color',variables[name])];
const markMasters = {};
for (const [index,optical] of ['regular','micro'].entries()) {
  const master = record(figma.createComponent());
  master.name = `Optical=${optical === 'regular' ? 'Regular' : 'Micro'}`;
  master.resize(128,128);
  master.fills = [];
  master.clipsContent = false;
  master.description = optical === 'regular'
    ? 'A1 聚拢 / 标准母版。三块独立矢量，九个圆与公切线构造。用于 24px 及以上。'
    : 'A1 聚拢 / 微型母版。所有构造圆半径减少 2u，保持中心与切线方向，放大负空间。用于 16–20px。';
  for (const shape of data[optical]) {
    const vector = record(figma.createVector());
    vector.name = shape.name;
    vector.vectorPaths = [{windingRule:'NONZERO',data:shape.localPath}];
    vector.fills = paint('poppy');
    vector.strokes = [];
    master.appendChild(vector);
    vector.x = shape.bounds.x;
    vector.y = shape.bounds.y;
  }
  master.exportSettings = [{format:'SVG',suffix:`-${optical}`}];
  markMasters[optical] = master;
}
const markSet = record(figma.combineAsVariants(Object.values(markMasters),page));
markSet.name = 'Aarre / Mark';
markSet.description = '拾集 A1 聚拢。Regular 用于 ≥24px；Micro 用于 16–20px。每个实例由三块单色独立矢量组成。';
markSet.x = 95968; markSet.y = 2780;
markSet.resize(360,208);
markSet.fills = [];
Object.values(markMasters).forEach((node,i)=>{node.x=36+i*164;node.y=40;});
figma.currentPage.selection=[markSet];
return {
  createdNodeIds:created,mutatedNodeIds:[],pageId:page.id,
  collectionId:collection.id,
  variables:Object.fromEntries(Object.entries(variables).map(([k,v])=>[k,v.id])),
  styles:Object.fromEntries(Object.entries(styles).map(([k,v])=>[k,v.id])),
  markSetId:markSet.id,
  marks:Object.fromEntries(Object.entries(markMasters).map(([k,v])=>[k,{id:v.id,paths:v.children.map(n=>({id:n.id,width:n.width,height:n.height,x:n.x,y:n.y}))}])),
};
