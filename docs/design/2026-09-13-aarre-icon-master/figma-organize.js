// Prepend actual state and data. Only the Aarre nodes created this task are moved.
const page=await figma.getNodeByIdAsync(state.pageId);await figma.setCurrentPageAsync(page);
await Promise.all([figma.loadFontAsync({family:'Inter',style:'Regular'}),figma.loadFontAsync({family:'Noto Sans SC',style:'Regular'}),figma.loadFontAsync({family:'Noto Sans SC',style:'Medium'})]);
const vars={};for(const [k,id] of Object.entries(state.variables))vars[k]=await figma.variables.getVariableByIdAsync(id);
const rgb=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});
const paint=k=>[figma.variables.setBoundVariableForPaint({type:'SOLID',color:rgb(data.palette[k])},'color',vars[k])];
const created=[];const record=n=>{created.push(n.id);return n;};
function box(parent,name,width,direction='VERTICAL',gap=20){const n=record(figma.createAutoLayout(direction));n.name=name;n.fills=[];n.itemSpacing=gap;n.resize(width,1);n.layoutSizingHorizontal='FIXED';n.layoutSizingVertical='HUG';if(parent)parent.appendChild(n);return n;}
async function text(parent,name,value,style='Body'){const n=record(figma.createText());await n.setTextStyleIdAsync(state.textStyles[style]);n.name=name;n.characters=value;n.fills=paint('aubergine');n.textAutoResize='HEIGHT';n.resize(parent.width,Math.max(20,n.height));parent.appendChild(n);return n;}
const review=await figma.getNodeByIdAsync(state.reviewId);
const root=box(page,'Aarre / Editable master components',1440);root.fills=paint('butter');root.paddingTop=32;root.paddingBottom=32;root.paddingLeft=32;root.paddingRight=32;root.x=95920;root.y=review.y+review.height+80;
const header=box(root,'Master heading',1376);await text(header,'Heading','组件母版 · 可编辑的原生矢量','Heading');
const row=box(root,'Master sets',1376,'HORIZONTAL',64);
const markCol=box(row,'Mark masters',360);await text(markCol,'Mark label','标志：Regular / Micro');
const markSet=await figma.getNodeByIdAsync(state.markSetId);markCol.appendChild(markSet);
await text(markCol,'Mark usage','标准版用于 ≥24px；Micro 用于 16–20px。\n双击三块图形，可分别编辑矢量节点。','Label');
const tileCol=box(row,'App icon masters',524);await text(tileCol,'Icon label','图标：三种配色 × 两种光学尺寸');
const tileSet=await figma.getNodeByIdAsync(state.tileSetId);tileCol.appendChild(tileSet);
const notes=box(row,'Editing guidance',300);await text(notes,'Usage label','编辑说明');
await text(notes,'Usage details','优先修改左侧标志母版。\n应用图标与上方样例均为实例。\n\n颜色绑定 Aarre / Brand colors：\nPoppy、Butter、Aubergine、Lavender。\n\n右上构造图保留原生圆、公切线、\n圆心与半径标记。','Label');
const inspectionIds=[state.reviewId,root.id,state.markSetId,state.tileSetId];
figma.currentPage.selection=[review];figma.viewport.scrollAndZoomIntoView([review]);
return {createdNodeIds:created,mutatedNodeIds:[markSet.id,tileSet.id],mastersPanelId:root.id,mastersBounds:{x:root.x,y:root.y,width:root.width,height:root.height},inspectionIds};
