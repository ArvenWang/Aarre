const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const TAU = Math.PI * 2;
const round = v => Math.round(v * 100000) / 100000;
const angle = v => ((v % TAU) + TAU) % TAU;
const palette = { poppy: '#F2633D', lavender: '#D1C9E9', butter: '#F9F0D5', aubergine: '#392B3A' };
const source = [
  { name: '01 Gather / upper stone', circles: [[73.75,25,17],[47.75,47,13],[85.75,48,15]] },
  { name: '02 Keep / lower left', circles: [[25.75,74,15],[30.75,89,17],[45.75,101,15]] },
  { name: '03 Return / lower right', circles: [[95.25,84,16],[97.25,100,20],[81.25,98,15]] },
];

// Construct the convex envelope of unequal circles. Every straight edge is
// a common external tangent. Every curved section belongs to a source circle.
// Circular arcs are represented in Figma by tangent cubic Bezier segments.
function construct(item, radiusInset = 0) {
  const circles = item.circles.map(([x,y,r]) => ({x,y,r:r-radiusInset}));
  const breaks = [0, TAU];
  for (let i=0;i<circles.length;i++) for(let j=i+1;j<circles.length;j++) {
    const a=circles[i], b=circles[j], dx=a.x-b.x, dy=a.y-b.y;
    const d=Math.hypot(dx,dy), q=(b.r-a.r)/d;
    if(Math.abs(q)<1) { const phi=Math.atan2(dy,dx), t=Math.acos(q); breaks.push(angle(phi+t),angle(phi-t)); }
  }
  breaks.sort((a,b)=>a-b);
  const sectors=[];
  for(let k=0;k<breaks.length-1;k++) {
    const a=breaks[k], b=breaks[k+1]; if(b-a<1e-8) continue;
    const m=(a+b)/2;
    const support=circles.map(c=>c.x*Math.cos(m)+c.y*Math.sin(m)+c.r);
    const i=support.indexOf(Math.max(...support));
    if(sectors.length && sectors.at(-1).i===i) sectors.at(-1).b=b;
    else sectors.push({i,a,b});
  }
  if(sectors.length>1 && sectors[0].i===sectors.at(-1).i) { sectors[0].a=sectors.pop().a-TAU; }
  const bounds={x:Math.min(...circles.map(c=>c.x-c.r)),y:Math.min(...circles.map(c=>c.y-c.r))};
  bounds.width=Math.max(...circles.map(c=>c.x+c.r))-bounds.x;
  bounds.height=Math.max(...circles.map(c=>c.y+c.r))-bounds.y;
  const pt=(c,t)=>({x:c.x+c.r*Math.cos(t),y:c.y+c.r*Math.sin(t)});
  const tangents=sectors.map((s,k)=>({from:pt(circles[s.i],s.b),to:pt(circles[sectors[(k+1)%sectors.length].i],sectors[(k+1)%sectors.length].a)}));
  function makePath(ox=0,oy=0) {
    const pstr=p=>`${round(p.x-ox)} ${round(p.y-oy)}`;
    const commands=[`M ${pstr(pt(circles[sectors[0].i],sectors[0].a))}`];
    sectors.forEach((s,idx)=>{
      const c=circles[s.i], n=Math.ceil((s.b-s.a)/(Math.PI/2));
      for(let j=0;j<n;j++) {
        const a=s.a+(s.b-s.a)*j/n,b=s.a+(s.b-s.a)*(j+1)/n;
        const p0=pt(c,a),p1=pt(c,b),k=4/3*Math.tan((b-a)/4);
        const h0={x:p0.x-c.r*Math.sin(a)*k,y:p0.y+c.r*Math.cos(a)*k};
        const h1={x:p1.x+c.r*Math.sin(b)*k,y:p1.y-c.r*Math.cos(b)*k};
        commands.push(`C ${pstr(h0)} ${pstr(h1)} ${pstr(p1)}`);
      }
      commands.push(`L ${pstr(tangents[idx].to)}`);
    });
    commands.push('Z'); return commands.join(' ');
  }
  return {...item,circles,bounds,sectors,tangents,path:makePath(),localPath:makePath(bounds.x,bounds.y)};
}

