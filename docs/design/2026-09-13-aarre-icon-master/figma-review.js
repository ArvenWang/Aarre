// Adapted from createDocumentationPage: existing page, scoped icon specimens.
// Prepend actual `state` and `data`. All artwork is native Figma vector geometry.
const page=await figma.getNodeByIdAsync(state.pageId);await figma.setCurrentPageAsync(page);
await Promise.all([figma.loadFontAsync({family:'Inter',style:'Regular'}),figma.loadFontAsync({family:'Inter',style:'Semi Bold'}),figma.loadFontAsync({family:'Noto Sans SC',style:'Regular'}),figma.loadFontAsync({family:'Noto Sans SC',style:'Medium'})]);
const variables={};for(const [k,id] of Object.entries(state.variables))variables[k]=await figma.variables.getVariableByIdAsync(id);
const rgb=hex=>({r:parseInt(hex.slice(1,3),16)/255,g:parseInt(hex.slice(3,5),16)/255,b:parseInt(hex.slice(5,7),16)/255});
const paint=(key,opacity=1)=>[{...figma.variables.setBoundVariableForPaint({type:'SOLID',color:rgb(data.palette[key])},'color',variables[key]),opacity}];
const styles={};
for(const [name,size,lineHeight,family,style] of [['Display',48,58,'Inter','Semi Bold'],['Heading',22,32,'Noto Sans SC','Medium'],['Body',16,26,'Noto Sans SC','Regular'],['Label',13,20,'Noto Sans SC','Regular']]) {
  const s=figma.createTextStyle();s.name=`Aarre / Specimen / ${name}`;s.fontName={family,style};s.fontSize=size;s.lineHeight={unit:'PIXELS',value:lineHeight};styles[name]=s;
}
function layout(parent,name,direction,width,height,padding=0,gap=0,fill=null){
  const n=figma.createAutoLayout(direction);n.name=name;n.fills=fill?paint(fill):[];n.itemSpacing=gap;n.paddingTop=padding;n.paddingBottom=padding;n.paddingLeft=padding;n.paddingRight=padding;
  n.primaryAxisSizingMode='AUTO';n.counterAxisSizingMode='FIXED';n.resize(width,height||1);
  if(height){n.primaryAxisSizingMode='FIXED';n.counterAxisSizingMode='FIXED';n.resize(width,height);}
  if(parent)parent.appendChild(n);if(!height)n.layoutSizingVertical='HUG';return n;
}
async function text(parent,name,value,style='Body',color='aubergine',width){
  const t=figma.createText();t.name=name;await t.setTextStyleIdAsync(styles[style].id);t.characters=value;t.fills=paint(color);parent.appendChild(t);
  t.textAutoResize='HEIGHT';t.resize(width||parent.width-parent.paddingLeft-parent.paddingRight,Math.max(20,t.height));return t;
}
function centeredStage(parent,name,width,height){const n=layout(parent,name,'HORIZONTAL',width,height);n.primaryAxisAlignItems='CENTER';n.counterAxisAlignItems='CENTER';return n;}
const root=layout(page,'Aarre · 拾集 A1 / 矢量精修','VERTICAL',1440,null,48,32,'butter');root.x=95920;root.y=640;
const header=layout(root,'Title','VERTICAL',1344,null,0,8);
await text(header,'Eyebrow','A1 / 聚拢   ·   VECTOR ICON MASTER','Label');
await text(header,'Brand','Aarre','Display');
await text(header,'Intro','拾集：把值得留下的小发现，聚在一起。','Body');
const hero=layout(root,'Mark and construction','HORIZONTAL',1344,544,0,32);
const main=layout(hero,'Primary mark','VERTICAL',656,544,32,12,'poppy');main.cornerRadius=24;
await text(main,'Primary label','01  主标志','Heading');
const mainStage=centeredStage(main,'Mark specimen',592,384);
const markMaster=await figma.getNodeByIdAsync(state.marks.regular.id);
const mark=markMaster.createInstance();mark.name='Aarre / Final mark';mark.rescale(3);for(const v of mark.children)v.fills=paint('butter');mainStage.appendChild(mark);
await text(main,'Primary caption','三块独立石形 · 单色标志','Label');
const construction=layout(hero,'Compass and straightedge construction','VERTICAL',656,544,32,12);
construction.cornerRadius=24;construction.strokes=paint('aubergine',0.14);construction.strokeWeight=1;
await text(construction,'Construction heading','02  尺规构造','Heading');
const guideStage=centeredStage(construction,'Construction stage',592,384);
const diagram=figma.createFrame();diagram.name='128u / circles and common tangents';diagram.resize(384,384);diagram.fills=[];diagram.clipsContent=false;guideStage.appendChild(diagram);
await text(construction,'Construction caption','9 个构造圆 · 公切线连接 · 128u 基准网格','Label');
const colorSection=layout(root,'Color applications','VERTICAL',1344,null,0,16);
await text(colorSection,'Color heading','03  图标应用','Heading');
const colors=layout(colorSection,'Three colorways','HORIZONTAL',1344,254,0,24);
const colorInstances=[];
for(const [theme,label,hex] of [['poppy','Poppy / 主版本','#F2633D'],['aubergine','Aubergine / 深色版','#392B3A'],['lavender','Lavender / 辅助版','#D1C9E9']]){
  const card=layout(colors,`${theme} specimen`,'VERTICAL',432,254,24,14);card.cornerRadius=18;card.strokes=paint('aubergine',0.14);card.strokeWeight=1;
  const stage=centeredStage(card,'Icon specimen',384,128);
  const tileMaster=await figma.getNodeByIdAsync(state.tiles.find(t=>t.name===`Theme=${theme}, Optical=Regular`).id);
  const instance=tileMaster.createInstance();instance.name=`Aarre / ${theme} / 128`;stage.appendChild(instance);colorInstances.push({theme,id:instance.id});
  await text(card,`${theme} name`,label,'Body');await text(card,`${theme} hex`,hex,'Label');
}
const sizeSection=layout(root,'Actual size specimens','VERTICAL',1344,null,0,16);
await text(sizeSection,'Size heading','04  实际尺寸','Heading');
await text(sizeSection,'Size note','16–20px 使用 Micro 版，略微加宽间隙；24px 及以上使用标准版。','Body');
const sizes=layout(sizeSection,'16–128px instances','HORIZONTAL',1344,174,0,28);
const sizeInstances=[];
for(const size of [16,20,24,32,48,64,128]){
  const cell=layout(sizes,`${size}px`,'VERTICAL',168,174,0,12);
  const stage=centeredStage(cell,'Actual pixel size',168,128);
  const optical=size<=20?'Micro':'Regular';const tileMaster=await figma.getNodeByIdAsync(state.tiles.find(t=>t.name===`Theme=poppy, Optical=${optical}`).id);
  const instance=tileMaster.createInstance();instance.name=`aarre-poppy-${size}`;instance.rescale(size/128);instance.exportSettings=[{format:'PNG',constraint:{type:'SCALE',value:1}}];stage.appendChild(instance);
  const label=await text(cell,'Pixel label',`${size}px${size<=20?' · Micro':''}`,'Label');label.textAlignHorizontal='CENTER';sizeInstances.push({size,optical,id:instance.id});
}
const notes=layout(root,'Construction notes','VERTICAL',1344,null,0,8);
await text(notes,'Notes heading','构造说明','Heading');
await text(notes,'Notes','标准版三处最短间隙约 5.6 / 6.2 / 6.8u；Micro 版缩小各构造圆半径 2u，使最小间隙增至约 9.6u。\n图标容器为 128 × 128u、R30；内部标志为 112 × 112u，四周保留 8u。','Body');
root.exportSettings=[{format:'PNG',constraint:{type:'SCALE',value:1}}];
figma.currentPage.selection=[root];figma.viewport.scrollAndZoomIntoView([root]);
return {createdNodeIds:[root.id,...root.findAll().map(n=>n.id)],mutatedNodeIds:[],reviewId:root.id,reviewBounds:{x:root.x,y:root.y,width:root.width,height:root.height},diagramId:diagram.id,heroMarkId:mark.id,colorInstances,sizeInstances,textStyles:Object.fromEntries(Object.entries(styles).map(([k,v])=>[k,v.id]))};
