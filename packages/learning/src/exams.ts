import {z} from 'zod';
import {compile} from '@firecnc/core';
import rawQuestions from '../../../content/questions.json' with {type:'json'};
import rawLessons from '../../../content/lessons.json' with {type:'json'};
import extra from '../../../content/exam-extra.json' with {type:'json'};
import {decimalAnswer} from './numbers';
import {INSTRUMENTS,instrumentKind} from './measurements';

const option=z.strictObject({id:z.string().min(1).max(50),text:z.string().min(1).max(500)});
const base=z.strictObject({id:z.string().min(1).max(80),version:z.number().int().positive(),course:z.enum(['turning','milling']),lessonId:z.string().max(80),prompt:z.string().min(15).max(2000),explanation:z.string().min(30).max(3000),mistake:z.string().min(20).max(2000),profile:z.literal('firecnc-din-v1').default('firecnc-din-v1'),sourceIds:z.array(z.enum(['linuxcnc-gcode','linuxcnc-overview','linuxcnc-lathe','firecnc-profile','mitutoyo-reading','sandvik-turning','sandvik-milling'])).min(1).max(5).default(['firecnc-profile'])});
const choice={options:z.array(option).min(2).max(12),correct:z.array(z.string().max(50)).min(1).max(12)};
export const examQuestionSchema=z.discriminatedUnion('type',[
  base.extend({type:z.literal('single'),...choice}),base.extend({type:z.literal('multiple'),...choice}),
  base.extend({type:z.literal('numeric'),expected:z.number().finite(),tolerance:z.number().min(0).max(100),unit:z.string().max(20)}),
  base.extend({type:z.literal('order'),...choice}),
  base.extend({type:z.literal('node'),diagram:z.enum(['turning','milling']),expected:z.string().max(50)}),
  base.extend({type:z.literal('program-result'),program:z.string().max(10000),axis:z.enum(['x','y','z','diameter']),expected:z.number().finite(),tolerance:z.number().min(0).max(100),unit:z.string().max(20)}),
  base.extend({type:z.literal('program-error'),program:z.string().max(10000),expected:z.number().int().min(1).max(1000)}),
  base.extend({type:z.literal('measurement'),instrument:instrumentKind,modelVersion:z.literal(1).default(1),ticks:z.number().int().min(0).max(3000)})
]);
export type ExamQuestion=z.infer<typeof examQuestionSchema>;
export const MACHINE_NODES={turning:[{id:'chuck',text:'Патрон'},{id:'workpiece',text:'Заготовка'},{id:'turret',text:'Револьверная головка'},{id:'bed',text:'Станина'}],milling:[{id:'spindle',text:'Шпиндель'},{id:'tool',text:'Фреза'},{id:'workpiece',text:'Заготовка'},{id:'vise',text:'Тиски'},{id:'table',text:'Стол'}]} as const;
export const examBank:ExamQuestion[]=z.array(examQuestionSchema).max(1000).parse([
  ...rawQuestions.map(q=>({id:q.id,version:q.version,course:rawLessons.find(l=>l.id===q.lessonId)!.course,lessonId:q.lessonId,prompt:q.prompt,explanation:q.explanation,mistake:q.mistake,type:q.correct.length===1?'single':'multiple',options:q.options.map((text,i)=>({id:String(i),text})),correct:q.correct.map(String)})),...extra
]);
export function validateExamBank(bank:ExamQuestion[]):void {
  const ids=new Set<string>();
  for(const q of bank){
    if(ids.has(q.id))throw new Error('Повтор ID экзамена: '+q.id);ids.add(q.id);
    if(!rawLessons.some(l=>l.id===q.lessonId&&l.course===q.course))throw new Error('Не найдена тема вопроса '+q.id);
    if('options' in q){const options=new Set(q.options.map(o=>o.id));if(options.size!==q.options.length||new Set(q.correct).size!==q.correct.length||!q.correct.every(id=>options.has(id)))throw new Error('Некорректные ответы '+q.id);if(q.type==='single'&&q.correct.length!==1||q.type==='order'&&q.correct.length!==q.options.length)throw new Error('Некорректный тип ответа '+q.id);}
    if(q.type==='node'&&!MACHINE_NODES[q.diagram].some(n=>n.id===q.expected))throw new Error('Неизвестный узел '+q.id);
    if(q.type==='measurement'&&q.ticks>INSTRUMENTS[q.instrument].maxTicks)throw new Error('Прибор вне диапазона '+q.id);
    if(q.type==='program-result'||q.type==='program-error'){
      const p=compile(q.program,{kind:q.course});
      if(q.type==='program-error'){if(p.error?.line!==q.expected)throw new Error('Неверная ожидаемая ошибка '+q.id);}
      else{const value=q.axis==='diameter'?p.state.position.x*2:p.state.position[q.axis];if(p.error||Math.abs(value-q.expected)>q.tolerance+1e-9)throw new Error('Неверный результат программы '+q.id);}
    }
  }
}
validateExamBank(examBank);
export const examDefinitionSchema=z.strictObject({id:z.string().max(80),version:z.number().int().positive(),title:z.string().max(160),course:z.enum(['turning','milling']),count:z.number().int().min(1).max(50),durationSeconds:z.number().int().min(60).max(7200),passingScore:z.number().min(0).max(100),topics:z.array(z.string().max(80)).min(1).max(30),questionIds:z.array(z.string().max(80)).min(1).max(50).optional(),hints:z.boolean(),maxAttempts:z.number().int().min(1).max(100)});
export type ExamDefinition=z.infer<typeof examDefinitionSchema>;
export const examDefinitions:ExamDefinition[]=(['turning','milling'] as const).flatMap(course=>(['intro','middle','final'] as const).map((level,i)=>({id:`${course}-${level}`,version:1,title:`${course==='turning'?'Точение':'Фрезерование'} · ${['вводный','промежуточный','итоговый'][i]} тест`,course,count:[4,8,12][i]!,durationSeconds:[300,600,900][i]!,passingScore:[60,70,80][i]!,topics:rawLessons.filter(l=>l.course===course).slice(0,[3,8,12][i]).map(l=>l.id),hints:i===0,maxAttempts:i===2?3:20})));
export type ExamAnswer=string|string[];
export const examAnswerSchema=z.union([z.string().max(256),z.array(z.string().max(50)).max(12)]);
export const storedExamSchema=z.strictObject({version:z.literal(1),id:z.string().uuid(),definition:examDefinitionSchema,seed:z.number().int().min(0).max(0xffffffff),createdAt:z.number().int().nonnegative(),deadline:z.number().int().nonnegative(),lastSeenAt:z.number().int().nonnegative(),finishedAt:z.number().int().nonnegative().nullable(),status:z.enum(['active','finished','expired']),currentIndex:z.number().int().min(0).max(49),questions:z.array(examQuestionSchema).min(1).max(50),answers:z.record(z.string().max(80),examAnswerSchema),timeByQuestion:z.record(z.string().max(80),z.number().min(0)),hintsUsed:z.array(z.string().max(80)).max(50)}).refine(a=>a.currentIndex<a.questions.length&&a.questions.length===a.definition.count&&a.deadline>a.createdAt);
export type StoredExam=z.infer<typeof storedExamSchema>;
type PublicQuestion<T>=T extends ExamQuestion?Omit<T,'correct'|'expected'|'explanation'|'mistake'>:never;
export type ExamQuestionView=PublicQuestion<ExamQuestion>;
export interface ExamReview {score:number;passed:boolean;correct:number;total:number;rows:{question:ExamQuestionView;answer:ExamAnswer|null;correct:boolean;expected:string;explanation:string;mistake:string}[]}
export interface ExamView {id:string;definition:ExamDefinition;seed:number;createdAt:number;deadline:number;observedAt:number;status:StoredExam['status'];currentIndex:number;questions:ExamQuestionView[];answers:Record<string,ExamAnswer>;hintsUsed:string[];timeByQuestion:Record<string,number>;review:ExamReview|null}
function publicQuestion(q:ExamQuestion):ExamQuestionView {const record={...q} as Record<string,unknown>;for(const key of ['correct','expected','explanation','mistake'])delete record[key];return record as unknown as ExamQuestionView;}
function random(seed:number):()=>number {let n=seed>>>0;return ()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};}
function shuffle<T>(values:T[],r:()=>number):T[]{const copy=values.slice();for(let i=copy.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[copy[i],copy[j]]=[copy[j]!,copy[i]!];}return copy;}
export function createExam(input:{id:string;definition:ExamDefinition;seed:number;now:number;bank?:ExamQuestion[]}):StoredExam {
  const definition=examDefinitionSchema.parse(input.definition),bank=input.bank??examBank,r=random(input.seed),eligible=bank.filter(q=>q.course===definition.course&&definition.topics.includes(q.lessonId)&&(!definition.questionIds||definition.questionIds.includes(q.id)));
  if(eligible.length<definition.count)throw new Error(`По выбранным темам доступно ${eligible.length} вопросов. Уменьшите количество или расширьте темы.`);
  const questions=shuffle(eligible,r).slice(0,definition.count).map(q=>{const next=structuredClone(q);if('options' in next)next.options=shuffle(next.options,r);return next;});
  return storedExamSchema.parse({version:1,id:input.id,definition,seed:input.seed,createdAt:input.now,deadline:input.now+definition.durationSeconds*1000,lastSeenAt:input.now,finishedAt:null,status:'active',currentIndex:0,questions,answers:{},timeByQuestion:{},hintsUsed:[]});
}
export function tickExam(value:StoredExam,now:number):StoredExam {
  const a=structuredClone(value);if(a.status!=='active')return a;const effective=Math.max(now,a.lastSeenAt),elapsed=Math.max(0,Math.min(effective,a.deadline)-a.lastSeenAt),id=a.questions[a.currentIndex]!.id;
  a.timeByQuestion[id]=(a.timeByQuestion[id]??0)+elapsed;a.lastSeenAt=effective;
  if(effective>=a.deadline){a.status='expired';a.finishedAt=a.deadline;}return a;
}
export function navigateExam(value:StoredExam,index:number,now:number):StoredExam {const a=tickExam(value,now);if(!Number.isInteger(index)||index<0||index>=a.questions.length)throw new Error('Вопрос не найден.');if(a.status==='active')a.currentIndex=index;return a;}
export function answerExam(value:StoredExam,questionId:string,answer:ExamAnswer,now:number):StoredExam {
  const a=tickExam(value,now);if(a.status!=='active')throw new Error('Время или попытка уже завершены. Ответы сохранены; откройте разбор.');
  const q=a.questions.find(q=>q.id===questionId);if(!q)throw new Error('Вопрос отсутствует в этой попытке.');
  examAnswerSchema.parse(answer);
  if(q.type==='multiple'||q.type==='order'){
    if(!Array.isArray(answer)||new Set(answer).size!==answer.length||!answer.every(id=>q.options.some(o=>o.id===id))||q.type==='order'&&answer.length!==q.options.length)throw new Error('Недопустимый набор или порядок ответов.');
  }else{
    if(typeof answer!=='string')throw new Error('Для вопроса требуется один ответ.');
    if(q.type==='single'&&answer!==''&&!q.options.some(o=>o.id===answer))throw new Error('Ответ отсутствует в вариантах.');
    if(q.type==='node'&&answer!==''&&!MACHINE_NODES[q.diagram].some(n=>n.id===answer))throw new Error('Узел отсутствует на схеме.');
  }
  a.answers[questionId]=structuredClone(answer);return a;
}
export function finishExam(value:StoredExam,now:number):StoredExam {const a=tickExam(value,now);if(a.status==='active'){a.status='finished';a.finishedAt=Math.max(now,a.lastSeenAt);}return a;}
export function useExamHint(value:StoredExam,questionId:string,now:number):StoredExam {
  const a=tickExam(value,now);if(!a.definition.hints||a.status!=='active'||!a.questions.some(q=>q.id===questionId))throw new Error('Подсказка недоступна в этой попытке.');
  if(!a.hintsUsed.includes(questionId))a.hintsUsed.push(questionId);return a;
}
function isCorrect(q:ExamQuestion,answer:ExamAnswer|undefined):boolean {
  if(q.type==='single')return typeof answer==='string'&&answer===q.correct[0];
  if(q.type==='multiple')return Array.isArray(answer)&&answer.length===q.correct.length&&q.correct.every(id=>answer.includes(id));
  if(q.type==='order')return Array.isArray(answer)&&q.correct.every((id,i)=>answer[i]===id);
  if(q.type==='node')return answer===q.expected;
  if(typeof answer!=='string')return false;const number=decimalAnswer(answer);if(number===null)return false;
  const expected=q.type==='measurement'?q.ticks*INSTRUMENTS[q.instrument].increment:q.expected,tolerance=q.type==='measurement'?.001:q.type==='program-error'?0:q.tolerance;
  return Math.abs(number-expected)<=tolerance+1e-10;
}
export function examAnswerText(q:ExamQuestionView,value:ExamAnswer|null|undefined):string {
  if(value===null||value===undefined||value===''||Array.isArray(value)&&value.length===0)return 'Не дан';
  if(Array.isArray(value))return value.map(id=>'options' in q?q.options.find(o=>o.id===id)?.text??id:id).join(q.type==='order'?' → ':'; ');
  if(q.type==='single')return q.options.find(o=>o.id===value)?.text??value;
  if(q.type==='node')return MACHINE_NODES[q.diagram].find(n=>n.id===value)?.text??value;
  if(q.type==='program-error')return 'Строка '+value;
  return value+' '+(q.type==='measurement'?'мм':'unit' in q?q.unit:'');
}
function expectedText(q:ExamQuestion):string {
  if(q.type==='single'||q.type==='multiple'||q.type==='order')return q.correct.map(id=>q.options.find(o=>o.id===id)!.text).join(q.type==='order'?' → ':'; ');
  if(q.type==='node')return MACHINE_NODES[q.diagram].find(n=>n.id===q.expected)!.text;
  if(q.type==='measurement')return `${(q.ticks*INSTRUMENTS[q.instrument].increment).toFixed(2)} мм`;
  return q.type==='program-error'?`Строка ${q.expected}`:`${q.expected} ${q.unit} (допуск ±${q.tolerance})`;
}
export function examView(a:StoredExam):ExamView {
  const rows=a.questions.map(q=>({question:publicQuestion(q),answer:a.answers[q.id]??null,correct:isCorrect(q,a.answers[q.id]),expected:expectedText(q),explanation:q.explanation,mistake:q.mistake})),correct=rows.filter(r=>r.correct).length,score=Math.round(correct/a.questions.length*100);
  return {id:a.id,definition:a.definition,seed:a.seed,createdAt:a.createdAt,deadline:a.deadline,observedAt:a.lastSeenAt,status:a.status,currentIndex:a.currentIndex,questions:a.questions.map(publicQuestion),answers:a.answers,hintsUsed:a.hintsUsed,timeByQuestion:a.timeByQuestion,review:a.status==='active'?null:{score,correct,total:a.questions.length,passed:score>=a.definition.passingScore,rows}};
}
