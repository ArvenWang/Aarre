// Prepend the actual `state` from figma-state.json and `data` from geometry.json.
const page=await figma.getNodeByIdAsync(state.pageId);
await figma.setCurrentPageAsync(page);
const created=[];
const record=n=>{created.push(n.id);return n;};
const vars={};
for(const [key,id] of Object.entries(state.variables)) vars[key]=await figma.variables.getVariableByIdAsync(id);
const rgb=hex=>({r:parseInt(hex.slice(1,3),16)/255,g:parseInt(hex.slice(3,5),16)/255,b:parseInt(hex.slice(5,7),16)/255});
const paint=name=>[figma.variables.setBoundVariableForPaint({type:'SOLID',color:rgb(data.palette[name])},'color',vars[name])];
const masters={};
for(const [key,value] of Object.entries(state.marks)) masters[key]=await figma.getNodeByIdAsync(value.id);
const tileMasters=[];
for(const [theme,foreground] of [['poppy','butter'],['aubergine','butter'],['lavender','aubergine']]) {
  for(const optical of ['regular','micro']) {
    const tile=record(figma.createComponent());
    tile.name=`Theme=${theme}, Optical=${optical==='regular'?'Regular':'Micro'}`;
    tile.layoutMode='HORIZONTAL';
    tile.primaryAxisSizingMode='FIXED';tile.counterAxisSizingMode='FIXED';
    tile.primaryAxisAlignItems='CENTER';tile.counterAxisAlignItems='CENTER';
    tile.resize(128,128);tile.cornerRadius=30;
    tile.paddingLeft=8;tile.paddingRight=8;tile.paddingTop=8;tile.paddingBottom=8;
    tile.fills=paint(theme);tile.clipsContent=true;
    const mark=record(masters[optical].createInstance());
    mark.rescale(0.875);tile.appendChild(mark);
    for(const v of mark.children){v.fills=paint(foreground);created.push(v.id);}
    tile.exportSettings=[{format:'SVG'}];
    tileMasters.push(tile);
  }
}
const tileSet=record(figma.combineAsVariants(tileMasters,page));
tileSet.name='Aarre / App icon';
tileSet.description='128u 外框，R30；112u 标志实例，四周 8u。Poppy 为主色；Aubergine 与 Lavender 为辅助色。16–20px 使用 Micro。';
tileSet.x=96416;tileSet.y=2780;tileSet.resize(524,372);tileSet.fills=[];
tileMasters.forEach((n,i)=>{n.x=32+Math.floor(i/2)*164;n.y=36+(i%2)*164;});
return {createdNodeIds:created,mutatedNodeIds:[],tileSetId:tileSet.id,tiles:tileMasters.map(n=>({id:n.id,name:n.name,nestedMark:n.children[0].id,box:{x:n.children[0].x,y:n.children[0].y,width:n.children[0].width,height:n.children[0].height}}))};
