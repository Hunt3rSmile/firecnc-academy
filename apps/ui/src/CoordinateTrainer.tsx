import {useEffect,useRef,useState} from 'react';
import {coordinateAxes,coordinateFinished,explainCoordinate,type CoordinateAttempt,type CoordinatePoint} from '@firecnc/learning';
import type {AppState,Result} from '@firecnc/contracts';

function Drawing({attempt:a}:{attempt:CoordinateAttempt}) {
  const turning=a.kind==='turning',axis=turning?'z':'x',scale=turning?7:7;
  const xy=(p:CoordinatePoint)=>({x:turning?550+p.z*scale:65+p.x*scale,y:turning?275-p.x/2*scale:320-p.y*scale});
  const polyline=a.points.map(p=>{const v=xy(p);return `${v.x},${v.y}`;}).join(' '),current=a.points[a.index]!,previous=a.index===0?a.start:a.points[a.index-1]!;
  return <svg className="coordinate-drawing" viewBox="0 0 650 390" role="img" aria-label={turning?'Размерная схема ступенчатого профиля. X в диаметрах, Z от правого торца.':'Размерная схема пути центра фрезы в плоскости XY.'}>
    <defs><pattern id="coordinate-grid" width="35" height="35" patternUnits="userSpaceOnUse"><path d="M35 0H0V35" fill="none" stroke="var(--line)" strokeWidth=".5"/></pattern></defs>
    <rect width="650" height="390" rx="12" fill="var(--panel)"/><rect x="35" y="30" width="580" height="320" fill="url(#coordinate-grid)"/>
    {turning?<><path d="M65 275H600M550 45V335" className="drawing-axis"/><text x="580" y="297">+Z</text><text x="560" y="50">+X Ø</text><text x="560" y="295">0</text>
      {[10,20,30,40,50,60].map(d=><g key={d}><path d={`M${550-d*7} 270v10`} className="drawing-axis"/><text x={550-d*7} y="306" textAnchor="middle">−{d}</text></g>)}
      {[10,20,30,40,50,60].map(d=><g key={d}><path d={`M545 ${275-d/2*7}h10`} className="drawing-axis"/><text x="570" y={280-d/2*7}>Ø{d}</text></g>)}
    </>:<><path d="M45 320H610M65 345V30" className="drawing-axis"/><text x="606" y="345">+X</text><text x="38" y="30">+Y</text>
      {[0,10,20,30,40,50,60,70].map(d=><text key={d} x={65+d*7} y="345" textAnchor="middle">{d}</text>)}
      {[10,20,30,40].map(d=><text key={d} x="45" y={325-d*7} textAnchor="end">{d}</text>)}
    </>}
    <polyline points={polyline} fill="none" stroke="var(--muted)" strokeWidth="10" strokeLinejoin="round" opacity=".18"/><polyline points={polyline} fill="none" stroke="var(--muted)" strokeWidth="2"/>
    <path d={`M${xy(previous).x} ${xy(previous).y}L${xy(current).x} ${xy(current).y}`} fill="none" stroke="var(--accent)" strokeWidth="4"/>
    {a.points.map((p,i)=>{const v=xy(p);return <g key={i}><circle cx={v.x} cy={v.y} r={i===a.index?7:4} fill={i===a.index?'var(--accent)':'var(--muted)'}/><text x={v.x+(i%2?12:-12)} y={v.y-13} textAnchor={i%2?'start':'end'}>{String.fromCharCode(65+i)}</text></g>;})}
    <text x="45" y="375">Размеры в мм · {turning?'X — диаметр, Z — вдоль оси':'координаты центра инструмента'}</text>
    <text x="45" y="20">{turning?'Ступенчатый профиль':'Учебный контур'} · {axis.toUpperCase()} / {turning?'X':'Y'}</text>
  </svg>;
}
export function CoordinateTrainer({app,onError}:{app:AppState;onError:(s:string)=>void}) {
  const [attempt,setAttempt]=useState<CoordinateAttempt|null>(null),[loading,setLoading]=useState(true),[values,setValues]=useState<Record<string,string>>({});
  const first=useRef<HTMLInputElement>(null);
  useEffect(()=>{let live=true;void window.academy.coordinateCurrent().then(r=>{if(live){if(r.ok)setAttempt(r.value);else onError(r.error);setLoading(false);}});return ()=>{live=false;};},[]);
  useEffect(()=>{setValues({});first.current?.focus();},[attempt?.id,attempt?.index]);
  const accept=async(request:Promise<Result<CoordinateAttempt>>)=>{setLoading(true);try{const r=await request;if(r.ok)setAttempt(r.value);else onError(r.error);}catch{onError('Не удалось сохранить ответ. Повторите попытку.');}finally{setLoading(false);}};
  const start=(kind:'turning'|'milling')=>{if(attempt&&!coordinateFinished(attempt)&&attempt.answers.length&&!confirm('Начать новую деталь? Текущая попытка останется в истории экспорта.'))return;void accept(window.academy.coordinateStart({kind}));};
  const answered=attempt&&attempt.answers.length>attempt.index,done=attempt&&coordinateFinished(attempt),answer=attempt?.answers[attempt.index];
  return <div className="coordinate-trainer">
    <div className="page-heading"><div><p className="eyebrow">ПРАКТИКА КООРДИНАТ</p><h1>От точки к точке</h1><p className="muted">Считайте размер с чертежа и задайте движение в указанном режиме.</p></div></div>
    {!attempt?<section className="card coordinate-intro"><h2>Шесть точек. Два режима.</h2><p>В G90 вводите координаты от рабочего нуля. В G91 — изменение от предыдущей точки. Режим выбирается заново для каждой точки.</p><div className="button-row"><button className="primary" disabled={loading} onClick={()=>start('turning')}>Начать с токарной детали</button><button disabled={loading||app.license.status!=='active'||!app.license.modules.includes('milling')} title="Требуется модуль milling" onClick={()=>start('milling')}>Фрезерный контур</button></div>{app.license.status==='demo'&&<p className="micro">В ознакомительном режиме доступна одна законченная токарная деталь.</p>}</section>:<>
      <div className="coordinate-progress"><span>{attempt.kind==='turning'?'Точение · X/Z':'Фрезерование · X/Y'}</span><span>Точка {attempt.index+1} из {attempt.points.length}</span><div role="progressbar" aria-label="Прогресс координат" aria-valuemin={0} aria-valuemax={attempt.points.length} aria-valuenow={attempt.answers.length}><i style={{width:`${attempt.answers.length/attempt.points.length*100}%`}}/></div></div>
      <div className="coordinate-work"><figure className="coordinate-figure"><Drawing attempt={attempt}/><table className="dimension-table" aria-label="Размеры чертежа"><thead><tr><th>Точка</th>{attempt.points.map((_,i)=><th key={i}>{String.fromCharCode(65+i)}</th>)}</tr></thead><tbody>{coordinateAxes(attempt.kind).map(axis=><tr key={axis}><th>{axis.toUpperCase()}{attempt.kind==='turning'&&axis==='x'?' Ø':''}</th>{attempt.points.map((p,i)=><td key={i}>{p[axis]}</td>)}</tr>)}</tbody></table><figcaption>Размерные опоры чертежа, мм. В G91 вычислите разницу между текущей и требуемой точкой.</figcaption></figure><section className="coordinate-entry card">
        {done?<><span className="eyebrow">ПОПЫТКА ЗАВЕРШЕНА</span><h2>Результат: {attempt.answers.filter(a=>a.correct).length} из {attempt.points.length}</h2><p>Ответы и порядок G90/G91 сохранены. Ниже можно разобрать каждую точку.</p><button className="primary" onClick={()=>start(attempt.kind)}>Другая деталь</button></>:<>
          <p className="eyebrow">ВВЕДИТЕ ТОЧКУ {String.fromCharCode(65+attempt.index)}</p><h2 className="coordinate-mode">{attempt.modes[attempt.index]} <small>{attempt.modes[attempt.index]==='G90'?'от нуля':'приращение'}</small></h2>
          <p className="micro">Текущее положение: {coordinateAxes(attempt.kind).map(axis=>`${axis.toUpperCase()}${(attempt.index===0?attempt.start:attempt.points[attempt.index-1]!)[axis]}`).join(' · ')} мм</p>
          <form onSubmit={event=>{event.preventDefault();void accept(window.academy.coordinateAnswer({id:attempt.id,values}));}}><div className="coordinate-inputs">{coordinateAxes(attempt.kind).map((axis,i)=><label key={axis}>{axis.toUpperCase()}{attempt.kind==='turning'&&axis==='x'?' Ø':''}<input ref={i===0?first:undefined} aria-label={`Координата ${axis.toUpperCase()}`} autoComplete="off" inputMode="decimal" required maxLength={32} disabled={!!answered||loading} value={values[axis]??answer?.values[axis]??''} onChange={e=>setValues({...values,[axis]:e.target.value})}/><small>мм</small></label>)}</div>{!answered&&<button className="primary" disabled={loading} type="submit">Проверить →</button>}</form>
          {answered&&answer&&<div className="coordinate-feedback" role="status"><strong>{answer.correct?'✓ Верно':'Нужно исправить расчёт'}</strong><p>{explainCoordinate(attempt)}</p><button className="primary" disabled={loading} onClick={()=>void accept(window.academy.coordinateNext(attempt.id))}>Следующая точка →</button><p className="micro">Следующий отсчёт ведётся от правильного положения на чертеже.</p></div>}
        </>}
      </section></div>
      {done&&<section className="coordinate-review"><h2>Разбор по точкам</h2>{attempt.answers.map((answer,i)=><article className="card" key={i}><strong>{answer.correct?'✓':'×'} Точка {String.fromCharCode(65+i)} · {attempt.modes[i]}</strong><p>Ваш ответ: {coordinateAxes(attempt.kind).map(axis=>`${axis.toUpperCase()}${answer.values[axis]}`).join(' · ')}</p><p>{explainCoordinate(attempt,i)}</p></article>)}</section>}
      <details className="coordinate-options"><summary>Другая обработка и правила</summary><p>Учебный профиль FireCNC DIN. При точении и абсолютный X, и приращение X выражены в диаметрах. Чтение чертежа — аналитическое упражнение, его допуск 0,001 мм не связан с сеткой обработки. Семантика PAL или конкретной промышленной стойки здесь не заявляется.</p><div className="button-row"><button disabled={loading} onClick={()=>start('turning')}>Новая токарная деталь</button><button disabled={loading||app.license.status!=='active'||!app.license.modules.includes('milling')} onClick={()=>start('milling')}>Новый фрезерный контур</button></div></details>
    </>}
  </div>;
}
