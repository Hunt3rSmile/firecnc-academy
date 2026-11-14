export type WorkshopSetup={kind:'turning';diameter:number;length:number;clampLength:number}|{kind:'milling';width:number;depth:number;thickness:number;jawGrip:number};
export const SETUP_RULES={minimumClamp:15,maximumOverhang:60,minimumJawGrip:5} as const;
export function defaultSetup(kind:'turning'|'milling'):WorkshopSetup {return kind==='turning'?{kind,diameter:40,length:60,clampLength:15}:{kind,width:60,depth:40,thickness:15,jawGrip:10};}
export function validateSetup(setup:WorkshopSetup):string[] {
  const errors:string[]=[];
  const finite=(v:number,min:number,max:number,label:string)=>{if(!Number.isFinite(v)||v<min||v>max)errors.push(`${label}: допустимо ${min}…${max} мм.`);};
  if(setup.kind==='turning'){
    finite(setup.diameter,10,80,'Диаметр');finite(setup.length,20,140,'Длина');finite(setup.clampLength,1,120,'Длина зажима');
    if(setup.clampLength>=setup.length)errors.push('Зажим должен быть короче заготовки: оставьте доступный вылет.');
    if(setup.clampLength<SETUP_RULES.minimumClamp)errors.push('Недостаточный зажим: в этом учебном сценарии требуется не менее 15 мм в патроне. Увеличьте длину зажима.');
    if(setup.length-setup.clampLength>SETUP_RULES.maximumOverhang)errors.push('Слишком большой вылет: учебный регламент ограничивает его 60 мм. Увеличьте зажим или уменьшите длину.');
  }else{
    finite(setup.width,10,150,'Ширина');finite(setup.depth,10,100,'Глубина');finite(setup.thickness,5,40,'Толщина');finite(setup.jawGrip,1,40,'Захват губками');
    if(setup.jawGrip<SETUP_RULES.minimumJawGrip)errors.push('Недостаточный захват губками: учебный регламент требует не менее 5 мм.');
    if(setup.jawGrip>setup.thickness)errors.push('Захват губками не может превышать толщину заготовки.');
  }
  return errors;
}
export function isDefaultSetup(setup:WorkshopSetup):boolean {const expected=defaultSetup(setup.kind);return Object.entries(expected).every(([key,value])=>(setup as unknown as Record<string,unknown>)[key]===value);}
