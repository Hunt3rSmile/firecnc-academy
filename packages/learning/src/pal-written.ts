import {z} from 'zod';
import {lexLine} from '@firecnc/core';

const finite=z.number().finite();
const step=z.strictObject({g:z.array(z.number().int()).optional(),m:z.array(z.number().int()).optional(),motion:z.array(z.union([z.literal(0),z.literal(1)])).optional(),x:finite.optional(),z:finite.optional(),s:finite.optional(),f:finite.optional(),t:finite.optional()});
export const palProgramSchema=z.strictObject({type:z.literal('pal-program'),initial:z.strictObject({x:finite,z:finite}),steps:z.array(step).min(1).max(30)});
type Specification=z.infer<typeof palProgramSchema>;
interface Check {label:string;passed:boolean;explanation:string;line?:number}
interface Frame {line:number;g:number[];m:number[];words:Map<string,number>;motion:number;x:number;z:number;feedPerRev:boolean}
const G_GROUPS:Record<number,string>={0:'motion',1:'motion',54:'zero',71:'units',90:'coordinates',91:'coordinates',92:'limit',94:'feed',95:'feed',96:'speed',97:'speed'};
const M_GROUPS:Record<number,string>={3:'spindle',4:'spindle',5:'spindle',8:'coolant',9:'coolant',30:'end'};
const G_DESCRIPTIONS:Record<number,string>={54:'G54 выбирает рабочую систему координат детали.',92:'В PAL G92 S задаёт верхний предел оборотов шпинделя.',96:'G96 поддерживает постоянную скорость резания; S задаётся в м/мин. Рост оборотов ограничивается G92.',97:'G97 задаёт постоянные обороты шпинделя; S измеряется в об/мин.'};
const close=(a:number,b:number)=>Math.abs(a-b)<.001000001;
const DESCRIPTIONS:Record<string,string>={X:'X задаёт диаметр в мм, а не радиус.',Z:'Z задаётся от нуля детали W. В материале слева от торца координаты отрицательны.',S:'В G96 S — м/мин, в G97 — об/мин, а в G92 S ограничивает обороты.',F:'В этих заданиях PAL задана подача на оборот, мм/об.',T:'В PAL здесь используется номер позиции револьвера T1…T12.'};

