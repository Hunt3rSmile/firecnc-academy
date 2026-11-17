import {z} from 'zod';
import {assessPAL,palProgramSchema} from './pal-written';
import tasksData from '../../../content/classroom-tasks.json' with {type:'json'};
import photosData from '../../../content/classroom-photos.json' with {type:'json'};
import {decimalAnswer} from './numbers';

const field=z.strictObject({name:z.string().min(1),label:z.string(),value:z.number().finite(),tolerance:z.number().nonnegative(),unit:z.string(),explanation:z.string()});
export const classroomTaskSchema=z.strictObject({
  id:z.string().regex(/^[a-z0-9-]+$/),title:z.string().min(5),topic:z.string(),minutes:z.number().positive(),
  prompt:z.string().min(30),theory:z.array(z.string()).min(1),starter:z.string(),photoFiles:z.array(z.string()).min(1),
  sourceNote:z.string(),solution:z.string(),explanation:z.string(),
  assessment:z.discriminatedUnion('type',[
    z.strictObject({type:z.literal('numbers'),fields:z.array(field).min(1)}),
    palProgramSchema
  ])
});
export const classroomPhotoSchema=z.strictObject({file:z.string().regex(/^IMG_[0-9_]+\.jpg$/),title:z.string(),description:z.string(),transcription:z.string(),confidence:z.enum(['high','medium','low']),uncertainties:z.array(z.string()),group:z.string()});
export const classroomTasks=z.array(classroomTaskSchema).parse(tasksData);
export const classroomPhotos=z.array(classroomPhotoSchema).parse(photosData);
export type ClassroomTask=z.infer<typeof classroomTaskSchema>;
export type ClassroomPhoto=z.infer<typeof classroomPhotoSchema>;
export type ClassroomTaskView=Omit<ClassroomTask,'assessment'|'solution'|'explanation'>&{type:'numbers'|'program';fields:{name:string;label:string;unit:string}[]};
export interface ClassroomCheck {label:string;passed:boolean;explanation:string;line?:number}
export interface ClassroomAttempt {id:string;taskId:string;createdAt:number;answer:string;score:number;passed:boolean;checks:ClassroomCheck[];reference:string;explanation:string}
export interface ClassroomProgress {drafts:Record<string,string>;attempts:ClassroomAttempt[];completed:string[]}
export interface ClassroomCatalog {tasks:ClassroomTaskView[];photos:ClassroomPhoto[]}
export const classroomProgressSchema=z.strictObject({
  drafts:z.record(z.string().max(100),z.string().max(16000)).refine(v=>Object.keys(v).length<=100),
  completed:z.array(z.string().max(100)).max(100).default([]),
  attempts:z.array(z.strictObject({id:z.string().uuid(),taskId:z.string().max(100),createdAt:z.number().nonnegative(),answer:z.string().max(16000),score:z.number().min(0).max(100),passed:z.boolean(),checks:z.array(z.strictObject({label:z.string().max(300),passed:z.boolean(),explanation:z.string().max(2000),line:z.number().int().positive().optional()})).max(300),reference:z.string().max(16000),explanation:z.string().max(6000)})).max(100)
});

export function classroomCatalog():ClassroomCatalog {
  return {tasks:classroomTasks.map(task=>{
    const {assessment,solution:_s,explanation:_e,...view}=task;
    return {...view,type:assessment.type==='numbers'?'numbers' as const:'program' as const,fields:assessment.type==='numbers'?assessment.fields.map(({name,label,unit})=>({name,label,unit})):[]};
  }),photos:classroomPhotos};
}
const near=(a:number,b:number,tolerance=.001)=>Math.abs(a-b)<=tolerance+1e-9;
function fieldValue(answer:string,name:string,single:boolean):number|null{
  const text=answer.replace(/[Хх]/g,'X').replace(/[−–]/g,'-');
  if(single){const direct=decimalAnswer(text.trim());if(direct!==null)return direct;}
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const values=[...text.matchAll(new RegExp(`(?:^|[\\n;])\\s*${escaped}\\s*[:=]\\s*([+-]?\\d+(?:[.,]\\d+)?)(?=\\s|$|;)`,'gi'))];
  return values.length===1?decimalAnswer(values[0]![1]!):null;
}
export function assessClassroom(task:ClassroomTask,answer:string):Omit<ClassroomAttempt,'id'|'createdAt'>{
  if(answer.length>16000)throw new Error('Решение превышает 16 000 символов.');
  const checks:ClassroomCheck[]=[];
  const a=task.assessment;
  if(a.type==='numbers'){
    for(const f of a.fields){
      const actual=fieldValue(answer,f.name,a.fields.length===1),passed=actual!==null&&near(actual,f.value,f.tolerance);
      checks.push({label:f.label,passed,explanation:actual===null?`Введите ${f.name}=число отдельной строкой. ${f.explanation}`:`${actual} ${f.unit}; требуется ${f.value} ${f.unit} ±${f.tolerance}. ${f.explanation}`});
    }
  }else{
    checks.push(...assessPAL(answer,a));
  }
  const score=Math.round(checks.filter(c=>c.passed).length/checks.length*100);
  return {taskId:task.id,answer,score,passed:checks.every(c=>c.passed),checks,reference:task.solution,explanation:task.explanation};
}
export function classroomContext(taskId:string,answer:string):string{
  const task=classroomTasks.find(t=>t.id===taskId);if(!task)throw new Error('Учебное задание не найдено.');
  const grade=answer.trim()?assessClassroom(task,answer):null;
  return `Задание: ${task.title}\n${task.prompt}\nМатериал занятия: ${task.theory.join('\n')}\nИсточник: ${task.sourceNote}\nПояснение преподавателя: ${task.explanation}\n${grade?'Независимая локальная проверка: '+grade.checks.map(c=>`${c.passed?'Выполнено':'Не выполнено'}: ${c.label}. ${c.explanation}`).join('\n'):'Ученик пока не ввёл решение.'}`;
}
