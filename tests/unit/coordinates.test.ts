import {describe,it,expect} from 'vitest';
import {createCoordinateAttempt,answerCoordinate,advanceCoordinate,coordinateExpected,coordinateFinished} from '@firecnc/learning';
const create=(kind:'turning'|'milling'='turning',seed=2026)=>createCoordinateAttempt({id:'b7b2510d-e19c-452f-a50d-e2b4b4607a9b',kind,seed,now:100});
describe('Проверка координат G90/G91',()=>{
  it('фиксирует геометрию и режим каждой точки по seed',()=>{const a=create();expect(a).toEqual(create());expect(new Set(a.modes).size).toBe(2);expect(create('turning',123)).not.toEqual(a);});
  it('считает токарный X в диаметре, включая инкремент на фаске 3×45°',()=>{
    const a=create();a.index=1;a.answers=[{values:{x:'0',z:'0'},correct:false,expected:{x:0,y:0,z:0},submittedAt:101}];a.modes[1]='G91';
    expect(coordinateExpected(a)).toEqual({x:6,y:0,z:-3});
    a.modes[1]='G90';expect(coordinateExpected(a)).toEqual(a.points[1]);
  });
  it('использует предыдущую точку контура, включая отрицательное приращение и возврат',()=>{
    const a=create('milling');a.index=3;a.modes[3]='G91';expect(coordinateExpected(a)).toEqual({x:-25,y:0,z:0});
    a.index=6;a.modes[6]='G91';expect(coordinateExpected(a)).toEqual({x:0,y:-15,z:0});
  });
  it('принимает запятую, сохраняет ошибку и отклоняет пропущенную ось',()=>{
    const a=create();a.modes[0]='G90';a.points[0]!.x=12.5;
    expect(answerCoordinate(a,{x:'12,5',z:'0'},101).answers[0]?.correct).toBe(true);
    expect(answerCoordinate(a,{x:'6.25',z:'0'},101).answers[0]?.correct).toBe(false);
    for(const values of ([{x:'12.5'},{x:'NaN',z:'0'},{x:'12.5',z:'Infinity'},{x:'12.5',z:'0',y:'0'}] as Record<string,string>[]))expect(()=>answerCoordinate(a,values,101)).toThrow();
    expect(a.answers).toHaveLength(0);
  });
  it.each(['turning','milling'] as const)('завершает всю последовательность %s с независимым расчётом',kind=>{
    let a=create(kind);
    for(let i=0;i<a.points.length;i++){
      const previous=i===0?a.start:a.points[i-1]!,target=a.points[i]!,absolute=a.modes[i]==='G90';
      const axes=kind==='turning'?['x','z'] as const:['x','y'] as const;
      const values=Object.fromEntries(axes.map(axis=>[axis,String(absolute?target[axis]:target[axis]-previous[axis])]));
      a=answerCoordinate(a,values,101+i);expect(a.answers[i]?.correct).toBe(true);
      expect(()=>answerCoordinate(a,values,102+i)).toThrow('уже сохранён');
      if(i<a.points.length-1)a=advanceCoordinate(a);
    }
    expect(coordinateFinished(a)).toBe(true);expect(()=>advanceCoordinate(a)).toThrow();
  });
});
