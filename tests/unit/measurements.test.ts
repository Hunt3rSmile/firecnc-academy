import {describe,it,expect} from 'vitest';
import {caliperReading,micrometerReading,createMeasurementAttempt,answerMeasurement,advanceMeasurement,measurementFinished} from '@firecnc/learning';
describe('Единая модель шкал',()=>{
  it.each([[0,0,0],[19,0,19],[20,1,0],[247,12,7],[2999,149,19],[3000,150,0]])('штангенциркуль: перенос и диапазон %i',(ticks,main,vernier)=>{
    const m=caliperReading(ticks);expect(m.main).toBe(main);expect(m.vernier).toBe(vernier);expect(m.value).toBeCloseTo(ticks*.05,10);
  });
  it('совпадение рисок происходит из той же геометрии во всём диапазоне',()=>{
    for(let ticks=0;ticks<=3000;ticks++){const m=caliperReading(ticks);expect(m.value+m.vernier*m.vernierPitch).toBeCloseTo(m.main+m.vernier,10);}
  });
  it.each([[0,0,false,0],[49,0,false,49],[50,0,true,0],[99,0,true,49],[100,1,false,0],[574,5,true,24],[2499,24,true,49],[2500,25,false,0]])('микрометр: пол-оборота и целый перенос %i',(ticks,whole,half,drum)=>{
    const m=micrometerReading(ticks);expect(m.millimeters).toBe(whole);expect(m.halfMillimeter).toBe(half);expect(m.drum).toBe(drum);expect(m.millimeters+Number(m.halfMillimeter)*.5+m.drum*.01).toBeCloseTo(ticks*.01,10);
  });
  it('не допускает показание за механическим диапазоном и между рисками',()=>{
    for(const ticks of [-1,3001,1.5,NaN,Infinity])expect(()=>caliperReading(ticks)).toThrow();
    for(const ticks of [-1,2501,1.5,NaN,Infinity])expect(()=>micrometerReading(ticks)).toThrow();
  });
  it('серия воспроизводится и сохраняет каждый ответ без повторного зачёта',()=>{
    const input={id:'14dfe898-a99d-42a4-8e46-2252f14a140c',kind:'micrometer' as const,mode:'series' as const,seed:2026,now:100};let a=createMeasurementAttempt(input);
    expect(a).toEqual(createMeasurementAttempt(input));expect(new Set(a.ticks).size).toBe(5);
    for(let i=0;i<5;i++){a=answerMeasurement(a,(a.ticks[i]!/100).toFixed(2).replace('.',','),101+i);expect(a.answers[i]?.correct).toBe(true);expect(()=>answerMeasurement(a,'0',100)).toThrow('уже');if(i<4)a=advanceMeasurement(a);}
    expect(measurementFinished(a)).toBe(true);expect(()=>advanceMeasurement(a)).toThrow();
  });
});
