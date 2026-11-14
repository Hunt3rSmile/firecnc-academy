import {z} from 'zod';
import {examQuestionSchema,examDefinitionSchema,validateExamBank,examBank,type ExamQuestion,type ExamDefinition} from './exams';
import {exerciseSchema,exercises,type Exercise} from './exercises';
import lessons from '../../../content/lessons.json' with {type:'json'};
import {compile} from '@firecnc/core';
import {simulate} from '@firecnc/simulation';
import {assess} from './exercises';

export const teachingPackageSchema=z.strictObject({format:z.literal('firecnc-teaching'),version:z.literal(1),title:z.string().trim().min(3).max(160),questions:z.array(examQuestionSchema).max(200),exams:z.array(examDefinitionSchema).max(30),exercises:z.array(exerciseSchema).max(20)});
export type TeachingPackage=z.infer<typeof teachingPackageSchema>;
export function validateTeachingPackage(value:unknown):TeachingPackage {
  const p=teachingPackageSchema.parse(value),ids=new Set<string>();
  for(const item of [...p.questions,...p.exams,...p.exercises]){
    if(!/^custom-[a-z0-9-]{3,65}$/.test(item.id)||ids.has(item.id))throw new Error('Каждый собственный ID должен начинаться с custom- и быть уникальным.');ids.add(item.id);
  }
  validateExamBank(p.questions);
  const bank=[...examBank,...p.questions];
  for(const e of p.exams){
    if(e.topics.some(id=>!lessons.some(l=>l.id===id&&l.course===e.course)))throw new Error('Не найдена тема собственного теста.');
    if(e.questionIds&&(new Set(e.questionIds).size!==e.questionIds.length||e.questionIds.some(id=>!bank.some(q=>q.id===id&&q.course===e.course&&e.topics.includes(q.lessonId)))))throw new Error('Вопрос собственного теста отсутствует в выбранных темах.');
    if(bank.filter(q=>q.course===e.course&&e.topics.includes(q.lessonId)&&(!e.questionIds||e.questionIds.includes(q.id))).length<e.count)throw new Error('В банке недостаточно вопросов для собственного теста.');
  }
  for(const e of p.exercises){
    if(!lessons.some(l=>l.id===e.lesson&&l.course===e.kind))throw new Error('Не найдена тема задания.');
    if(e.kind==='turning'?(e.stockId!=='cylinder-40x60'||e.fixtureId!=='chuck-15'):(e.stockId!=='plate-60x40x15'||e.fixtureId!=='vise-top-minus5'))throw new Error('Заготовка и закрепление не соответствуют станку.');
    const program=compile(e.source,{kind:e.kind}),result=simulate(program,{kind:e.kind});
    if(program.error||!assess(e,result,{completed:result.completed===program.events.length}).passed)throw new Error('Пример решения задания не достигает целевой геометрии: '+e.title);
  }
  return p;
}
export function mergeTeachingPackages(packages:TeachingPackage[]):{questions:ExamQuestion[];exams:ExamDefinition[];exercises:Exercise[]} {
  const choose=<T extends {id:string;version:number}>(items:T[])=>{
    const byId=new Map<string,T>();for(const item of items){const old=byId.get(item.id);if(!old||item.version>old.version)byId.set(item.id,item);}return [...byId.values()];
  };
  return {questions:[...examBank,...choose(packages.flatMap(p=>p.questions))],exams:choose(packages.flatMap(p=>p.exams)),exercises:[...exercises,...choose(packages.flatMap(p=>p.exercises))]};
}
