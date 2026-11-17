import {z} from 'zod';
import {decimalAnswer} from './numbers';
import {generateTurningDrawing,turningDrawingSchema} from './turning-drawing';

export const coordinateKind=z.enum(['turning','milling']);
const point=z.strictObject({x:z.number().finite().min(-500).max(500),y:z.number().finite().min(-500).max(500),z:z.number().finite().min(-500).max(500)});
export const coordinateAttemptSchema=z.strictObject({
  version:z.literal(1),id:z.string().uuid(),kind:coordinateKind,seed:z.number().int().min(0).max(0xffffffff),
  createdAt:z.number().int().nonnegative(),demo:z.boolean(),index:z.number().int().min(0).max(19),
  start:point,points:z.array(point).min(2).max(20),modes:z.array(z.enum(['G90','G91'])).min(2).max(20),drawing:turningDrawingSchema.optional(),
  answers:z.array(z.strictObject({values:z.record(z.string(),z.string().max(32)),correct:z.boolean(),expected:point,submittedAt:z.number().int().nonnegative(),tries:z.number().int().positive().default(1)})).max(20)
}).refine(a=>a.points.length===a.modes.length&&a.index<a.points.length&&a.answers.length>=a.index&&a.answers.length<=a.index+1);
export type CoordinateAttempt=z.infer<typeof coordinateAttemptSchema>;
export type CoordinatePoint=CoordinateAttempt['start'];
export const coordinateAxes=(kind:CoordinateAttempt['kind']):('x'|'y'|'z')[]=>kind==='turning'?['x','z']:['x','y'];
export function coordinateFinished(a:CoordinateAttempt):boolean{return a.answers.length===a.points.length&&!!a.answers.at(-1)?.correct;}
export function coordinateExpected(a:CoordinateAttempt,index=a.index):CoordinatePoint {
  const target=a.points[index];if(!target)throw new Error('Точка вне задания.');
  const previous=index===0?a.start:a.points[index-1]!;
  return a.modes[index]==='G90'?{...target}:{x:target.x-previous.x,y:target.y-previous.y,z:target.z-previous.z};
}
// A reproducible educational PRNG. It is never used for licenses or secrets.
function random(seed:number):()=>number {let value=seed>>>0;return ()=>{value=(value+0x6d2b79f5)>>>0;let t=Math.imul(value^(value>>>15),1|value);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};}
export function createCoordinateAttempt(input:{id:string;kind:CoordinateAttempt['kind'];seed:number;now:number;demo?:boolean;mode?:'G90'|'G91'|'mixed'}):CoordinateAttempt {
  const r=random(input.seed),s=Math.floor(r()*4)*2;
  const generated=input.kind==='turning'?generateTurningDrawing(r):null;
  // Coordinates are programmed values: turning X is a diameter, including increments.
  const points=generated?generated.points:
    [{x:10+s,y:10,z:0},{x:60+s,y:10,z:0},{x:60+s,y:45,z:0},{x:35+s,y:45,z:0},{x:35+s,y:25,z:0},{x:10+s,y:25,z:0},{x:10+s,y:10,z:0}];
  const mode=input.mode??'G90',modes=points.map(()=>mode==='mixed'?(r()<.5?'G90' as const:'G91' as const):mode);
  if(mode==='mixed'&&modes.every(m=>m===modes[0]))modes[modes.length-1]=modes[0]==='G90'?'G91':'G90';
  return coordinateAttemptSchema.parse({version:1,id:input.id,kind:input.kind,seed:input.seed,createdAt:input.now,demo:input.demo??false,index:0,start:{x:0,y:0,z:0},points,modes,answers:[],...(generated?{drawing:generated.drawing}:{})});
}
export function answerCoordinate(a:CoordinateAttempt,values:Record<string,string>,now:number):CoordinateAttempt {
  const previousAnswer=a.answers[a.index];
  if(a.answers.length!==a.index&&(!previousAnswer||previousAnswer.correct))throw new Error('Ответ на эту точку уже сохранён. Перейдите к следующей.');
  const axes=coordinateAxes(a.kind),expected=coordinateExpected(a);
  if(Object.keys(values).length!==axes.length||!axes.every(axis=>Object.hasOwn(values,axis)))throw new Error('Введите обе координаты текущей точки.');
  const numbers=axes.map(axis=>decimalAnswer(values[axis]!));
  if(numbers.some(value=>value===null||Math.abs(value)>10000))throw new Error('Введите конечное число в миллиметрах. Допускаются запятая и точка.');
  const correct=axes.every((axis,i)=>Math.abs(numbers[i]!-expected[axis])<=.001);
  const answers=a.answers.slice();answers[a.index]={values,correct,expected,submittedAt:now,tries:(previousAnswer?.tries??0)+1};
  return coordinateAttemptSchema.parse({...a,answers});
}
export function advanceCoordinate(a:CoordinateAttempt):CoordinateAttempt {
  if(a.answers.length!==a.index+1||coordinateFinished(a)||a.index>=a.points.length-1)throw new Error('Сначала ответьте на текущую точку.');
  return coordinateAttemptSchema.parse({...a,index:a.index+1});
}
export function explainCoordinate(a:CoordinateAttempt,index=a.index):string {
  const previous=index===0?a.start:a.points[index-1]!,target=a.points[index]!,expected=coordinateExpected(a,index);
  return coordinateAxes(a.kind).map(axis=>a.modes[index]==='G90'?`${axis.toUpperCase()} = ${target[axis]} мм от рабочего нуля`:`${axis.toUpperCase()} = ${target[axis]} − (${previous[axis]}) = ${expected[axis]} мм`).join('; ')+(a.kind==='turning'?'. X задан в диаметре; радиальное перемещение вдвое меньше изменения X.':'. Приращение берётся от предыдущей точки, а не от нуля.');
}
