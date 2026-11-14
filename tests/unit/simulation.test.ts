import {describe,it,expect} from 'vitest';
import {compile} from '@firecnc/core';
import {simulate,diameterAt,depthAt,frontFace,volume} from '@firecnc/simulation';
import {exercises,assess} from '@firecnc/learning';
import {DEMO_SOURCES} from '@firecnc/contracts';
describe('Изменение материала и независимые размеры',()=>{
  it.each(exercises)('$id: эталон даёт измеримый результат',e=>{
    const program=compile(e.source,{kind:e.kind});expect(program.error).toBeNull();
    const result=simulate(program,{kind:e.kind});expect(result.collision).toBeNull();
    expect(assess(e,result).passed).toBe(true);expect(result.removedVolume).toBeGreaterThan(0);
  });
  it('наружное точение Ø40 → Ø30 на длине 30 соответствует объёму кольца',()=>{
    const result=simulate(compile(DEMO_SOURCES.turning,{kind:'turning'}),{kind:'turning'});
    if(result.material.kind!=='turning')throw new Error();
    expect(diameterAt(result.material,-15)).toBe(30);expect(diameterAt(result.material,-35)).toBe(40);
    expect(result.removedVolume).toBeCloseTo(Math.PI*(20**2-15**2)*30,4);
  });
  it('торцевание уменьшает длину на 2 мм и закрывает сечение до оси',()=>{
    const e=exercises.find(e=>e.id==='turn-face')!;const result=simulate(compile(e.source,{kind:'turning'}),{kind:'turning'});
    if(result.material.kind!=='turning')throw new Error();
    expect(frontFace(result.material)).toBe(-2);expect(diameterAt(result.material,-1)).toBe(0);expect(result.removedVolume).toBeCloseTo(Math.PI*400*2,4);
  });
  it('паз на плите имеет аналитическую прямоугольную снятую область 60×10×3',()=>{
    const result=simulate(compile(DEMO_SOURCES.milling,{kind:'milling'}),{kind:'milling'});
    if(result.material.kind!=='milling')throw new Error();
    expect(depthAt(result.material,30,20)).toBe(3);expect(depthAt(result.material,30,14)).toBe(0);
    expect(result.removedVolume).toBeCloseTo(60*10*3,5);
  });
  it('внутренний прямой проход равен капсуле с круглыми концами',()=>{
    const source='T1 M6\nS1000 M3\nG0 X20 Y20 Z5\nG1 Z-2 F100\nG1 X40';
    const result=simulate(compile(source,{kind:'milling'}),{kind:'milling'});
    const exact=(20*10+Math.PI*25)*2;
    expect(result.collision).toBeNull();expect(Math.abs(result.removedVolume-exact)).toBeLessThan(20);
  });
  it('неверный G54 смещает обработку относительно неподвижного материала',()=>{
    const offset={x:0,y:20,z:0};
    const result=simulate(compile(DEMO_SOURCES.milling,{kind:'milling',offset}),{kind:'milling',offset});
    if(result.material.kind!=='milling')throw new Error();
    expect(depthAt(result.material,30,20)).toBe(0);expect(depthAt(result.material,30,38)).toBe(3);
  });
  it('готовые размеры не засчитываются, пока выполнение не закончено',()=>{
    const exercise=exercises[0]!,result=simulate(compile(exercise.source,{kind:'turning'}),{kind:'turning'});
    expect(assess(exercise,result,{completed:false})).toMatchObject({passed:false,score:0});
  });
  it('опасное окончание или неподходящий рабочий инструмент не засчитываются',()=>{
    const exercise=exercises[0]!,unfinished=simulate(compile(exercise.source.replace(/M30/g,''),{kind:'turning'}),{kind:'turning'});
    expect(assess(exercise,unfinished)).toMatchObject({passed:false,score:0,safeStop:false});
    const completed=simulate(compile(exercise.source,{kind:'turning'}),{kind:'turning'});
    expect(assess({...exercise,allowedTools:[2]},completed)).toMatchObject({passed:false,score:0,forbiddenTools:[1]});
  });
});
describe('Согласованное аварийное состояние и воспроизведение',()=>{
  it.each([
    ['turning','T0101\nG0 X60 Z-50','FIXTURE'],
    ['milling','T1 M6\nG0 X30 Y-4 Z-8','FIXTURE'],
    ['turning','T0101\nG0 X30 Z-10','RAPID_STOCK'],
    ['milling','T1 M6\nG0 X30 Y20 Z-3','RAPID_STOCK'],
    ['milling','G1 X10 F100','NO_TOOL'],
    ['turning','T0101\nG1 X30 F100','SPINDLE_OFF'],
    ['milling','T1 M6\nS1000 M4\nG1 X10 F100','SPINDLE_DIRECTION'],
    ['milling','T1 M6\nG0 X301','TRAVEL'],
    ['turning','T0303\nM30','TOOL_UNKNOWN'],
    ['milling','T3 M6\nM30','TOOL_UNKNOWN']
  ] as const)('%s: %s → %s',(kind,source,code)=>{
    const p=compile(source,{kind}),r=simulate(p,{kind});expect(r.collision?.code).toBe(code);
    expect(r.removedVolume).toBeCloseTo(0);expect(r.state.position).toEqual(p.events[r.completed]?.from);
  });
  it('держатель и хвостовик проверяются отдельно от режущей части',()=>{
    const p=compile('T0202\nS1000 M3\nG0 X44 Z-20\nG1 X10 F100',{kind:'turning'});
    expect(simulate(p,{kind:'turning'}).collision?.code).toBe('HOLDER_STOCK');
  });
  it('не удаляет несрезанную крышку над слишком глубоким боковым проходом',()=>{
    const p=compile('T1 M6\nS1000 M3\nG0 X-8 Y20 Z5\nG1 Z-15 F100\nG1 X30',{kind:'milling'});
    const result=simulate(p,{kind:'milling',setup:{kind:'milling',width:60,depth:40,thickness:25,jawGrip:5}});
    expect(result.collision?.code).toBe('CUTTING_LENGTH');expect(result.collision?.line).toBe(5);
  });
  it('возврат к кадру возвращает исходный материал; повтор детерминирован',()=>{
    const p=compile(DEMO_SOURCES.milling,{kind:'milling'}),full=simulate(p,{kind:'milling'}),begin=simulate(p,{kind:'milling',frame:0}),again=simulate(p,{kind:'milling'});
    expect(begin.removedVolume).toBe(0);expect(again.material).toEqual(full.material);
    const frames=p.events.map((_,frame)=>simulate(p,{kind:'milling',frame}));
    expect(frames[0]!.state.tool).toBeNull();expect(frames[3]!.state.tool).toBe(1);
    expect(volume(begin.material)-volume(full.material)).toBeCloseTo(full.removedVolume);
  });
  it('длинный быстрый ход не перепрыгивает губку тисков между концами',()=>{
    const p=compile('T1 M6\nG0 X-20 Y-4 Z-8\nG0 X85',{kind:'milling'});
    const r=simulate(p,{kind:'milling'});expect(r.collision?.code).toBe('FIXTURE');expect(r.collision?.line).toBe(3);
  });
  it('разрешение сетки меняет допустимую неопределённость измерения',()=>{
    const p=compile(DEMO_SOURCES.turning,{kind:'turning'});
    expect(simulate(p,{kind:'turning',resolution:.5}).uncertainty).toBeGreaterThan(simulate(p,{kind:'turning',resolution:.25}).uncertainty);
  });
});
