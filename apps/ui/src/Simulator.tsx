import {useEffect,useRef,useState} from 'react';
import {DEMO_SOURCES,type AppState,type CNCProject,type ComputeResponse} from '@firecnc/contracts';
import type {Program,MachineKind} from '@firecnc/core';
import {diameterAt,depthAt,frontFace,type SimulationResult} from '@firecnc/simulation';
import {exercises,assess} from '@firecnc/learning';
import ComputeWorker from './compute.worker?worker';
import {CodeEditor} from './CodeEditor';
import {Projection} from './Projection';
import {Scene3D} from './Scene3D';
export function Simulator({app,onError,onSaved,onDirty}:{app:AppState;onError:(s:string)=>void;onSaved:()=>void;onDirty:(dirty:boolean)=>void}) {
  const make=(kind:MachineKind):CNCProject=>({version:1,name:kind==='turning'?'Учебный вал':'Учебный паз',kind,source:DEMO_SOURCES[kind],offset:{x:0,y:0,z:0},resolution:.25});
  const [project,setProject]=useState<CNCProject>(app.project??make('turning')),[program,setProgram]=useState<Program|null>(null),[result,setResult]=useState<SimulationResult|null>(null),[view,setView]=useState<'2d'|'3d'>('3d'),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1),[tab,setTab]=useState<'view'|'editor'>('view'),[exerciseId,setExerciseId]=useState(''),[measurement,setMeasurement]=useState('');
  const [split,setSplit]=useState(app.settings.split),[dirty,setDirty]=useState(false);
  const worker=useRef<Worker|null>(null),cancelResolve=useRef<(()=>void)|null>(null),playingRef=useRef(false),revision=useRef(0),speedRef=useRef(speed),projectRef=useRef(project);
  speedRef.current=speed;projectRef.current=project;
  const cancel=()=>{revision.current++;playingRef.current=false;setPlaying(false);worker.current?.terminate();worker.current=null;cancelResolve.current?.();cancelResolve.current=null;setBusy(false);};
  const edit=(next:CNCProject)=>{cancel();setProject(next);setResult(null);setProgram(null);setMeasurement('');setDirty(true);};
  useEffect(()=>{onDirty(dirty);const prevent=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',prevent);return ()=>window.removeEventListener('beforeunload',prevent);},[dirty]);
  useEffect(()=>()=>{playingRef.current=false;worker.current?.terminate();cancelResolve.current?.();},[]);
  const compute=async(frame:number|null):Promise<{program:Program;simulation:SimulationResult}|null>=>{
    const generation=revision.current,p=projectRef.current;
    const access=await window.academy.authorizeSimulation(p);
    if(!access.ok){onError(access.error);return null;}if(generation!==revision.current)return null;
    worker.current?.terminate();cancelResolve.current?.();
    setBusy(true);setProgress(0);
    return new Promise(resolve=>{
      const w=new ComputeWorker();worker.current=w;const id=generation;
      const finish=()=>{w.terminate();if(worker.current===w)worker.current=null;cancelResolve.current=null;setBusy(false);};
      cancelResolve.current=()=>{clearTimeout(timeout);w.terminate();resolve(null);};
      const timeout=setTimeout(()=>{finish();onError('Расчёт превысил 30 секунд. Увеличьте шаг сетки или сократите программу.');resolve(null);},30000);
      w.onmessage=(event:MessageEvent<ComputeResponse>)=>{
        if(event.data.id!==id||generation!==revision.current)return;
        if(event.data.type==='progress'){setProgress(event.data.progress);return;}
        clearTimeout(timeout);finish();
        if(event.data.type==='error'){onError(event.data.message);resolve(null);return;}
        setProgram(event.data.program);setResult(event.data.simulation);resolve({program:event.data.program,simulation:event.data.simulation});
      };
      w.onerror=()=>{clearTimeout(timeout);finish();onError('Worker не смог завершить расчёт.');resolve(null);};
      w.postMessage({id,project:p,frame});
    });
  };
  const replay=async()=>{
    playingRef.current=true;setPlaying(true);let frame=result?.completed??0;
    if(!program||frame>=program.events.length||result?.collision)frame=0;
    while(playingRef.current) {
      const next=await compute(frame+1);if(!next)break;frame=next.simulation.completed;
      if(next.simulation.collision||frame>=next.program.events.length||next.program.events[frame-1]?.stop==='pause')break;
      await new Promise(resolve=>setTimeout(resolve,800/speedRef.current));
    }
    playingRef.current=false;setPlaying(false);
  };
  const save=async()=>{const r=await window.academy.projectSave(projectRef.current);if(!r.ok)onError(r.error);else{setDirty(false);onSaved();}};
  const action=async<T,>(promise:Promise<{ok:true;value:T}|{ok:false;error:string}>,then?:(v:T)=>void)=>{const r=await promise;if(r.ok)then?.(r.value);else onError(r.error);};
  const load=(kind:MachineKind)=>{if(dirty&&!confirm('Заменить несохранённые изменения учебным примером?'))return;setExerciseId('');edit(make(kind));setDirty(false);};
  const selected=exercises.find(e=>e.id===exerciseId),assessment=selected&&result?assess(selected,result,{completed:!program?.error&&result.completed===program?.events.length}):null;
  const line=result?.collision?.line??(result?.completed?program?.events[result.completed-1]?.line??0:0);
  const isComplete=!!result&&!result.collision&&!program?.error&&result.completed===(program?.events.length??0);
  const moveDivider=(event:React.PointerEvent<HTMLDivElement>)=>{
    const parent=event.currentTarget.parentElement!,rect=parent.getBoundingClientRect();event.currentTarget.setPointerCapture(event.pointerId);
    const update=(e:PointerEvent)=>setSplit(Math.max(30,Math.min(75,(e.clientX-rect.left)/rect.width*100)));
    const end=()=>{document.removeEventListener('pointermove',update);document.removeEventListener('pointerup',end);};document.addEventListener('pointermove',update);document.addEventListener('pointerup',end,{once:true});
  };
  return <div className="simulator">
    <div className="page-heading"><div><p className="eyebrow">ВИРТУАЛЬНАЯ ОБРАБОТКА</p><h1>Редактор и симулятор</h1><p className="muted">Учебный DIN/ISO · материал рассчитывается независимо от визуализации</p></div><div className="segmented"><button aria-pressed={project.kind==='turning'} onClick={()=>load('turning')}>Точение</button><button aria-pressed={project.kind==='milling'} onClick={()=>load('milling')}>Фрезерование</button></div></div>
    <div className="sim-toolbar"><button className="primary" disabled={busy||playing} onClick={()=>void compute(null)}>▷ Рассчитать</button><button disabled={busy||playing} onClick={()=>void replay()}>▶ Воспроизвести</button><button disabled={!busy&&!playing} onClick={cancel}>Ⅱ Пауза / отмена</button><button disabled={busy||playing} onClick={()=>void compute(0)}>↺ Сброс</button><button disabled={busy||playing} onClick={()=>void compute((result?.completed??0)+1)}>Кадр →</button><label>Скорость <select aria-label="Скорость воспроизведения" value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[.5,1,2,4].map(s=><option key={s} value={s}>{s}×</option>)}</select></label><span className="toolbar-status">{busy?`Расчёт ${Math.round(progress*100)}%`:result?.collision?'Остановлено':isComplete?'Расчёт завершён':dirty?'Изменения: нужен пересчёт':'Готов к запуску'}</span></div>
    <div className="workspace">
      <aside className="project-panel"><span className="small-heading">ПРОЕКТ</span><input aria-label="Название проекта" value={project.name} maxLength={100} onChange={e=>edit({...project,name:e.target.value})}/><div className="tree-item">◇ {project.kind==='turning'?'Вал · Ø40 × 60':'Плита · 60 × 40 × 15'}</div><div className="tree-item">⌖ G54 · рабочий ноль</div><div className="offsets">{(['x','y','z'] as const).map(axis=><label key={axis}>{axis.toUpperCase()}<input aria-label={`Смещение G54 ${axis.toUpperCase()}`} type="number" min="-1000" max="1000" step=".5" value={project.offset[axis]} onChange={e=>edit({...project,offset:{...project.offset,[axis]:Number(e.target.value)}})}/></label>)}</div><p className="micro">Смещения в физических мм. X при точении — радиальное смещение.</p>
      <div className="tree-item">⌑ {project.kind==='turning'?'Патрон · зажим 15 мм':'Тиски · верх губок Z−5'}</div><div className="tree-item">↳ {project.kind==='turning'?'1: резец 2 мм · 2: канавка 3 мм':'1: фреза Ø10 · 2: фреза Ø6'}</div>
      <label className="field">Сетка материала<select aria-label="Шаг сетки" value={project.resolution} onChange={e=>edit({...project,resolution:Number(e.target.value)})}>{[.25,.5,1].map(s=><option key={s} value={s}>{s} мм</option>)}</select></label>
      <button onClick={()=>void save()}>Сохранить проект{dirty?' *':''}</button><button onClick={()=>void action(window.academy.projectImport(),p=>{if(p&&(!dirty||confirm('Заменить несохранённый проект?')))edit(p);})}>Импорт проекта…</button><button onClick={()=>void action(window.academy.projectExport(project))}>Экспорт проекта…</button>
      <hr/><label className="field">Практическое задание<select aria-label="Практическое задание" value={exerciseId} onChange={e=>setExerciseId(e.target.value)}><option value="">Свободная работа</option>{exercises.filter(e=>e.kind===project.kind).map(e=><option key={e.id} value={e.id}>{e.title}</option>)}</select></label>
      {selected&&<><p className="micro">{selected.goal}</p><button onClick={()=>edit({...project,source:selected.source,offset:{x:0,y:0,z:0}})}>Загрузить пример решения</button></>}
      </aside>
      <div className="work-area"><div className="mobile-tabs"><button onClick={()=>setTab('view')} aria-pressed={tab==='view'}>Модель</button><button onClick={()=>setTab('editor')} aria-pressed={tab==='editor'}>Программа</button></div>
        <div className="editor-split" style={{gridTemplateColumns:`minmax(0,${split}fr) 8px minmax(0,${100-split}fr)`}}>
          <section className={`viewport-panel ${tab!=='view'?'mobile-hidden':''}`}><div className="panel-header"><span>ЗАГОТОВКА · {view==='3d'?'ПЕРСПЕКТИВА':'ПРОЕКЦИЯ'}</span><div className="segmented compact"><button aria-pressed={view==='3d'} onClick={()=>setView('3d')}>3D</button><button aria-pressed={view==='2d'} onClick={()=>setView('2d')}>2D</button></div></div>{view==='3d'?<Scene3D kind={project.kind} result={result} program={program} offset={project.offset}/>:<Projection result={result} program={program} offset={project.offset}/>}<div className="legend"><i className="gold"/> Материал <i className="mint"/> Рабочий ход <i className="orange"/> Быстрый ход</div></section>
          <div className="split-handle" role="separator" aria-label="Изменение ширины панелей" tabIndex={0} onPointerDown={moveDivider} onKeyDown={e=>{if(e.key==='ArrowLeft')setSplit(Math.max(30,split-2));if(e.key==='ArrowRight')setSplit(Math.min(75,split+2));}}/>
          <section className={`editor-panel ${tab!=='editor'?'mobile-hidden':''}`}><div className="panel-header"><span>ПРОГРАММА · UTF-8</span><div><button onClick={()=>void action(window.academy.programOpen(),s=>{if(s!==null&&(!dirty||confirm('Заменить несохранённый текст?')))edit({...project,source:s});})}>Открыть…</button><button onClick={()=>void action(window.academy.programSave(project.source))}>Файл…</button></div></div><CodeEditor value={project.source} onChange={source=>edit({...projectRef.current,source})} line={line} error={program?.error??null} theme={app.settings.theme} onSave={()=>void save()}/></section>
        </div>
        <div className="machine-state">{(['x','y','z'] as const).filter(a=>project.kind==='milling'||a!=='y').map(axis=><div key={axis}><span>{axis.toUpperCase()} {project.kind==='turning'&&axis==='x'?'Ø':''}</span><strong>{(((result?.state.position[axis]??0)-project.offset[axis])*(project.kind==='turning'&&axis==='x'?2:1)).toFixed(3)}</strong><small>мм · рабочая</small></div>)}<div><span>РЕЖИМ</span><strong>{result?.state.absolute===false?'G91':'G90'} · G{result?.state.motion??0}</strong><small>{project.kind==='turning'?'G18':'G17'} · G54</small></div><div><span>ИНСТРУМЕНТ</span><strong>{result?.state.tool??'—'}</strong><small>{result?.state.spindle==='off'?'Шпиндель выкл.':`${result?.state.rpm??0} об/мин`}</small></div><div><span>ПОДАЧА</span><strong>{result?.state.feed??0}</strong><small>мм/мин</small></div></div>
        <section className="event-log"><div className="panel-header"><span>ЖУРНАЛ И РАЗБОР</span><span>{result?`${result.completed} / ${program?.events.length??0} кадров`: 'Ожидание расчёта'}</span></div>
          {program?.error&&<div className="error-box"><strong>Строка {program.error.line}: {program.error.message}</strong><p>{program.error.fix}</p><details><summary>Технические сведения</summary>{program.error.code}, столбец {program.error.column}</details></div>}
          {result?.collision&&<div className="error-box"><strong>Строка {result.collision.line}: {result.collision.message}</strong><p>{result.collision.fix}</p><p className="micro">Аварийный кадр отменён целиком. Материал и станок восстановлены на его начало.</p><details><summary>Технические сведения</summary>{result.collision.code} · {result.collision.objects.join(' / ')}</details></div>}
          {!program?.error&&!result?.collision&&<p className="log-line">{isComplete?`✓ Программа выполнена. Удалено ${result.removedVolume.toFixed(1)} мм³ материала.`:result?`Выполнено кадров: ${result.completed}. Для продолжения используйте «Кадр» или воспроизведение.`:'Загрузите пример или напишите программу. Неизвестные команды останавливают разбор.'}</p>}
          {result&&<div className="timeline"><label>Выполненные кадры <input aria-label="Переход к кадру" type="range" min="0" max={program?.events.length??0} value={result.completed} disabled={busy||playing} onChange={e=>void compute(Number(e.target.value))}/></label><p className="micro">Переход пересчитывает материал с начала; данные будущих кадров не сохраняются.</p></div>}
        </section>
      </div>
    </div>
    <div className="sim-bottom"><section className="card"><h3>Измерение результата</h3><p className="micro">{project.kind==='turning'?'Диаметр на Z−15; координата нового торца.':'Глубина в точке X30 Y20.'} Погрешность модели показывается вместе с результатом.</p><button disabled={!result} onClick={()=>{if(!result)return;const m=result.material;setMeasurement(m.kind==='turning'?`Ø на Z−15: ${diameterAt(m,-15)?.toFixed(2)} мм; торец Z${frontFace(m)?.toFixed(2)} мм. Предел для диаметра ±${(2*result.uncertainty).toFixed(2)} мм.`:`Глубина: ${depthAt(m,30,20)?.toFixed(2)} мм. Консервативная погрешность границ ±${result.uncertainty.toFixed(2)} мм.`);}}>Измерить</button>{measurement&&<p className="success-text">{measurement}</p>}</section><section className="card"><h3>{selected?'Критерии задания':'Границы модели'}</h3>{assessment?<><p>Оценка: {assessment.score}/100 · {assessment.passed?'Критерии выполнены':'Требуется исправление'}</p><p className="micro">70% — размеры, 30% — безопасность; авария означает 0 баллов. Оцениваются перечисленные контрольные сечения.</p>{assessment.checks.map(c=><p className="micro" key={c.name}>{c.passed?'✓':'×'} {c.name}: {c.value?.toFixed(2)??'нет'}; цель {c.expected} ±{c.tolerance.toFixed(2)} мм</p>)}</>:<p className="micro">{project.kind==='turning'?'Осесимметричная сетка r/Z, прямоугольная режущая часть, нулевой радиус вершины. Без растачивания и резьбы.':'2.5D: поле высот, плоская концевая фреза, обработка сверху. Внутренние углы ограничены радиусом фрезы.'} Динамика и силы не моделируются. Программа предназначена для обучения.</p>}</section></div>
    <div className="layout-actions"><button onClick={()=>{setSplit(55);void window.academy.settings({...app.settings,split:55});}}>Стандартная раскладка</button><button onClick={()=>void action(window.academy.settings({...app.settings,split}))}>Сохранить раскладку</button></div>
  </div>;
}
