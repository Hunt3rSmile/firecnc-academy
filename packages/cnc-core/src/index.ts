export type MachineKind = 'turning' | 'milling';
export type Vec3 = {x: number; y: number; z: number};
export type Motion = 0 | 1 | 2 | 3;
export interface Token {letter: string; value: number; raw: string; line: number; column: number}
export interface Block {line: number; source: string; tokens: Token[]}
export interface Diagnostic {code: string; line: number; column: number; message: string; fix: string}
export interface ModalState {
  position: Vec3; units: 'mm'; plane: 'XY' | 'ZX'; motion: Motion; absolute: boolean;
  offset: Vec3; tool: number | null; selectedTool: number | null; correction: number;
  feed: number; rpm: number; spindle: 'off' | 'cw' | 'ccw'; coolant: boolean; stopped: 'none' | 'pause' | 'end';
}
export interface MachineEvent {
  line: number; source: string; from: Vec3; to: Vec3; points: Vec3[]; motion: Motion | null;
  length: number; seconds: number; state: ModalState; stop: 'none' | 'pause' | 'end';
}
export interface CompileOptions {kind: MachineKind; offset?: Vec3; initialPosition?: Vec3; chordError?: number}
export interface Program {events: MachineEvent[]; state: ModalState; error: Diagnostic | null; segments: number; seconds: number}
export const LIMITS = {characters: 200_000, lines: 5000, segments: 50_000, coordinate: 10_000, chordError: 0.02} as const;
const clone = <T>(v: T): T => structuredClone(v);
const zero = (): Vec3 => ({x: 0, y: 0, z: 0});
export const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
export const interpolate = (a: Vec3, b: Vec3, t: number): Vec3 => ({x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t, z:a.z+(b.z-a.z)*t});
class CNCError extends Error {
  constructor(public diagnostic: Diagnostic) {super(diagnostic.message);}
}
function fail(code: string, line: number, message: string, fix: string, column = 1): never {
  throw new CNCError({code,line,column,message,fix});
}
export function initialState(options: CompileOptions): ModalState {
  return {position: clone(options.initialPosition ?? (options.kind === 'turning' ? {x:25,y:0,z:5} : {x:-10,y:-10,z:10})),
    offset: clone(options.offset ?? zero()), units:'mm', plane:options.kind==='milling'?'XY':'ZX', motion:0, absolute:true,
    tool:null, selectedTool:null, correction:0, feed:0, rpm:0, spindle:'off', coolant:false, stopped:'none'};
}
export function lexLine(source: string, line: number): Block {
  const tokens: Token[] = [];
  let i=0;
  while(i<source.length) {
    const ch=source[i]!;
    if (/\s/.test(ch)) {i++;continue;}
    if(ch===';') break;
    if(ch==='(') {
      const end=source.indexOf(')',i+1);
      if(end<0 || source.slice(i+1,end).includes('(')) fail('COMMENT',line,'Незакрытый или вложенный комментарий.','Используйте (комментарий) без вложения.',i+1);
      i=end+1;continue;
    }
    const match=/^([a-z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/i.exec(source.slice(i));
    if(!match) fail('TOKEN',line,`Недопустимая запись около «${source.slice(i,i+12)}».`,'Введите букву и конечное число; десятичный разделитель программы — точка.',i+1);
    const value=Number(match[2]);
    if(!Number.isFinite(value)||Math.abs(value)>1e7) fail('NUMBER',line,'Число выходит за допустимый диапазон.','Проверьте знак, единицы и разрядность.',i+1);
    tokens.push({letter:match[1]!.toUpperCase(),value,raw:match[2]!,line,column:i+1});
    if(tokens.length>40) fail('BLOCK_SIZE',line,'Слишком много слов в кадре.','Разделите кадр на несколько строк.');
    i+=match[0].length;
  }
  return {line,source,tokens};
}
const gGroups: Record<number,string> = {0:'motion',1:'motion',2:'motion',3:'motion',17:'plane',18:'plane',21:'units',54:'offset',90:'distance',91:'distance'};
const mGroups: Record<number,string> = {0:'stop',2:'stop',30:'stop',3:'spindle',4:'spindle',5:'spindle',6:'tool',8:'coolant',9:'coolant'};
function arcPoints(from: Vec3, to: Vec3, words: Map<string,Token>, state: ModalState, line: number, chordError: number): {points:Vec3[];length:number} {
  const [u,v,w,cu,cv] = state.plane==='XY' ? ['x','y','z','I','J'] as const : ['z','x','y','K','I'] as const;
  if(Math.abs(from[w]-to[w])>1e-9) fail('HELIX',line,'В этом профиле винтовая дуга не поддерживается.','Оставьте третью ось неизменной.');
  const a={u:from[u],v:from[v]}, b={u:to[u],v:to[v]};
  const cw=state.motion===2, tau=Math.PI*2;
  const sweepAt=(c:{u:number;v:number}):number=> {
    const start=Math.atan2(a.v-c.v,a.u-c.u), end=Math.atan2(b.v-c.v,b.u-c.u);
    let delta=cw ? start-end : end-start;
    delta=((delta%tau)+tau)%tau;
    return delta<1e-10 ? tau : delta;
  };
  let center:{u:number;v:number};
  if(words.has('R')) {
    if(words.has('I')||words.has('J')||words.has('K')) fail('ARC_FORMAT',line,'Одновременно заданы R и смещения центра.','Используйте один способ: R либо I/J/K.');
    const r=words.get('R')!.value, radius=Math.abs(r), chord=Math.hypot(b.u-a.u,b.v-a.v);
    if(chord<1e-9||radius<chord/2-1e-9) fail('ARC_RADIUS',line,'Радиус R не задаёт однозначную дугу.','Для полной окружности задайте центр; для дуги |R| должен быть не меньше половины хорды.');
    const mid={u:(a.u+b.u)/2,v:(a.v+b.v)/2}, h=Math.sqrt(Math.max(0,radius*radius-chord*chord/4));
    const candidates=[1,-1].map(sign=>({u:mid.u-sign*(b.v-a.v)*h/chord,v:mid.v+sign*(b.u-a.u)*h/chord}));
    center=candidates.find(c=>r>=0?sweepAt(c)<=Math.PI+1e-8:sweepAt(c)>=Math.PI-1e-8)!;
    if(!center) fail('ARC_RADIUS',line,'Не удалось построить дугу.','Проверьте радиус и координаты.');
  } else {
    if(!words.has(cu)&&!words.has(cv)) fail('ARC_CENTER',line,'У дуги отсутствует центр или R.','Задайте I/J для G17 или I/K для G18.');
    center={u:a.u+(words.get(cu)?.value??0),v:a.v+(words.get(cv)?.value??0)};
  }
  const radius=Math.hypot(a.u-center.u,a.v-center.v), endRadius=Math.hypot(b.u-center.u,b.v-center.v);
  if(radius<1e-6||Math.abs(radius-endRadius)>Math.min(0.01,chordError/2)) fail('ARC_MISMATCH',line,'Начало и конец дуги имеют разные радиусы.','Исправьте конечную точку или смещения центра.');
  const sweep=sweepAt(center), angle=Math.atan2(a.v-center.v,a.u-center.u);
  const maxAngle=Math.min(Math.PI/4,2*Math.acos(Math.max(-1,1-chordError/2/radius)));
  const count=Math.max(1,Math.ceil(sweep/Math.max(1e-6,maxAngle)));
  if(count>LIMITS.segments) fail('SEGMENT_LIMIT',line,'Дуга требует слишком много сегментов.','Уменьшите радиус или ослабьте точность.');
  const points:Vec3[]=[clone(from)];
  for(let j=1;j<=count;j++) {
    const t=angle+(cw?-1:1)*sweep*j/count;
    const p=clone(from);p[u]=center.u+radius*Math.cos(t);p[v]=center.v+radius*Math.sin(t);
    points.push(j===count?clone(to):p);
  }
  return {points,length:radius*sweep};
}
export function executeBlock(block: Block, previous: ModalState, options: CompileOptions): MachineEvent {
  const {tokens,line,source}=block, state=clone(previous), words=new Map<string,Token>(), groups=new Set<string>();
  if(previous.stopped==='end'&&tokens.length) fail('AFTER_END',line,'Команды расположены после конца программы.','Перенесите команды перед M2/M30.');
  state.stopped='none';
  for(const [index,t] of tokens.entries()) {
    if(!'NGMXYZIJKRFST'.includes(t.letter)) fail('WORD',line,`Слово ${t.letter} не поддерживается.`,'Сверьтесь с таблицей учебного профиля.',t.column);
    if(t.letter==='N') {
      if(index!==0||t.value<0||!Number.isInteger(t.value)) fail('LINE_NUMBER',line,'Номер кадра N должен быть первым неотрицательным целым.','Например: N10 G1 X20.');
    }
    if(t.letter==='G'||t.letter==='M') {
      const group=(t.letter==='G'?gGroups:mGroups)[t.value];
      if(!group||!Number.isInteger(t.value)) fail('UNSUPPORTED',line,`${t.letter}${t.raw} не поддерживается учебным профилем.`,'Удалите команду или используйте поддерживаемый эквивалент.',t.column);
      const key=t.letter+group;
      if(groups.has(key)) fail('MODAL_CONFLICT',line,'В одном кадре конфликтуют команды одной модальной группы.','Оставьте одну команду движения, режима или состояния из каждой группы.');
      groups.add(key);
    } else {
      if(words.has(t.letter)) fail('DUPLICATE',line,`Слово ${t.letter} задано дважды.`,'Оставьте одно значение.',t.column);
      words.set(t.letter,t);
    }
  }
  if(options.kind==='turning'&&(words.has('Y')||words.has('J'))) fail('AXIS',line,'В токарном профиле разрешены только X и Z; центр дуги I/K.','Удалите Y/J.');
  if(options.kind==='milling'&&words.has('K')) fail('AXIS',line,'В плоскости G17 центр дуги задаётся I/J.','Удалите K.');
  for(const t of tokens.filter(t=>t.letter==='G')) {
    if(t.value<=3) state.motion=t.value as Motion;
    if(t.value===17||t.value===18) {
      if((t.value===17)!==(options.kind==='milling')) fail('PLANE',line,'Плоскость не соответствует типу станка.','Используйте G17 для фрезерования, G18 для точения.');
      state.plane=t.value===17?'XY':'ZX';
    }
    if(t.value===90||t.value===91) state.absolute=t.value===90;
  }
  if(words.has('F')) {
    state.feed=words.get('F')!.value;
    if(state.feed<=0||state.feed>10000) fail('FEED',line,'Подача F должна быть от 0 до 10000 мм/мин, исключая 0.','Задайте положительную подачу, например F100.');
  }
  if(words.has('S')) {
    state.rpm=words.get('S')!.value;
    if(state.rpm<=0||state.rpm>30000) fail('RPM',line,'Обороты S должны быть положительными, не более 30000 об/мин.','Например S800.');
  }
  if(words.has('T')) {
    const t=words.get('T')!;
    if(options.kind==='turning') {
      if(!/^\d{4}$/.test(t.raw)) fail('TOOL',line,'Токарный инструмент задаётся четырьмя цифрами TNNCC.','Например T0101: инструмент 1, корректор 1.');
      const tool=Number(t.raw.slice(0,2)), correction=Number(t.raw.slice(2));
      if(tool<1||tool>8||correction!==tool) fail('TOOL',line,'Разрешены инструменты 01–08 с одноимённым нулевым корректором.','Например T0202. Геометрические поправки в этой версии равны нулю.');
      state.tool=tool;state.selectedTool=tool;state.correction=correction;
    } else {
      if(!Number.isInteger(t.value)||t.value<1||t.value>8) fail('TOOL',line,'Номер инструмента должен быть целым от 1 до 8.','Выберите T1…T8 и выполните M6.');
      state.selectedTool=t.value;
    }
  }
  for(const t of tokens.filter(t=>t.letter==='M')) {
    if(t.value===6) {
      if(options.kind!=='milling'||state.selectedTool===null) fail('TOOL_CHANGE',line,'M6 допустима только после выбора фрезерного инструмента T.','Введите T1 M6.');
      state.tool=state.selectedTool;state.correction=0;
    }
    if(t.value===3||t.value===4) {
      if(state.rpm<=0) fail('RPM_REQUIRED',line,'Перед включением шпинделя не заданы обороты.','Задайте S, например S800 M3.');
      state.spindle=t.value===3?'cw':'ccw';
    }
    if(t.value===5) state.spindle='off';
    if(t.value===8||t.value===9) state.coolant=t.value===8;
    if(t.value===0) state.stopped='pause';
    if(t.value===2||t.value===30) state.stopped='end';
  }
  const hasAxis=['X','Y','Z'].some(a=>words.has(a));
  const arc=state.motion===2||state.motion===3;
  const hasCenter=['I','J','K','R'].some(a=>words.has(a));
  if(hasCenter&&!arc) fail('ARC_WORD',line,'Центр или R задан вне круговой интерполяции.','Задайте G2/G3 или удалите I/J/K/R.');
  const moving=hasAxis||(arc&&hasCenter);
  if(moving&&(groups.has('Mtool')||words.has('T')||state.stopped!=='none')) fail('MIXED_BLOCK',line,'Перемещение совмещено со сменой инструмента или остановкой.','Разделите эти действия на отдельные кадры.');
  const from=clone(previous.position), to=clone(from);
  if(moving) {
    for(const axis of ['x','y','z'] as const) {
      const token=words.get(axis.toUpperCase());
      if(token) {
        const value=token.value/(options.kind==='turning'&&axis==='x'?2:1);
        to[axis]=state.absolute?value+state.offset[axis]:from[axis]+value;
      }
      if(Math.abs(to[axis])>LIMITS.coordinate) fail('COORDINATE_LIMIT',line,'Координата превышает учебный предел ±10000 мм.','Проверьте рабочий ноль и единицы.');
    }
    if(options.kind==='turning'&&to.x-state.offset.x < -1e-9) fail('NEGATIVE_RADIUS',line,'Диаметральная X не может быть отрицательной в этой модели.','Для торцевания завершите движение на X0.');
    if(state.motion!==0&&state.feed<=0) fail('FEED_REQUIRED',line,'Для рабочего перемещения не задана подача F.','Задайте F в мм/мин.');
  }
  const geometry=moving ? (arc?arcPoints(from,to,words,state,line,options.chordError??LIMITS.chordError):{points:[from,to],length:distance(from,to)}) : {points:[],length:0};
  if(options.kind==='turning'&&geometry.points.some(p=>p.x-state.offset.x < -1e-9)) fail('NEGATIVE_RADIUS',line,'Дуга пересекает отрицательный рабочий радиус.','Измените центр, радиус или направление дуги.');
  state.position=to;
  return {line,source,from,to,points:geometry.points,motion:moving?state.motion:null,length:geometry.length,seconds:moving?geometry.length/(state.motion===0?3000:state.feed)*60:0,state,stop:state.stopped};
}
export function compile(source: string, options: CompileOptions): Program {
  let state=initialState(options), segments=0, seconds=0;
  const events:MachineEvent[]=[];
  try {
    if(source.length>LIMITS.characters) fail('FILE_LIMIT',1,'Программа превышает 200000 символов.','Разделите программу.');
    const lines=source.replace(/\r\n?/g,'\n').split('\n');
    if(lines.length>LIMITS.lines) fail('LINE_LIMIT',1,'Программа превышает 5000 строк.','Сократите число кадров.');
    if(options.chordError!==undefined&&(!Number.isFinite(options.chordError)||options.chordError<0.001||options.chordError>0.5)) fail('PRECISION',1,'Погрешность дуги должна быть 0,001–0,5 мм.','Используйте 0,02 мм.');
    for(const [index,sourceLine] of lines.entries()) {
      const block=lexLine(sourceLine,index+1);
      if(!block.tokens.length) continue;
      const event=executeBlock(block,state,options);
      if(segments+Math.max(0,event.points.length-1)>LIMITS.segments) fail('SEGMENT_LIMIT',index+1,'Превышено 50000 сегментов траектории.','Разделите расчёт или уменьшите точность.');
      segments+=Math.max(0,event.points.length-1);seconds+=event.seconds;
      events.push(event);state=event.state;
    }
    return {events,state,error:null,segments,seconds};
  } catch(e) {
    if(!(e instanceof CNCError)) throw e;
    return {events,state,error:e.diagnostic,segments,seconds};
  }
}
