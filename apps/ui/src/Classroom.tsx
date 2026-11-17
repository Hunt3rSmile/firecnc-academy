import {useEffect,useRef,useState} from 'react';
import type {ClassroomCatalog,ClassroomPhoto,ClassroomAttempt,ClassroomProgress,ClassroomCheck} from '@firecnc/learning';
import {TutorPanel} from './Tutor';

const photoURL=(p:ClassroomPhoto,thumb=false)=>`./classroom/photos/${p.file.replace('.jpg',thumb?'.thumb.webp':'.webp')}`;
function CheckRows({checks}:{checks:ClassroomCheck[]}){return <div className="classroom-checks">{checks.map((check,i)=><div className={check.passed?'passed':'failed'} key={i}><span>{check.passed?'✓':'×'}</span><div><strong>{check.label}{check.line?` · строка ${check.line}`:''}</strong><p>{check.explanation}</p></div></div>)}</div>;}

function PhotoViewer({photo,onClose}:{photo:ClassroomPhoto;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),[zoom,setZoom]=useState(100);
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  return <dialog ref={dialog} className="classroom-photo-dialog" aria-label={photo.title} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="photo-sheet"><header><div><p className="eyebrow">ФОТО С ЗАНЯТИЯ</p><h2>{photo.title}</h2></div><button onClick={onClose} aria-label="Закрыть фотографию">×</button></header>
    <div className="photo-tools"><button onClick={()=>setZoom(Math.max(75,zoom-25))} aria-label="Уменьшить фотографию" disabled={zoom===75}>−</button><span>{zoom}%</span><button onClick={()=>setZoom(Math.min(200,zoom+25))} aria-label="Увеличить фотографию" disabled={zoom===200}>+</button><span className="micro">{photo.file}</span></div>
    <div className="photo-scroll"><img src={photoURL(photo)} alt={photo.description} style={{width:`${zoom}%`}}/></div>
    <p>{photo.description}</p>{photo.uncertainties.length>0&&<div className="learning-note"><strong>Не всё читается уверенно</strong>{photo.uncertainties.map((text,i)=><p key={i}>{text}</p>)}</div>}
    {photo.transcription&&<details className="photo-transcription"><summary>Распознанный материал</summary><pre>{photo.transcription}</pre><p className="micro">Распознано Gemini 3.8 Flash High через agy. При сомнении сверяйте символы с фотографией.</p></details>}
    </div>
  </dialog>;
}

