import {z} from 'zod';
import {defaultSetup,validateSetup} from '@firecnc/simulation';
const size=z.number().finite().min(0).max(1000);
export const workshopInputSchema=z.strictObject({fixture:z.enum(['chuck','vise','clamps']).nullable(),setup:z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('turning'),diameter:size,length:size,clampLength:size}),z.strictObject({kind:z.literal('milling'),width:size,depth:size,thickness:size,jawGrip:size})
]),tool:z.number().int().min(1).max(2).nullable(),slot:z.number().int().min(1).max(2),offset:z.strictObject({x:z.number().min(-1000).max(1000),y:z.number().min(-1000).max(1000),z:z.number().min(-1000).max(1000)}),direction:z.enum(['cw','ccw','off']),rpm:z.number().int().min(0).max(5000)});
export type WorkshopInput=z.infer<typeof workshopInputSchema>;
export const workshopStateSchema=z.strictObject({version:z.literal(1),id:z.string().uuid(),kind:z.enum(['turning','milling']),step:z.number().int().min(0).max(6),input:workshopInputSchema}).refine(v=>v.kind===v.input.setup.kind);
export type WorkshopState=z.infer<typeof workshopStateSchema>;
export const WORKSHOP_STEPS=['Закрепление','Заготовка','Инструмент','Рабочий ноль','Шпиндель','Перед запуском'] as const;
export function createWorkshop(kind:'turning'|'milling',id:string):WorkshopState {return {version:1,id,kind,step:0,input:{fixture:null,setup:defaultSetup(kind),tool:null,slot:1,offset:{x:0,y:0,z:0},direction:'off',rpm:800}};}
export function workshopErrors(kind:'turning'|'milling',input:WorkshopInput):string[] {
  const s=input.setup,errors:string[]=[];
  if(s.kind!==kind)return ['Заготовка не соответствует станку.'];
  if(input.fixture!==(kind==='turning'?'chuck':'vise'))errors.push(kind==='turning'?'Для этого цилиндра выберите трёхкулачковый патрон. Тиски не вращают деталь со шпинделем.':'Для плиты этого сценария выберите тиски. Патрон токарного станка и прижимы не представлены в данной установке.');
  errors.push(...validateSetup(s));
  if(s.kind==='turning'&&(s.diameter!==40||s.length!==60))errors.push('Чертёж этого сценария требует заготовку Ø40 × 60 мм. Другие размеры доступны в свободном симуляторе.');
  if(s.kind==='turning'&&s.length-s.clampLength<35)errors.push('Для прохода до Z−30 оставьте не менее 35 мм доступного вылета.');
  if(s.kind==='milling'&&(s.width!==60||s.depth!==40||s.thickness!==15))errors.push('В этом задании установите плиту 60 × 40 × 15 мм.');
  if(input.tool!==1)errors.push(kind==='turning'?'Выберите наружный правый резец 1. Резец 2 предназначен для канавки.':'Для паза шириной 10 мм выберите фрезу 1 диаметром 10 мм. Фреза 2 имеет Ø6 мм.');
  if(input.slot!==input.tool)errors.push('В базовом учебном наборе инструмент 1 устанавливается в позицию 1, инструмент 2 — в позицию 2.');
  if(Object.values(input.offset).some(v=>v!==0))errors.push(kind==='turning'?'Для этого сценария рабочий Z0 находится на торце, X0 — на оси: задайте смещения G54 равными 0.':'Для этой плиты X0/Y0 — нижний левый угол, Z0 — верхняя поверхность: задайте G54 (0, 0, 0).');
  if(input.direction!=='cw')errors.push('Выбранный правый инструмент в этом сценарии требует M3. M4 задаёт противоположное вращение, M5 выключает шпиндель.');
  if(input.rpm<400||input.rpm>2000)errors.push('Учебный диапазон этого сценария: 400…2000 об/мин. Это условие задания, не рекомендация для реального материала.');
  return errors;
}
export function advanceWorkshop(state:WorkshopState,input:WorkshopInput):WorkshopState {
  workshopStateSchema.parse(state);workshopInputSchema.parse(input);if(state.step>=6)throw new Error('Наладка завершена. Начните новый сценарий для изменения условий.');
  if(input.setup.kind!==state.kind)throw new Error('Заготовка не соответствует станку.');
  const fail=(text:string)=>{throw new Error(text);};
  if(state.step===0&&input.fixture!==(state.kind==='turning'?'chuck':'vise'))fail(workshopErrors(state.kind,input)[0]!);
  if(state.step===1){const e=workshopErrors(state.kind,{...input,fixture:state.kind==='turning'?'chuck':'vise',tool:1,slot:1,offset:{x:0,y:0,z:0},direction:'cw',rpm:800});if(e.length)fail(e.join(' '));}
  if(state.step===2&&(input.tool!==1||input.slot!==1))fail(input.tool===1?'Установите инструмент 1 в позицию 1.':state.kind==='turning'?'Для наружного точения нужен правый резец 1.':'Паз шириной 10 мм требует фрезы 1, Ø10 мм.');
  if(state.step===3&&Object.values(input.offset).some(v=>v!==0))fail('Рабочий ноль не соответствует схеме сценария. Установите G54 (0, 0, 0).');
  if(state.step===4&&(input.direction!=='cw'||input.rpm<400||input.rpm>2000))fail('Выберите M3 и 400…2000 об/мин для правого инструмента этого сценария.');
  if(state.step===5){const e=workshopErrors(state.kind,input);if(e.length)fail(e.join(' '));}
  return {...state,step:state.step+1,input:structuredClone(input)};
}
