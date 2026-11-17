import {z} from 'zod';
import lessonsData from '../../../content/lessons.json' with {type:'json'};
import questionsData from '../../../content/questions.json' with {type:'json'};
import {exercises} from './exercises';
import {examBank} from './exams';
const lessonSchema=z.strictObject({id:z.string().min(1),version:z.number().int().positive(),course:z.enum(['turning','milling']),title:z.string().min(5),minutes:z.number().positive(),objective:z.string().min(20),diagram:z.enum(['turning','milling','feed','modal','arc']),body:z.array(z.string().min(60)).min(2),mistake:z.string().min(30),exercise:z.string().min(15),solution:z.string().min(20),questions:z.array(z.string()).min(1),sources:z.array(z.string()).min(1)});
export const questionSchema=z.strictObject({id:z.string().min(1),version:z.number().int().positive(),lessonId:z.string(),prompt:z.string().min(15),options:z.array(z.string().min(1)).min(2).max(8),correct:z.array(z.number().int().nonnegative()).min(1),explanation:z.string().min(30),mistake:z.string().min(20)}).refine(q=>new Set(q.correct).size===q.correct.length&&q.correct.every(i=>i<q.options.length));
export const lessons=z.array(lessonSchema).parse(lessonsData);
export const questions=z.array(questionSchema).parse(questionsData);
export type Lesson=typeof lessons[number];
export type Question=typeof questions[number];
export function validateContent():void {
  const ids=new Set<string>();for(const item of [...lessons,...examBank]){if(ids.has(item.id))throw new Error('Повтор ID: '+item.id);ids.add(item.id);}
  for(const lesson of lessons)for(const id of lesson.questions)if(!examBank.some(q=>q.id===id&&q.lessonId===lesson.id))throw new Error('Потерян вопрос: '+id);
  for(const question of examBank)if(!lessons.some(l=>l.id===question.lessonId))throw new Error('Потерян урок: '+question.lessonId);
  for(const exercise of exercises)if(!lessons.some(l=>l.id===exercise.lesson&&l.course===exercise.kind))throw new Error('Потеряна тема упражнения: '+exercise.id);
  const sourceIds=new Set(['linuxcnc-gcode','linuxcnc-overview','linuxcnc-lathe','firecnc-profile','mitutoyo-reading','sandvik-turning','sandvik-milling']);
  for(const lesson of lessons)for(const id of lesson.sources)if(!sourceIds.has(id))throw new Error('Неизвестный источник: '+id);
}
validateContent();
export const introQuestions=questions.filter(q=>['t-x-radius','t-z-face','t-feed-time','m-slot-width','m-increment','m-conflict'].includes(q.id));
export interface GradedAnswer {question:Question;selected:string[];correct:boolean}
export function grade(answers:Record<string,string[]>,bank:Question[]=introQuestions):{score:number;total:number;details:GradedAnswer[]} {
  const details=bank.map(question=>{const selected=answers[question.id]??[];return {question,selected,correct:selected.length===question.correct.length&&new Set(selected).size===selected.length&&question.correct.every(i=>selected.includes(String(i)))};});
  return {score:details.filter(d=>d.correct).length,total:details.length,details};
}
export {decimalAnswer} from './numbers';
export * from './coordinates';

export {exercises,assess,exerciseSchema,type Exercise} from './exercises';
export * from './measurements';
export * from './exams';
export * from './teaching';
export * from './workshop';
export * from './classroom';
