import type {GeometryTarget} from '../../../packages/learning/src/geometry-grade';
export function TargetDrawing({target:t}:{target:GeometryTarget}) {
  const width=620,height=350;
  if(t.kind==='turning'){
    const scale=Math.min(480/t.length,210/t.diameter),ox=80,oy=270;
    const boundaries=[-t.length,...t.regions.flatMap(r=>[r.from,r.to]),t.front].filter((x,i,a)=>a.indexOf(x)===i).sort((a,b)=>a-b);
    const radius=(z:number)=>Math.min(t.diameter/2,...t.regions.filter(r=>z>=r.from&&z<=r.to).map(r=>r.diameter/2));
    const points:number[][]=[];for(let i=0;i<boundaries.length-1;i++){const a=boundaries[i]!,b=boundaries[i+1]!;points.push([ox+(a+t.length)*scale,oy-radius((a+b)/2)*scale],[ox+(b+t.length)*scale,oy-radius((a+b)/2)*scale]);}
    return <svg className="target-drawing" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Чертёж целевой токарной детали"><path className="drawing-axis" d={`M45 ${oy}H580`}/><polygon points={[[ox,oy],...points,[ox+(t.front+t.length)*scale,oy]].map(p=>p.join(',')).join(' ')} fill="#d5ad6b33" stroke="var(--text)" strokeWidth="2"/><text x="35" y="30">Целевая деталь · размеры в мм · X в диаметре</text><text x="80" y="315">Заготовка Ø{t.diameter} × {t.length} · торец Z{t.front}</text>{t.regions.map((r,i)=><text x="80" y={55+i*22} key={i}>Ø{r.diameter} на Z{r.from}…{r.to}</text>)}{boundaries.map((z,i)=><g key={z}><path className="drawing-axis" d={`M${ox+(z+t.length)*scale} ${oy+4}v${i%2?25:10}`}/><text textAnchor="middle" x={ox+(z+t.length)*scale} y={oy+(i%2?49:30)}>Z{z}</text></g>)}</svg>;
  }
  const scale=Math.min(470/t.width,210/t.depth),x=70,y=70;
  return <svg className="target-drawing" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Чертёж целевой фрезерной детали"><text x="35" y="30">Целевая деталь · вид сверху · размеры в мм</text><rect x={x} y={y} width={t.width*scale} height={t.depth*scale} fill="#d5ad6b33" stroke="var(--text)" strokeWidth="2"/>{t.regions.map((r,i)=><g key={i}><rect x={x+r.left*scale} y={y+(t.depth-r.top)*scale} width={(r.right-r.left)*scale} height={(r.top-r.bottom)*scale} rx={r.radius*scale} fill="#80dec744" stroke="var(--accent)" strokeWidth="2"/><text x="70" y={305+i*19}>X{r.left}…{r.right} · Y{r.bottom}…{r.top} · глубина {r.depth}{r.radius?` · R${r.radius}`:''}</text></g>)}<text x="70" y="55">Заготовка {t.width} × {t.depth} × {t.thickness}</text></svg>;
}
