import {caliperReading,micrometerReading,type InstrumentKind} from '@firecnc/learning';
export function InstrumentScale({kind,ticks,explain=false}:{kind:InstrumentKind;ticks:number;explain?:boolean}) {
  if(kind==='caliper'){
    const m=caliperReading(ticks),start=Math.max(0,m.main-1),scale=24,zero=50+(m.value-start)*scale;
    return <svg className="instrument-scale" viewBox="0 0 650 330" role="img" aria-label="Штангенциркуль: основная шкала и двадцатиделенный нониус">
      <path d="M50 52H600" className="instrument-metal" strokeWidth="12"/><path d="M50 35V95H65" className="instrument-metal" strokeWidth="9" fill="none"/><path d={`M${50+m.value*3.4} 35V95h-15`} className="instrument-metal" strokeWidth="9" fill="none"/><text x="50" y="25">Губки · диапазон 0–150 мм</text>
      <rect x="25" y="115" width="600" height="150" rx="8" fill="var(--panel2)" stroke="var(--line)"/>
      {Array.from({length:24},(_,i)=>start+i).filter(mm=>mm<=170).map(mm=><g key={mm}><path d={`M${50+(mm-start)*scale} 173v-${mm%5===0?37:23}`} stroke={explain&&mm===m.main+m.vernier?'var(--accent)':'var(--text)'} strokeWidth="1.5"/><text x={50+(mm-start)*scale} y="128" textAnchor="middle">{mm}</text></g>)}
      <rect x={zero-10} y="180" width={19*scale+20} height="80" rx="4" fill="var(--input)" stroke="var(--muted)"/>
      {Array.from({length:21},(_,i)=>i).map(i=><g key={i}><path d={`M${zero+i*m.vernierPitch*scale} 181v${i%2===0?36:24}`} stroke={explain&&i===m.vernier?'var(--accent)':'var(--text)'} strokeWidth={explain&&i===m.vernier?3:1.5}/>{i%4===0&&<text x={zero+i*m.vernierPitch*scale} y="242" textAnchor="middle">{i/2}</text>}</g>)}
      {explain&&<path d={`M${zero+m.vernier*m.vernierPitch*scale} 150v65`} stroke="var(--accent)" strokeWidth="2" strokeDasharray="3 3"/>}
      <text x="50" y="294">Нониус: 20 делений на 19 мм · отсчёт 0,05 мм</text><text x="50" y="316">Увеличенный фрагмент шкалы. Ноль нониуса — начало дробного отсчёта.</text>
    </svg>;
  }
  const m=micrometerReading(ticks),start=Math.max(0,m.millimeters-3),edge=60+(m.value-start)*100,reference=191;
  return <svg className="instrument-scale" viewBox="0 0 650 350" role="img" aria-label="Микрометр: целые и половины миллиметра на стебле, пятьдесят делений барабана">
    <text x="45" y="28">Микрометр 0–25 мм · шаг винта 0,5 мм</text><text x="45" y="58">Стебель</text><text x={edge+30} y="58">Барабан</text>
    <rect x="35" y="125" width={Math.max(25,edge-35)} height="120" fill="var(--panel2)" stroke="var(--muted)"/>
    {Array.from({length:9},(_,i)=>start+i*.5).filter(mm=>mm<=m.value+1e-8&&mm<=25).map(mm=><g key={mm}><path d={`M${60+(mm-start)*100} ${reference}v${Number.isInteger(mm)?-36:30}`} stroke="var(--text)" strokeWidth="2"/>{Number.isInteger(mm)&&<text x={56+(mm-start)*100} y="140" textAnchor="end">{mm}</text>}</g>)}
    <rect x={edge} y="77" width="160" height="231" rx="12" fill="var(--panel2)" stroke="var(--muted)"/>
    {Array.from({length:35},(_,i)=>i-17).map(offset=>{const n=(m.drum+offset+50)%50,y=reference+offset*6;return <g key={offset}><path d={`M${edge+8} ${y}h${n%5===0?54:34}`} stroke={explain&&offset===0?'var(--accent)':'var(--text)'} strokeWidth={explain&&offset===0?3:1.5}/>{n%5===0&&<text x={edge+78} y={y+5}>{n}</text>}</g>;})}
    <path d={`M35 ${reference}H${edge+72}`} stroke="var(--accent)" strokeWidth="1.5"/>
    <text x="45" y="330">Нижние риски — 0,5 мм · барабан: 50 × 0,01 мм</text>
  </svg>;
}
