import {useId} from 'react';
import type {CoordinateAttempt,CoordinatePoint} from '@firecnc/learning';

const label=(value:number)=>String(Number(value.toFixed(3))).replace('-','−').replace('.',',');
export function CoordinateDrawing({attempt:a}:{attempt:CoordinateAttempt}){
  const id=useId().replace(/:/g,''),drawing=a.drawing;
  if(a.kind!=='turning'||!drawing)return <MillingDrawing attempt={a}/>;
  const maxDiameter=Math.max(...drawing.sections.map(s=>s.diameter)),scale=Math.min(900/drawing.length,240/(maxDiameter/2)),origin={x:1080,y:435};
  const xy=(p:CoordinatePoint)=>({x:origin.x+p.z*scale,y:origin.y-p.x/2*scale});
  const back=a.points.at(-1)!,backX=xy(back).x,topY=xy(back).y;
  const contour=a.points.map(p=>{const v=xy(p);return `${v.x},${v.y}`;}).join(' ');
  const target=a.points[a.index]!,previous=a.index?a.points[a.index-1]:undefined,current=xy(target);
  const occupied:{x:number;y:number}[]=[];
  const features=[...drawing.chamfers.map(e=>({...e,text:`${label(e.size)}×45°`,kind:'chamfer'})),...drawing.tapers.map(e=>({...e,text:'45°',kind:'taper'}))].map(e=>{
    const from=xy(a.points[e.from]!),to=xy(a.points[e.to]!),middle={x:(from.x+to.x)/2,y:(from.y+to.y)/2};
    let x=Math.max(455,Math.min(1080,middle.x)),y=middle.y-54;
    while(occupied.some(p=>Math.abs(p.x-x)<122&&Math.abs(p.y-y)<32))y-=36;
    y=Math.max(80,y);occupied.push({x,y});return {...e,middle,label:{x,y}};
  });
  let previousX=-Infinity,previousRow=1;
  const stations=drawing.stations.slice().reverse().map(z=>{
    const x=origin.x+z*scale,row=x-previousX<68?1-previousRow:0;previousX=x;previousRow=row;return {x,z,row};
  });
  return <svg className="coordinate-blueprint" viewBox="0 0 1200 630" role="img" aria-label="Размерный чертёж токарной детали с фасками 45 градусов. X — диаметр, Z — от правого торца.">
    <defs>
      <pattern id={`${id}-hatch`} width="13" height="13" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V13" stroke="#a3adb7" strokeWidth="1.3"/></pattern>
      <marker id={`${id}-arrow`} markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto-start-reverse"><path d="M0 0L9 3.5L0 7Z" fill="#334155"/></marker>
    </defs>
    <rect width="1200" height="630" fill="#fff"/>
    <g className="blueprint-clamp"><rect x={backX-60} y={topY-22} width="78" height={origin.y-topY+45} fill={`url(#${id}-hatch)`} stroke="#75818d" strokeWidth="1.5"/></g>
    <path d={`M${origin.x} ${origin.y} L${contour} L${backX} ${origin.y} Z`} fill="#f8fafc"/>
    <path d={`M${origin.x} ${origin.y} L${contour} L${backX} ${origin.y}`} fill="none" stroke="#18232e" strokeWidth="3.5" strokeLinejoin="miter"/>
    <path className="blueprint-axis" d={`M${backX-100} ${origin.y}H1153M${origin.x} ${origin.y+25}V${origin.y-95}`} markerEnd={`url(#${id}-arrow)`}/>
    <circle cx={origin.x} cy={origin.y} r="3" fill="#18232e"/>
    <text x={origin.x+15} y={origin.y-82} className="blueprint-axis-label">+X</text><text x="1143" y={origin.y+34} className="blueprint-axis-label">+Z</text><text x={origin.x+16} y={origin.y-9} className="blueprint-origin">0</text>
    {drawing.sections.map((s,i)=>{
      const x=origin.x+(s.frontZ+s.backZ)/2*scale,y=origin.y-s.diameter/2*scale;
      return <g className="blueprint-diameter" data-diameter={s.diameter} key={i}>
        <path d={`M${x-13} ${y}h26M${x-13} ${origin.y}h26`}/><path d={`M${x} ${origin.y-4}V${y+4}`} markerStart={`url(#${id}-arrow)`} markerEnd={`url(#${id}-arrow)`}/>
        <text x={x-10} y={(origin.y+y)/2+8} textAnchor="end">Ø{label(s.diameter)}</text>
      </g>;
    })}
    {features.map((feature,i)=><g className="blueprint-bevel" data-feature={feature.kind==='chamfer'?'chamfer-45':'taper-45'} key={i}>
      <path d={`M${feature.middle.x} ${feature.middle.y}L${feature.label.x-16} ${feature.label.y+13}H${feature.label.x+39}`}/>
      <text x={feature.label.x} y={feature.label.y} textAnchor="middle">{feature.text}</text>
    </g>)}
    <g className="blueprint-lengths">
      <path d={`M${backX} 497H${origin.x}`}/>
      {stations.map(({x,z,row},i)=><g key={i}><path d={`M${x} ${origin.y+13}V${row?539:509}`}/><path d={`M${x-4} 501l8-8`}/><text x={x} y={row?563:533} textAnchor="middle">{label(z)}</text></g>)}
      <path d={`M${backX} 574v18M${origin.x} 574v18`}/><path d={`M${backX+3} 583H${origin.x-3}`} markerStart={`url(#${id}-arrow)`} markerEnd={`url(#${id}-arrow)`}/>
      <text x={(backX+origin.x)/2} y="593" textAnchor="middle">{label(drawing.length)}</text>
    </g>
    {previous&&<path d={`M${xy(previous).x} ${xy(previous).y}L${current.x} ${current.y}`} fill="none" stroke="#0b7a62" strokeWidth="4"/>}
    {a.points.map((p,i)=>{const v=xy(p),active=i===a.index;return <circle className={active?'blueprint-target':undefined} key={i} cx={v.x} cy={v.y} r={active?8.5:i===0?7:4.5} fill={i===0?'#efce37':active?'#138556':'#c04740'} stroke={active||i===0?'#17232e':'#fff'} strokeWidth={active||i===0?1.8:1}/>;})}
    <text x="32" y="613" className="blueprint-note">Размеры в мм · X — диаметр</text>
    <g className="blueprint-legend"><circle cx="657" cy="607" r="6" fill="#efce37"/><text x="671" y="613">Начальная</text><circle cx="824" cy="607" r="6" fill="#138556"/><text x="838" y="613">Текущая</text><circle cx="974" cy="607" r="5" fill="#c04740"/><text x="988" y="613">Остальные точки</text></g>
  </svg>;
}

