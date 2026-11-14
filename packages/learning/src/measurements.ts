import {z} from 'zod';
import {decimalAnswer} from './numbers';
export const instrumentKind=z.enum(['caliper','micrometer']);
export const measurementMode=z.enum(['explain','practice','question','series']);
export const INSTRUMENTS={caliper:{title:'Штангенциркуль',maximum:150,increment:.05,maxTicks:3000},micrometer:{title:'Микрометр',maximum:25,increment:.01,maxTicks:2500}} as const;
export type InstrumentKind=z.infer<typeof instrumentKind>;
function validateTicks(kind:InstrumentKind,ticks:number):void {if(!Number.isInteger(ticks)||ticks<0||ticks>INSTRUMENTS[kind].maxTicks)throw new Error('Показание выходит за диапазон прибора или не соответствует его цене деления.');}
export function caliperReading(ticks:number) {
  validateTicks('caliper',ticks);return {value:ticks/20,main:Math.floor(ticks/20),vernier:ticks%20,vernierPitch:19/20,vernierDivision:.05};
}
export function micrometerReading(ticks:number) {
  validateTicks('micrometer',ticks);const halfTurns=Math.floor(ticks/50);
  return {value:ticks/100,millimeters:Math.floor(halfTurns/2),halfMillimeter:halfTurns%2===1,drum:ticks%50,pitch:.5,divisions:50};
}
export function measurementExplanation(kind:InstrumentKind,ticks:number):string {
  if(kind==='caliper'){const m=caliperReading(ticks);return `На основной шкале ${m.main} мм; совпадает риска нониуса №${m.vernier}. ${m.main} + ${m.vernier} × 0,05 = ${m.value.toFixed(2)} мм. Нониус: 20 делений на 19 мм.`;}
  const m=micrometerReading(ticks);return `На стебле ${m.millimeters}${m.halfMillimeter?' + 0,5':''} мм; на барабане ${m.drum} делений. ${m.millimeters}${m.halfMillimeter?' + 0,5':''} + ${m.drum} × 0,01 = ${m.value.toFixed(2)} мм. Шаг винта 0,5 мм, 50 делений на оборот.`;
}
export const measurementAttemptSchema=z.strictObject({version:z.literal(1),id:z.string().uuid(),kind:instrumentKind,mode:measurementMode,seed:z.number().int().min(0).max(0xffffffff),createdAt:z.number().int().nonnegative(),index:z.number().int().min(0).max(4),ticks:z.array(z.number().int().nonnegative()).min(1).max(5),answers:z.array(z.strictObject({value:z.string().max(32),correct:z.boolean(),submittedAt:z.number().int().nonnegative()})).max(5)}).refine(a=>a.index<a.ticks.length&&a.answers.length>=a.index&&a.answers.length<=a.index+1&&a.ticks.every(t=>t<=INSTRUMENTS[a.kind].maxTicks));
export type MeasurementAttempt=z.infer<typeof measurementAttemptSchema>;
export function createMeasurementAttempt(input:{id:string;kind:InstrumentKind;mode:MeasurementAttempt['mode'];seed:number;now:number}):MeasurementAttempt {
  let s=input.seed>>>0;const random=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
  const max=INSTRUMENTS[input.kind].maxTicks,count=input.mode==='series'?5:1;
  const ticks=input.mode==='explain'?[input.kind==='caliper'?247:574]:[];
  while(ticks.length<count){const n=Math.floor(random()*(max+1));if(!ticks.includes(n))ticks.push(n);}
  return measurementAttemptSchema.parse({version:1,id:input.id,kind:input.kind,mode:input.mode,seed:input.seed,createdAt:input.now,index:0,ticks,answers:[]});
}
export const measurementFinished=(a:MeasurementAttempt):boolean=>a.answers.length===a.ticks.length;
export function answerMeasurement(a:MeasurementAttempt,value:string,now:number):MeasurementAttempt {
  if(a.mode==='explain')throw new Error('В режиме объяснения ответы не оцениваются.');
  if(a.answers.length!==a.index)throw new Error('Ответ уже сохранён. Перейдите к следующему измерению.');
  const number=decimalAnswer(value);if(number===null||number<0||number>INSTRUMENTS[a.kind].maximum)throw new Error(`Введите число от 0 до ${INSTRUMENTS[a.kind].maximum} мм с запятой или точкой.`);
  const expected=a.ticks[a.index]!*INSTRUMENTS[a.kind].increment,correct=Math.abs(number-expected)<=.001;
  return measurementAttemptSchema.parse({...a,answers:[...a.answers,{value,correct,submittedAt:now}]});
}
export function advanceMeasurement(a:MeasurementAttempt):MeasurementAttempt {
  if(a.answers.length!==a.index+1||measurementFinished(a))throw new Error('Сначала ответьте на текущее измерение.');
  return measurementAttemptSchema.parse({...a,index:a.index+1});
}
