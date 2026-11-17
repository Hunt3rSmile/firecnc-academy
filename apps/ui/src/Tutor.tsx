import {useEffect,useRef,useState} from 'react';
import type {TutorAsk,TutorStatus,TutorModel} from '@firecnc/contracts';

export function TutorSettings(){
  const [status,setStatus]=useState<TutorStatus|null>(null),[key,setKey]=useState(''),[model,setModel]=useState<TutorModel>('deepseek-flash'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{void window.academy.tutorStatus().then(r=>{if(r.ok){setStatus(r.value);setModel(r.value.model);}else setError(r.error);});},[]);
  const action=async(kind:'save'|'check'|'clear')=>{
    setBusy(true);setError('');
    try{
      const r=await (kind==='save'?window.academy.tutorConfigure({model,...(key.trim()?{apiKey:key.trim()}:{})}):kind==='check'?window.academy.tutorCheck():window.academy.tutorClear());
      if(r.ok){setStatus(r.value);if(kind!=='check')setKey('');}else setError(r.error);
    }catch{setError('Не удалось связаться с приложением.');}finally{setBusy(false);}
  };
  return <section className="card tutor-settings" aria-label="Настройки DeepSeek">
    <div className="section-title"><div><p className="eyebrow">ПОМОЩНИК ПО ЗАДАНИЯМ</p><h2>DeepSeek</h2></div><span className="pill">{status?.configured?'Ключ добавлен':'Не подключён'}</span></div>
    <p>Спросите, где ошибка в решении, за что отвечает команда и почему её используют. Помощник видит условие выбранного задания и введённое решение.</p>
    <div className="tutor-config-fields"><label className="field">API-ключ DeepSeek<input aria-label="API-ключ DeepSeek" type="password" value={key} autoComplete="off" spellCheck={false} maxLength={203} placeholder={status?.configured?'Ключ сохранён · введите новый для замены':'sk-…'} onChange={e=>setKey(e.target.value)}/></label>
    <label className="field">Модель DeepSeek<select aria-label="Модель DeepSeek" value={model} onChange={e=>setModel(e.target.value as TutorModel)}><option value="deepseek-flash">DeepSeek Flash</option><option value="deepseek-v4-pro">DeepSeek V4 Pro</option></select></label></div>
    <div className="button-row"><button className="primary" disabled={busy||!key.trim()&&!status?.configured} onClick={()=>void action('save')}>Сохранить DeepSeek</button><button disabled={busy||!status?.configured} onClick={()=>void action('check')}>Проверить подключение</button>{status?.configured&&<button disabled={busy} onClick={()=>void action('clear')}>Удалить ключ</button>}</div>
    {busy&&<p className="micro" role="status">Проверяем настройки…</p>}{error&&<p className="error-box" role="alert">{error}</p>}{status&&<p role="status" className="micro">{status.message}</p>}
    <p className="micro">Запросы отправляются в DeepSeek только при обращении к помощнику и оплачиваются с вашего API-счёта. Ключ DeepSeek настраивается отдельно от лицензии FireCNC.{status?.storage==='encrypted'?' Ключ защищён хранилищем ОС.':''}</p>
  </section>;
}

function Reply({text}:{text:string}){
  const parts=text.split(/```(?:[a-zA-Z0-9+-]*)\n?([\s\S]*?)```/g);
  return <>{parts.map((part,i)=>i%2?<pre key={i} className="tutor-code"><code>{part.trim()}</code></pre>:<div className="tutor-prose" key={i}>{part}</div>)}</>;
}

export function TutorPanel({taskId,source,diagnostic,onSettings}:{taskId?:string;source?:string;diagnostic?:string;onSettings?:()=>void}){
  const [status,setStatus]=useState<TutorStatus|null>(null),[messages,setMessages]=useState<TutorAsk['messages']>([]),[question,setQuestion]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const active=useRef(false),end=useRef<HTMLDivElement>(null);
  useEffect(()=>{void window.academy.tutorStatus().then(r=>{if(r.ok)setStatus(r.value);else setError(r.error);});return()=>{if(active.current)void window.academy.tutorCancel();active.current=false;};},[]);
  useEffect(()=>{end.current?.scrollIntoView({block:'nearest',behavior:'smooth'});},[messages,busy]);
  const send=async(text=question)=>{
    if(!text.trim()||active.current)return;
    const next=[...messages,{role:'user' as const,content:text.trim()}];
    setMessages(next);setQuestion('');setError('');setBusy(true);active.current=true;
    try{
      const history=next.slice(-11).map((m,i,all)=>({...m,content:m.content.slice(0,i===all.length-1?6000:1800)}));
      const r=await window.academy.tutorAsk({messages:history,...(taskId?{taskId}:{}),...(source?{source:source.slice(0,16000)}:{}),...(diagnostic?{diagnostic:diagnostic.slice(0,2000)}:{})});
      if(!active.current)return;
      if(r.ok)setMessages([...next,{role:'assistant',content:r.value.content}]);else setError(r.error);
    }catch{if(active.current)setError('Не удалось связаться с помощником. Решение осталось в задании.');}
    finally{active.current=false;setBusy(false);}
  };
  return <section className="card tutor-panel" aria-label="Помощник DeepSeek">
    <div className="section-title"><div><p className="eyebrow">РАЗБЕРЁМСЯ ВМЕСТЕ</p><h2>Спросить DeepSeek</h2></div><span className="pill">{status?.model==='deepseek-v4-pro'?'V4 Pro':'Flash'}</span></div>
    <p className="muted">Обсудите свой ход решения, ошибку или назначение команды.</p>
    {!status?.configured?<div className="learning-note"><p>Добавьте API-ключ DeepSeek в разделе «Настройки и лицензия».</p>{onSettings&&<button onClick={onSettings}>Настроить DeepSeek →</button>}</div>:<>
      {messages.length>0&&<div className="tutor-conversation" role="log" aria-label="Диалог с DeepSeek">{messages.map((m,i)=><article className={`tutor-message ${m.role}`} key={i}><strong>{m.role==='user'?'Вы':'DeepSeek'}</strong><Reply text={m.content}/></article>)}<div ref={end}/></div>}
      <div className="tutor-suggestions">{['Где ошибка в моём решении?','Объясни команды по строкам','Почему здесь именно так?'].map(text=><button key={text} disabled={busy} onClick={()=>void send(text)}>{text}</button>)}</div>
      <form onSubmit={e=>{e.preventDefault();void send();}}><label className="field">Ваш вопрос<textarea aria-label="Вопрос DeepSeek" value={question} rows={3} maxLength={6000} disabled={busy} placeholder="Например: что меняет G96 и почему Z с минусом?" onChange={e=>setQuestion(e.target.value)}/></label><div className="button-row"><button className="primary" disabled={busy||!question.trim()} type="submit">Отправить вопрос</button>{busy&&<button type="button" onClick={()=>void window.academy.tutorCancel()}>Остановить ответ</button>}{!busy&&messages.length>0&&<button type="button" onClick={()=>{setMessages([]);setError('');}}>Очистить диалог</button>}{busy&&<span className="micro" role="status">DeepSeek разбирает решение…</span>}</div></form>
    </>}
    {error&&<p className="error-box" role="alert">{error}</p>}<p className="micro">В сообщение войдут условие и текущее решение. Ответ помощника можно обсуждать; баллы выставляет локальная проверка.</p>
  </section>;
}