export function Classroom({onError,onSettings,onChanged,initialAttemptId}:{onError:(message:string)=>void;onSettings:()=>void;onChanged:()=>void;initialAttemptId:string|null}){
  const [catalog,setCatalog]=useState<ClassroomCatalog|null>(null),[progress,setProgress]=useState<ClassroomProgress>({drafts:{},attempts:[],completed:[]}),[taskId,setTaskId]=useState(''),[answer,setAnswer]=useState(''),[result,setResult]=useState<ClassroomAttempt|null>(null),[mode,setMode]=useState<'tasks'|'photos'>('tasks'),[photo,setPhoto]=useState<ClassroomPhoto|null>(null),[filter,setFilter]=useState(''),[busy,setBusy]=useState(false),[saving,setSaving]=useState(0),[saveError,setSaveError]=useState(false);
  const queue=useRef<Promise<void>>(Promise.resolve()),live=useRef(true);
  useEffect(()=>{
    live.current=true;
    void Promise.all([window.academy.classroomCatalog(),window.academy.classroomProgress()]).then(([c,p])=>{
      if(!live.current)return;
      if(!c.ok){onError(c.error);return;}setCatalog(c.value);
      if(!p.ok){onError(p.error);return;}setProgress(p.value);
      const review=p.value.attempts.find(a=>a.id===initialAttemptId),first=c.value.tasks.find(t=>t.id===review?.taskId)??c.value.tasks[0];if(first){setTaskId(first.id);setAnswer(review?.answer??p.value.drafts[first.id]??'');setResult(review??null);}
    }).catch(()=>onError('Не удалось открыть материалы занятия.'));
    return()=>{live.current=false;};
  },[]);
  const task=catalog?.tasks.find(t=>t.id===taskId);
  const write=(text:string)=>{
    if(!task)return;const id=task.id;
    setAnswer(text);setResult(null);setSaveError(false);setSaving(n=>n+1);
    setProgress(p=>({...p,drafts:{...p.drafts,[id]:text}}));
    queue.current=queue.current.catch(()=>{}).then(async()=>{const r=await window.academy.classroomDraft({taskId:id,answer:text});if(!r.ok)throw new Error(r.error);}).catch(error=>{if(live.current){setSaveError(true);onError(error instanceof Error?error.message:'Черновик не сохранён.');}throw error;}).finally(()=>{if(live.current)setSaving(n=>n-1);});
    void queue.current.catch(()=>{});
  };
  const select=async(id:string)=>{
    try{await queue.current;}catch{return;}
    setTaskId(id);setAnswer(progress.drafts[id]??'');setResult(null);setSaveError(false);
  };
  const submit=async()=>{
    if(!task||busy)return;setBusy(true);
    try{
      await queue.current;const r=await window.academy.classroomSubmit({taskId:task.id,answer});
      if(r.ok){setResult(r.value);setProgress(p=>({...p,attempts:[r.value,...p.attempts].slice(0,100),completed:r.value.passed?[...new Set([...p.completed,r.value.taskId])]:p.completed}));onChanged();}else onError(r.error);
    }catch(error){onError(error instanceof Error?error.message:'Проверка не выполнена.');}finally{setBusy(false);}
  };
  if(!catalog)return <p role="status">Открываем задания и фотографии…</p>;
  const passed=progress.completed.length;
  const photos=catalog.photos.filter(p=>`${p.title} ${p.description} ${p.group}`.toLowerCase().includes(filter.toLowerCase()));
  return <div className="classroom-page">
    <div className="page-heading"><div><p className="eyebrow">ВАШИ ЗАНЯТИЯ · ТОКАРНАЯ ОБРАБОТКА</p><h1>Решайте как на занятии</h1><p className="muted">Прочитайте условие, напишите расчёт или программу и разберите результат по шагам.</p></div></div>
    <div className="classroom-overview"><div><strong>{catalog.tasks.length}</strong><span>письменных заданий</span></div><div><strong>{catalog.photos.length}</strong><span>фотографий с занятий</span></div><div><strong>{passed} / {catalog.tasks.length}</strong><span>заданий выполнено</span></div><div><strong>Офлайн</strong><span>материалы и проверка</span></div></div>
    <div className="segmented classroom-tabs"><button aria-pressed={mode==='tasks'} onClick={()=>setMode('tasks')}>Практические задания</button><button aria-pressed={mode==='photos'} onClick={()=>setMode('photos')}>Материалы с занятий · {catalog.photos.length}</button></div>
    {mode==='photos'?<section className="classroom-gallery"><label className="field">Поиск по материалам<input aria-label="Поиск по фотографиям" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Чертёж, координаты, программа…"/></label><div className="classroom-photo-grid">{photos.map(p=><button className="classroom-photo-card" key={p.file} onClick={()=>setPhoto(p)} aria-label={`Открыть фото ${p.file}`}><img src={photoURL(p,true)} alt={p.title} loading="lazy"/><div><small>{p.group}</small><h3>{p.title}</h3><p>{p.description}</p>{p.confidence!=='high'&&<span className="micro">Есть неразборчивые участки</span>}</div></button>)}</div>{!photos.length&&<p className="muted">По этому запросу фотографий нет.</p>}</section>:task?<div className="classroom-layout">
      <aside className="classroom-task-list" aria-label="Задания по занятиям">{catalog.tasks.map((t,i)=><button key={t.id} aria-current={taskId===t.id?'step':undefined} disabled={busy} onClick={()=>void select(t.id)}><span className="classroom-task-number">{String(i+1).padStart(2,'0')}</span><div><small>{t.topic}</small><strong>{t.title}</strong><span>{progress.completed.includes(t.id)?'✓ Выполнено':progress.drafts[t.id]?'Есть черновик':`${t.minutes} мин · ${t.type==='program'?'программа':'расчёт'}`}</span></div></button>)}</aside>
      <div className="classroom-work" key={task.id}>
        <section className="card classroom-condition"><p className="eyebrow">{task.topic} · {task.minutes} МИН</p><h2>{task.title}</h2><p className="classroom-prompt">{task.prompt}</p><details className="classroom-theory"><summary>Разобраться в теме</summary>{task.theory.map((p,i)=><p key={i}>{p}</p>)}</details>
          <div className="classroom-source-photos">{task.photoFiles.map(file=>catalog.photos.find(p=>p.file===file)).filter((p):p is ClassroomPhoto=>!!p).map(p=><button key={p.file} onClick={()=>setPhoto(p)} aria-label={`Открыть фото ${p.file}`}><img src={photoURL(p,true)} alt={p.title} loading="lazy"/><span>Посмотреть источник ↗</span></button>)}</div><p className="micro classroom-source-note">{task.sourceNote}</p>
        </section>
        <section className="card classroom-solution"><div className="section-title"><h2>Ваше решение</h2><span className="micro" role="status">{saving?'Сохраняем черновик…':saveError?'Черновик не сохранён':'Черновик сохранён'}</span></div>
          {task.fields.length>0&&<p className="micro">Запишите {task.fields.map(f=>`${f.name} (${f.label}, ${f.unit})`).join('; ')}. Каждый ответ — отдельной строкой: имя=число. Можно использовать десятичную запятую.</p>}
          {task.type==='program'&&<p className="micro">Профиль PAL, как в KELLER SYMplus на ваших фото. Проверяются команды и координаты фрагмента. Материал и столкновения здесь не моделируются; симулятор FireCNC DIN использует другой профиль.</p>}
          <label className="field">{task.type==='program'?'Программа':'Расчёт и ответы'}<textarea className="classroom-answer" aria-label="Решение задания" value={answer} onChange={e=>write(e.target.value)} maxLength={16000} rows={task.type==='program'?9:6} spellCheck={false} autoComplete="off" disabled={busy} placeholder={task.starter}/></label>
          <div className="button-row"><button className="primary" disabled={busy||saving>0||!answer.trim()||saveError} onClick={()=>void submit()}>{busy?'Проверяем…':'Проверить решение'}</button><button disabled={busy||!answer} onClick={()=>write('')}>Очистить черновик</button><span className="micro">Проверка работает без интернета</span></div>
        </section>
        {result&&<section className={`card classroom-result ${result.passed?'passed':''}`} aria-label="Разбор решения"><div className="section-title"><div><p className="eyebrow">РЕЗУЛЬТАТ ПРОВЕРКИ</p><h2>{result.passed?'Задание выполнено':'Есть что исправить'}</h2></div><strong className="classroom-score">{result.score}/100</strong></div>{result.passed?<p className="success-text">Все критерии выполнены. Обсудите ход решения с помощником или переходите к следующему заданию.</p>:<CheckRows checks={result.checks.filter(c=>!c.passed)}/>}<details className="classroom-passed-checks"><summary>Выполненные критерии · {result.checks.filter(c=>c.passed).length} из {result.checks.length}</summary><CheckRows checks={result.checks.filter(c=>c.passed)}/></details><details><summary>Разбор и пример решения</summary><pre className="exam-code">{result.reference}</pre><p>{result.explanation}</p></details></section>}
        <TutorPanel key={task.id} taskId={task.id} source={answer} diagnostic={result?result.checks.map(c=>`${c.passed?'✓':'×'} ${c.label}: ${c.explanation}`).join('\n'):undefined} onSettings={onSettings}/>
        {progress.attempts.some(a=>a.taskId===task.id)&&<details className="card classroom-history"><summary>Мои попытки по этому заданию</summary>{progress.attempts.filter(a=>a.taskId===task.id).slice(0,10).map(a=><div className="attempt-row" key={a.id}><span>{new Date(a.createdAt).toLocaleString('ru-RU')}</span><strong>{a.score}/100</strong><button onClick={()=>{setAnswer(a.answer);setResult(a);}}>Разбор попытки</button></div>)}</details>}
      </div>
    </div>:<p>Материалы занятия готовятся.</p>}
    {photo&&<PhotoViewer key={photo.file} photo={photo} onClose={()=>setPhoto(null)}/>}
  </div>;
}

export function ClassroomHistory({onReview}:{onReview:(id:string)=>void}){
  const [catalog,setCatalog]=useState<ClassroomCatalog|null>(null),[progress,setProgress]=useState<ClassroomProgress|null>(null);
  useEffect(()=>{let live=true;void Promise.all([window.academy.classroomCatalog(),window.academy.classroomProgress()]).then(([c,p])=>{if(!live)return;if(c.ok)setCatalog(c.value);if(p.ok)setProgress(p.value);});return()=>{live=false;};},[]);
  return <section className="card classroom-progress-history"><h2>Письменные задания</h2>{progress?.attempts.length?progress.attempts.map(a=><div className="attempt-row" key={a.id}><span>{catalog?.tasks.find(t=>t.id===a.taskId)?.title??a.taskId}<small className="micro"> · {new Date(a.createdAt).toLocaleString('ru-RU')}</small></span><strong>{a.score} / 100</strong><button onClick={()=>onReview(a.id)}>Разбор</button></div>):<p className="muted">Решите первое задание по материалам занятия — здесь появятся ваши попытки.</p>}</section>;
}
