import {useEffect,useRef,useState} from 'react';
import {coordinateAxes,coordinateFinished,explainCoordinate,type CoordinateAttempt} from '@firecnc/learning';
import type {AppState,Result} from '@firecnc/contracts';
import {CoordinateDrawing} from './CoordinateDrawing';

type Mode='G90'|'G91'|'mixed';
export function CoordinateTrainer({app,onError}:{app:AppState;onError:(s:string)=>void}){
  const [attempt,setAttempt]=useState<CoordinateAttempt|null>(null),[loading,setLoading]=useState(true),[values,setValues]=useState<Record<string,string>>({}),[mode,setMode]=useState<Mode>('G90'),[settings,setSettings]=useState(false);
  const first=useRef<HTMLInputElement>(null),second=useRef<HTMLInputElement>(null),submit=useRef<HTMLButtonElement>(null);
  const drawingScroll=useRef<HTMLDivElement>(null);
  const answer=attempt?.answers[attempt.index],answered=!!answer?.correct,done=!!attempt&&coordinateFinished(attempt);
  const accept=async(request:Promise<Result<CoordinateAttempt>>)=>{
    setLoading(true);
    try{const r=await request;if(r.ok)setAttempt(r.value);else onError(r.error);}catch{onError('Не удалось сохранить ответ. Повторите попытку.');}finally{setLoading(false);}
  };
  useEffect(()=>{
    let live=true;
    void (async()=>{
      try{
        let r=await window.academy.coordinateCurrent();
        if(!r.ok){if(live)onError(r.error);return;}
        if(!r.value||r.value.kind==='turning'&&!r.value.drawing)r=await window.academy.coordinateStart({kind:'turning',mode:'G90'});
        if(!live)return;if(r.ok){setAttempt(r.value);if(r.value)setMode(r.value.modes.every(m=>m===r.value!.modes[0])?r.value.modes[0]!:'mixed');}else onError(r.error);
      }catch{if(live)onError('Не удалось открыть чертёж.');}finally{if(live)setLoading(false);}
    })();
    return()=>{live=false;};
  },[]);
  useEffect(()=>{setValues({});first.current?.focus();},[attempt?.id,attempt?.index]);
  useEffect(()=>{if(loading)return;if(answered||done)submit.current?.focus();else first.current?.focus();},[loading,answered,done]);
  useEffect(()=>{
    const element=drawingScroll.current;if(!element)return;
    const keepVisible=()=>{const target=element.querySelector('.blueprint-target');if(!target)return;const p=target.getBoundingClientRect(),v=element.getBoundingClientRect();if(p.right>v.right-55)element.scrollLeft+=p.right-v.right+55;else if(p.left<v.left+55)element.scrollLeft-=v.left-p.left+55;};
    keepVisible();const observer=new ResizeObserver(keepVisible);observer.observe(element);return()=>observer.disconnect();
  },[attempt?.id,attempt?.index]);
  const start=(kind=attempt?.kind??'turning',nextMode=mode)=>{setSettings(false);void accept(window.academy.coordinateStart({kind,mode:nextMode}));};
  const enter=()=>{
    if(!attempt||loading)return;
    if(done){start();return;}
    if(answered){void accept(window.academy.coordinateNext(attempt.id));return;}
    void accept(window.academy.coordinateAnswer({id:attempt.id,values}));
  };
  if(!attempt)return <div className="coordinate-trainer"><p role="status">Готовим новый чертёж…</p></div>;
  const axes=coordinateAxes(attempt.kind),currentMode=attempt.modes[attempt.index],firstTry=attempt.answers.filter(a=>a.correct&&a.tries===1).length;
  return <div className="coordinate-trainer">
    <header className="coordinate-toolbar"><div><h1>{attempt.kind==='turning'?'G1 · Линейная интерполяция':'Координаты фрезерного контура'}</h1><p>{done?'Чертёж пройден':attempt.index===0?'Введите координаты начальной точки':`Введите координаты зелёной точки · ${currentMode==='G90'?'от нуля W':'приращение от предыдущей точки'}`}</p></div><div className="coordinate-toolbar-actions"><span className="coordinate-counter">{done?attempt.points.length:attempt.index+1} / {attempt.points.length}</span><button onClick={()=>start()} disabled={loading}>Другая деталь</button><button className="coordinate-settings-toggle" aria-label="Настройки тренировки" aria-expanded={settings} onClick={()=>setSettings(!settings)}>⚙</button></div>
      {settings&&<div className="coordinate-settings"><label>Координаты<select aria-label="Режим тренировки" value={mode} onChange={e=>{const next=e.target.value as Mode;setMode(next);start(attempt.kind,next);}}><option value="G90">G90 · от нуля</option><option value="G91">G91 · приращения</option><option value="mixed">G90 / G91 · смешанный</option></select></label><div className="button-row"><button onClick={()=>start('turning')}>Токарная деталь</button><button disabled={app.license.status!=='active'||!app.license.modules.includes('milling')} onClick={()=>start('milling')}>Фрезерный контур</button></div></div>}
    </header>
    <section className="coordinate-sheet" aria-label="Упражнение по чертежу">
      <div className="coordinate-drawing-scroll" ref={drawingScroll}><CoordinateDrawing attempt={attempt}/></div>
      <div className="coordinate-entry">
        {done?<div className="coordinate-completed"><h2>Деталь пройдена</h2><p>С первой попытки: <strong>{firstTry} из {attempt.points.length}</strong></p><button className="primary" ref={submit} disabled={loading} onClick={()=>start()}>Следующая деталь ↵</button></div>:<form onSubmit={event=>{event.preventDefault();enter();}}>
          <span className="coordinate-entry-title">{attempt.index===0?'Начальная точка':'Конечная точка'} <small>{currentMode}</small></span>
          <div className="coordinate-inputs">{axes.map((axis,i)=><label key={axis}><span>{axis.toUpperCase()}</span><input ref={i===0?first:second} aria-label={`Координата ${axis.toUpperCase()}`} autoComplete="off" inputMode="decimal" required={!answered} maxLength={32} disabled={answered||loading} value={values[axis]??answer?.values[axis]??''} onFocus={e=>e.currentTarget.select()} onChange={e=>setValues(v=>({...v,[axis]:e.target.value}))} onKeyDown={e=>{if(e.key==='Enter'&&i===0&&!answered){e.preventDefault();if(e.currentTarget.value.trim())second.current?.focus();else e.currentTarget.reportValidity();}}}/><small>{currentMode==='G91'?'приращение':'от нуля W'}</small></label>)}</div>
          <button className="primary" ref={submit} type="submit" disabled={loading}>{answered?'Следующая точка ↵':'Проверить ↵'}</button>
        </form>}
      </div>
      {answer&&!done&&<aside className={`coordinate-feedback ${answer.correct?'correct':'incorrect'}`} role="status"><strong>{answer.correct?'✓ Верно':'Пока неверно — попробуйте ещё раз'}</strong>{answer.correct?<p>Нажмите Enter, чтобы перейти к следующей точке.</p>:<details><summary>Показать расчёт</summary><p>{explainCoordinate(attempt)}</p></details>}</aside>}
    </section>
    {done&&<details className="coordinate-review"><summary>Разобрать ответы</summary>{attempt.answers.map((a,i)=><div key={i}><strong>Точка {i+1} · {attempt.modes[i]} · попыток: {a.tries}</strong><p>{explainCoordinate(attempt,i)}</p></div>)}</details>}
  </div>;
}
