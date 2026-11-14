import type {ExamQuestionView,ExamAnswer} from '@firecnc/learning';
import {MachineScheme} from './MachineScheme';
import {InstrumentScale} from './InstrumentScale';
export function ExamQuestionInput({question:q,value,onChange,disabled}:{question:ExamQuestionView;value:ExamAnswer|undefined;onChange:(a:ExamAnswer)=>void;disabled:boolean}) {
  if(q.type==='single'||q.type==='multiple')return <div className="exam-choices">{q.type==='multiple'&&<p className="micro">Нужен полный правильный набор без лишних вариантов. Частичных баллов нет.</p>}{q.options.map(o=><label className="answer" key={o.id}><input type={q.type==='single'?'radio':'checkbox'} name={q.id} checked={q.type==='single'?value===o.id:Array.isArray(value)&&value.includes(o.id)} disabled={disabled} onChange={e=>{if(q.type==='single')onChange(o.id);else{const previous=Array.isArray(value)?value:[];onChange(e.target.checked?[...previous,o.id]:previous.filter(id=>id!==o.id));}}}/><span>{o.text}</span></label>)}</div>;
  if(q.type==='order'){
    const order=Array.isArray(value)?value:q.options.map(o=>o.id);
    const move=(i:number,delta:number)=>{const next=order.slice(),j=i+delta;if(j<0||j>=next.length)return;[next[i],next[j]]=[next[j]!,next[i]!];onChange(next);};
    return <div className="exam-order"><p className="micro">Перемещайте шаги стрелками. Если порядок уже верен, подтвердите его.</p><ol>{order.map((id,i)=><li key={id}><span>{q.options.find(o=>o.id===id)!.text}</span><button disabled={disabled||i===0} aria-label={`Поднять шаг ${i+1}`} onClick={()=>move(i,-1)}>↑</button><button disabled={disabled||i===order.length-1} aria-label={`Опустить шаг ${i+1}`} onClick={()=>move(i,1)}>↓</button></li>)}</ol><button disabled={disabled} onClick={()=>onChange(order)}>Подтвердить порядок</button></div>;
  }
  if(q.type==='node')return <MachineScheme kind={q.diagram} selected={typeof value==='string'?value:''} onSelect={onChange} disabled={disabled}/>;
  return <>
    {(q.type==='program-result'||q.type==='program-error')&&<pre className="exam-code">{q.program.split('\n').map((line,i)=><span key={i}><i>{i+1}</i>{line}{'\n'}</span>)}</pre>}
    {q.type==='measurement'&&<InstrumentScale kind={q.instrument} ticks={q.ticks}/>}
    <label className="field exam-number">{q.type==='program-error'?'Номер строки':`Ответ, ${q.type==='measurement'?'мм':q.unit}`}<input aria-label="Ответ на вопрос" inputMode="decimal" maxLength={256} autoComplete="off" disabled={disabled} value={typeof value==='string'?value:''} onChange={e=>onChange(e.target.value)}/></label>
  </>;
}