const regular=source.map(s=>construct(s));
const micro=source.map(s=>construct(s,2));
const data={name:'Aarre / 拾集 A1 聚拢',viewBox:[0,0,128,128],palette,method:'Convex envelopes of nine unequal circles with common external tangents. Arc-to-cubic conversion: k = 4/3 tan(theta/4).',regular,micro};
fs.writeFileSync(path.join(__dirname,'geometry.json'),JSON.stringify(data,null,2)+'\n');
function boundarySamples(shape) {
  const points=[];
  for(const s of shape.sectors) {
    const c=shape.circles[s.i];
    for(let k=0;k<=256;k++) {const t=s.a+(s.b-s.a)*k/256;points.push([c.x+c.r*Math.cos(t),c.y+c.r*Math.sin(t)]);}
  }
  for(const t of shape.tangents) for(let k=0;k<=100;k++) points.push([t.from.x+(t.to.x-t.from.x)*k/100,t.from.y+(t.to.y-t.from.y)*k/100]);
  return points;
}
const metrics={};
for(const optical of ['regular','micro']) {
  const samples=data[optical].map(boundarySamples); metrics[optical]=[];
  for(let i=0;i<3;i++) for(let j=i+1;j<3;j++) {
    let best={gap:Infinity};
    for(const a of samples[i]) for(const b of samples[j]) {
      const distance=Math.hypot(a[0]-b[0],a[1]-b[1]);
      if(distance<best.gap) best={gap:distance,from:a,to:b};
    }
    metrics[optical].push({pair:[i+1,j+1],...best,gap:round(best.gap)});
  }
}
fs.writeFileSync(path.join(__dirname,'geometry-metrics.json'),JSON.stringify(metrics,null,2)+'\n');
const paths=(shapes,fill)=>shapes.map(s=>`<path d="${s.path}" fill="${fill}"/>`).join('');
const mark=(x,y,size,fill,shapes=regular)=>`<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 128 128">${paths(shapes,fill)}</svg>`;
const tile=(x,y,size,bg,fg,shapes=regular)=>`<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size*.234375}" fill="${bg}"/>${mark(x+size/16,y+size/16,size*.875,fg,shapes)}`;
const guides=regular.map(s=>s.circles.map(c=>`<circle cx="${c.x}" cy="${c.y}" r="${c.r}" fill="none" stroke="#D1C9E9" stroke-width=".4"/><path d="M ${c.x-1} ${c.y} L ${c.x+1} ${c.y} M ${c.x} ${c.y-1} L ${c.x} ${c.y+1}" stroke="#F2633D" stroke-width=".4"/>`).join('')+`<path d="${s.path}" fill="none" stroke="#392B3A" stroke-width=".55"/>`).join('');
const sizes=[16,20,24,32,48,64,128];
const samples=sizes.map((s,i)=>tile(50+i*155,535,s,palette.poppy,palette.butter,s<=20?micro:regular)+`<text x="${50+i*155}" y="700" font-size="14" fill="#392B3A">${s}px${s<=20?' / Micro':''}</text>`).join('');
const preview=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760"><rect width="1200" height="760" fill="#F9F0D5"/><g font-family="Arial,sans-serif"><text x="50" y="60" font-size="22" fill="#392B3A">Aarre / A1 - Circle construction study</text>${tile(50,110,320,palette.poppy,palette.butter)}${tile(405,110,150,palette.aubergine,palette.butter)}${tile(405,280,150,palette.lavender,palette.aubergine)}<svg x="630" y="105" width="330" height="330" viewBox="0 0 128 128">${guides}</svg><text x="630" y="465" font-size="16" fill="#392B3A">9 circles / 3 editable shapes / tangent continuity</text>${samples}</g></svg>`;
fs.writeFileSync(path.join(__dirname,'construction-study.svg'),preview);
sharp(Buffer.from(preview)).png().toFile(path.join(__dirname,'construction-study.png')).then(()=>console.log(JSON.stringify({regular:regular.map(s=>({name:s.name,bounds:s.bounds,circles:s.circles})),output:path.join(__dirname,'construction-study.png')})));
