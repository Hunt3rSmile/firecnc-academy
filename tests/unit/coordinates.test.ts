import {describe,it,expect} from 'vitest';
import {createCoordinateAttempt,answerCoordinate,advanceCoordinate,coordinateExpected,coordinateFinished,coordinateAttemptSchema} from '@firecnc/learning';
const create=(kind:'turning'|'milling'='turning',seed=2026,mode:'G90'|'G91'|'mixed'='mixed')=>createCoordinateAttempt({id:'b7b2510d-e19c-452f-a50d-e2b4b4607a9b',kind,seed,now:100,mode});
describe('Размерные чертежи и координаты G90/G91',()=>{
  it('воспроизводит геометрию по seed, а смешанный режим содержит оба способа отсчёта',()=>{
    const a=create();expect(a).toEqual(create());expect(new Set(a.modes).size).toBe(2);expect(create('turning',123).points).not.toEqual(a.points);
    expect(new Set(create('turning',2026,'G90').modes)).toEqual(new Set(['G90']));
    expect(new Set(create('turning',2026,'G91').modes)).toEqual(new Set(['G91']));
  });
  it('генерирует разные размеры, три/четыре ступени и несколько типов профиля',()=>{
    const signatures=new Set<string>(),families=new Set<string>(),counts=new Set<number>(),diameters=new Set<number>(),lengths=new Set<number>();
    for(let seed=0;seed<300;seed++){
      const a=create('turning',seed);expect(a.drawing).toBeDefined();const d=a.drawing!;
      signatures.add(JSON.stringify(a.points));families.add(d.family);counts.add(d.sections.length);lengths.add(d.length);d.sections.forEach(s=>diameters.add(s.diameter));
      expect(a.points.length).toBeLessThanOrEqual(20);expect(d.chamfers.length).toBeGreaterThan(0);expect(a.points.at(-1)!.z).toBe(-d.length);
      for(const [i,p] of a.points.entries()){
        expect(p.x).toBeGreaterThan(0);expect(p.y).toBe(0);if(i)expect(p.z).toBeLessThanOrEqual(a.points[i-1]!.z);
      }
      for(const s of d.sections){expect(s.frontZ).toBeGreaterThan(s.backZ);expect(s.backZ).toBeGreaterThanOrEqual(-d.length);}
    }
    expect(signatures.size).toBeGreaterThan(295);expect(families.size).toBe(3);expect(counts).toEqual(new Set([3,4]));expect(diameters.size).toBeGreaterThan(20);expect(lengths.size).toBeGreaterThan(20);
  });
  it('каждая фаска и наклон действительно имеют 45° в физической геометрии, а не в диаметральном X',()=>{
    for(let seed=0;seed<300;seed++){
      const a=create('turning',seed),d=a.drawing!;
      for(const edge of [...d.chamfers,...d.tapers]){
        const from=a.points[edge.from]!,to=a.points[edge.to]!;
        expect(edge.to).toBe(edge.from+1);expect(Math.abs(to.z-from.z)).toBe(edge.size);expect(Math.abs(to.x-from.x)/2).toBe(edge.size);
      }
      const c=d.chamfers[0]!.size;expect(a.points[0]!.x).toBe(d.sections[0]!.diameter-2*c);expect(a.points[1]!.z).toBe(-c);
    }
  });
  it('считает приращение на фаске по диаметру',()=>{
    const a=create(),c=a.drawing!.chamfers[0]!.size;
    a.index=1;a.answers=[{values:{x:'0',z:'0'},correct:false,expected:{x:0,y:0,z:0},submittedAt:101,tries:1}];a.modes[1]='G91';
    expect(coordinateExpected(a)).toEqual({x:2*c,y:0,z:-c});a.modes[1]='G90';expect(coordinateExpected(a)).toEqual(a.points[1]);
  });
  it('использует предыдущую точку фрезерного контура, включая возврат',()=>{
    const a=create('milling');a.index=3;a.modes[3]='G91';expect(coordinateExpected(a)).toEqual({x:-25,y:0,z:0});a.index=6;a.modes[6]='G91';expect(coordinateExpected(a)).toEqual({x:0,y:-15,z:0});
  });
  it('принимает запятую, сохраняет попытки исправления и отклоняет неверный формат осей',()=>{
    const a=create();a.modes[0]='G90';a.points[0]!.x=12.5;
    const wrong=answerCoordinate(a,{x:'6.25',z:'0'},101);expect(wrong.answers[0]?.correct).toBe(false);
    const fixed=answerCoordinate(wrong,{x:'12,5',z:'0'},102);expect(fixed.answers[0]).toMatchObject({correct:true,tries:2});
    expect(()=>answerCoordinate(fixed,{x:'12.5',z:'0'},103)).toThrow('уже сохранён');
    for(const values of ([{x:'12.5'},{x:'NaN',z:'0'},{x:'12.5',z:'Infinity'},{x:'12.5',z:'0',y:'0'}] as Record<string,string>[]))expect(()=>answerCoordinate(a,values,101)).toThrow();
    expect(a.answers).toHaveLength(0);
  });
  it.each(['turning','milling'] as const)('завершает последовательность %s с независимым расчётом',kind=>{
    let a=create(kind);
    for(let i=0;i<a.points.length;i++){
      const previous=i===0?a.start:a.points[i-1]!,target=a.points[i]!,absolute=a.modes[i]==='G90';
      const axes=kind==='turning'?['x','z'] as const:['x','y'] as const;
      const values=Object.fromEntries(axes.map(axis=>[axis,String(absolute?target[axis]:target[axis]-previous[axis])]));
      if(i===a.points.length-1){a=answerCoordinate(a,{...values,[axes[0]!]:String(Number(values[axes[0]!])+1)},101+i);expect(coordinateFinished(a)).toBe(false);}
      a=answerCoordinate(a,values,102+i);expect(a.answers[i]?.correct).toBe(true);expect(()=>answerCoordinate(a,values,103+i)).toThrow('уже сохранён');
      if(i<a.points.length-1)a=advanceCoordinate(a);
    }
    expect(coordinateFinished(a)).toBe(true);expect(()=>advanceCoordinate(a)).toThrow();
  });
  it('читает старую сохранённую попытку без размерного описания и счётчика попыток',()=>{
    const a=create();const raw=JSON.parse(JSON.stringify(a));delete raw.drawing;
    raw.answers=[{values:{x:'1',z:'0'},correct:false,expected:a.points[0],submittedAt:101}];
    const restored=coordinateAttemptSchema.parse(raw);expect(restored.drawing).toBeUndefined();expect(restored.answers[0]?.tries).toBe(1);
  });
});