function MillingDrawing({attempt:a}:{attempt:CoordinateAttempt}){
  const width=Math.max(...a.points.map(p=>p.x))+10,height=Math.max(...a.points.map(p=>p.y))+10,scale=Math.min(850/width,315/height),origin={x:220,y:445};
  const xy=(p:CoordinatePoint)=>({x:origin.x+p.x*scale,y:origin.y-p.y*scale}),current=xy(a.points[a.index]!);
  return <svg className="coordinate-blueprint" viewBox="0 0 1200 630" role="img" aria-label="Размерная схема фрезерного контура XY.">
    <rect width="1200" height="630" fill="#fff"/><path className="blueprint-axis" d={`M${origin.x-30} ${origin.y}H1110M${origin.x} 470V140`}/><text x="1120" y="454">+X</text><text x="196" y="135">+Y</text>
    <polyline points={a.points.map(p=>{const v=xy(p);return `${v.x},${v.y}`;}).join(' ')} fill="#f8fafc" stroke="#18232e" strokeWidth="3.5"/>
    {[...new Set(a.points.map(p=>p.x))].map(x=><g key={x}><path className="blueprint-dimension" d={`M${origin.x+x*scale} ${origin.y}v50`}/><text x={origin.x+x*scale} y="526" textAnchor="middle">{label(x)}</text></g>)}
    {[...new Set(a.points.map(p=>p.y))].map(y=><text key={y} x="202" y={origin.y-y*scale+7} textAnchor="end">{label(y)}</text>)}
    {a.points.map((p,i)=>{const v=xy(p);return <circle key={i} cx={v.x} cy={v.y} r={i===a.index?8.5:5} fill={i===a.index?'#138556':'#c04740'} stroke="#fff" strokeWidth="1.5"/>;})}<circle cx={current.x} cy={current.y} r="10" fill="none" stroke="#18232e"/>
    <text x="32" y="613" className="blueprint-note">Размеры в мм · координаты центра инструмента</text>
  </svg>;
}