/** A written PAL fragment checker, deliberately separate from the DIN material simulator. */
export function assessPAL(source:string,specification:Specification):Check[]{
  let x=specification.initial.x,z=specification.initial.z,motion=0,absolute=true,ended=false,feedPerRev=true;
  const frames:Frame[]=[];let error:{message:string;line:number}|null=null;
  for(const [index,text] of source.replace(/(\d),(\d)/g,'$1.$2').replace(/[−–]/g,'-').split(/\r?\n/).entries()){
    const line=index+1;
    try{
      const block=lexLine(text,line);if(!block.tokens.length)continue;
      if(ended)throw new Error('После M30 находятся команды. Перенесите их перед концом программы.');
      const words=new Map<string,number>(),g:number[]=[],m:number[]=[],groups=new Set<string>();
      for(const [i,token] of block.tokens.entries()){
        const letter=token.letter,value=token.value;
        if(!'NGMXZSFT'.includes(letter))throw new Error(`Слово ${letter} не входит в проверяемый фрагмент PAL.`);
        if(!Number.isFinite(value))throw new Error('Координата или параметр должны быть конечным числом.');
        if(letter==='N'){if(i!==0||!Number.isInteger(value)||value<0)throw new Error('Номер кадра N должен быть первым неотрицательным целым.');continue;}
        if(letter==='G'||letter==='M'){
          const group=(letter==='G'?G_GROUPS:M_GROUPS)[value];
          if(!group)throw new Error(`${letter}${value} не входит в проверяемые команды PAL этого занятия.`);
          const key=letter+group;if(groups.has(key))throw new Error(`В кадре конфликтуют команды ${letter} группы «${group}».`);groups.add(key);
          (letter==='G'?g:m).push(value);
        }else{
          if(words.has(letter))throw new Error(`Параметр ${letter} задан дважды в одном кадре.`);
          if(letter==='T'&&(!Number.isInteger(value)||value<1||value>12))throw new Error('Здесь PAL использует позиции револьвера T1…T12, без записи корректора T0101.');
          if((letter==='F'||letter==='S')&&value<=0)throw new Error(`${letter} должен быть положительным.`);
          words.set(letter,value);
        }
      }
      if(g.includes(90))absolute=true;if(g.includes(91))absolute=false;
      if(g.includes(94))feedPerRev=false;if(g.includes(95))feedPerRev=true;
      if(g.includes(0))motion=0;if(g.includes(1))motion=1;
      if(words.has('X'))x=absolute?words.get('X')!:x+words.get('X')!;
      if(words.has('Z'))z=absolute?words.get('Z')!:z+words.get('Z')!;
      const configurationOnly=g.length>0&&g.every(code=>[71,90,91,94,95].includes(code))&&!words.size&&!m.length;
      if(!configurationOnly)frames.push({line,g,m,words,motion,x,z,feedPerRev});
      if(m.includes(30))ended=true;
    }catch(cause){
      const e=cause as {message?:string;diagnostic?:{message:string;fix:string}};
      error={line,message:e.diagnostic?`${e.diagnostic.message} ${e.diagnostic.fix}`:e.message??'Кадр не удалось разобрать.'};break;
    }
  }
  const checks:Check[]=[{label:'Синтаксис учебного PAL',passed:!error&&frames.length>0,explanation:error?error.message:'Команды фрагмента разобраны в профиле PAL. Это проверка записи и координат, без моделирования станка.',...(error?{line:error.line}:{})},
    {label:'Последовательность кадров',passed:frames.length===specification.steps.length,explanation:`Нужно ${specification.steps.length} содержательных кадров; найдено ${frames.length}. Комментарии, номера N и отдельные команды настройки на количество не влияют.`},
    {label:'Режим подачи G95',passed:feedPerRev&&frames.every(f=>f.feedPerRev),explanation:'В условии этих фрагментов задан G95: F в мм/об. G94 переключает F в мм/мин и меняет технологический смысл того же числа.'}];
  for(const [i,expected] of specification.steps.entries()){
    const frame=frames[i],prefix=`Кадр ${i+1}`;
    if(!frame){checks.push({label:prefix,passed:false,explanation:'Кадр отсутствует. Восстановите последовательность по условию.'});continue;}
    const add=(label:string,passed:boolean,explanation:string)=>checks.push({label:`${prefix}: ${label}`,passed,explanation,line:frame.line});
    if(expected.motion)add(expected.motion.map(m=>`G${m}`).join(' или '),expected.motion.some(m=>m===frame.motion),frame.motion===0?'G0 — ускоренное перемещение. Для резания нужна рабочая подача G1.':'G1 — рабочее линейное перемещение. Для безопасного быстрого отвода в условии может требоваться G0.');
    for(const code of expected.g??[]){const actual=frame.g.find(g=>G_GROUPS[g]===G_GROUPS[code]);add('G'+code,frame.g.includes(code),`${actual===undefined?'Команда не задана.':`В строке G${actual}; требуется G${code}.`} ${G_DESCRIPTIONS[code]??'Сверьте назначение команды с материалом занятия.'}`);}
    for(const code of expected.m??[]){const actual=frame.m.find(m=>M_GROUPS[m]===M_GROUPS[code]);add('M'+code,frame.m.includes(code),`${actual===undefined?'Команда не задана.':`В строке M${actual}; требуется M${code}.`} `+(code===8?'M8 включает СОЖ.':code===9?'M9 отключает СОЖ.':'Направление шпинделя выбирается для указанной в условии установки инструмента. Не переносите M3/M4 на другую оснастку автоматически.'));}
    for(const letter of ['X','Z','S','F','T'] as const){
      const target=expected[letter.toLowerCase() as 'x'|'z'|'s'|'f'|'t'];if(target===undefined)continue;
      const actual=letter==='X'?frame.x:letter==='Z'?frame.z:frame.words.get(letter);
      add(`${letter}${target}`,actual!==undefined&&close(actual,target),`${actual===undefined?'Параметр не задан.':`Получено ${letter}${Number(actual.toFixed(5))}.`} ${DESCRIPTIONS[letter]}`);
    }
    const allowedG=new Set([...(expected.g??[]),71,90,91,94,95,...(expected.motion?[0,1]:[])]);
    const unexpected=frame.g.filter(g=>!allowedG.has(g)&&!(expected.g??[]).some(e=>G_GROUPS[e]===G_GROUPS[g]));
    const unexpectedM=frame.m.filter(m=>!(expected.m??[]).includes(m)&&!(expected.m??[]).some(e=>M_GROUPS[e]===M_GROUPS[m]));
    const unexpectedWords=[...frame.words.keys()].filter(k=>expected[k.toLowerCase() as 'x'|'z'|'s'|'f'|'t']===undefined&&!(expected.motion&&['X','Z'].includes(k)));
    if(unexpected.length||unexpectedM.length||unexpectedWords.length)add('Нет посторонних команд',false,`Лишние параметры меняют смысл фрагмента: ${[...unexpected.map(g=>'G'+g),...unexpectedM.map(m=>'M'+m),...unexpectedWords].join(', ')}.`);
    if(expected.x===undefined&&expected.z===undefined&&(frame.words.has('X')||frame.words.has('Z')))add('Нет непредусмотренного перемещения',false,'Технологический кадр этого задания не должен перемещать инструмент.');
  }
  if(error)for(const check of checks)check.passed=false;
  return checks;
}
