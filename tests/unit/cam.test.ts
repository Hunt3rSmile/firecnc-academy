import {describe,it,expect} from 'vitest';
import {defaultCAM,generateCAM,verifyGeneratedCAM,validateContour,segmentPoints,type Contour} from '@firecnc/cam';
import {compile} from '@firecnc/core';
import {simulate,diameterAt,frontFace,depthAt} from '@firecnc/simulation';
describe('CAD: связность, дуги и пересечения',()=>{
  it('отклоняет разрывы, нулевые отрезки и самопересечение',()=>{
    const doc=defaultCAM('mill-pocket');expect(validateContour(doc.contour).valid).toBe(true);
    const gap=structuredClone(doc.contour);gap.segments[1]!.from={...gap.segments[1]!.from,x:gap.segments[1]!.from.x+1};expect(validateContour(gap).valid).toBe(false);
    expect(validateContour({closed:false,segments:[{type:'line',from:{x:0,y:0},to:{x:0,y:0}}]}).valid).toBe(false);
    const p=[{x:0,y:0},{x:10,y:10},{x:0,y:10},{x:10,y:0}],bow:Contour={closed:true,segments:p.map((from,i)=>({type:'line',from,to:p[(i+1)%p.length]!}))};expect(validateContour(bow).errors[0]).toContain('самопересекается');
  });
  it('аппроксимирует круг по геометрической погрешности, проверяет радиусы',()=>{
    const arc={type:'arc' as const,from:{x:10,y:0},to:{x:0,y:10},center:{x:0,y:0},clockwise:false},p=segmentPoints(arc);
    for(const q of p)expect(Math.hypot(q.x,q.y)).toBeCloseTo(10,8);
    for(let i=1;i<p.length;i++){const a=p[i-1]!,b=p[i]!;expect(10-Math.hypot((a.x+b.x)/2,(a.y+b.y)/2)).toBeLessThanOrEqual(.020001);}
    expect(()=>segmentPoints({...arc,to:{x:0,y:11}})).toThrow();expect(validateContour({closed:true,segments:[{...arc,to:{x:10,y:0}}]}).valid).toBe(true);
  });
});
describe('CAM: независимые аналитические результаты',()=>{
  it.each(['turn-profile','turn-face','mill-plane','mill-pocket'] as const)('%s проходит то же ядро и проверку всей формы',operation=>{const verified=verifyGeneratedCAM(generateCAM(defaultCAM(operation)));expect(verified.passed).toBe(true);expect(verified.removedVolume).toBeGreaterThan(0);});
  it('точение ступени даёт Ø30, нетронутый хвост и объём кольца',()=>{
    const g=generateCAM(defaultCAM('turn-profile')),r=simulate(compile(g.source,{kind:'turning'}),{kind:'turning'});if(r.material.kind!=='turning')throw new Error();expect(diameterAt(r.material,-15)).toBe(30);expect(diameterAt(r.material,-40)).toBe(40);expect(r.removedVolume).toBeCloseTo(Math.PI*(400-225)*30,5);
  });
  it('торцевание на 2 мм даёт новую плоскость Z−2 и объём диска',()=>{
    const g=generateCAM(defaultCAM('turn-face')),r=simulate(compile(g.source,{kind:'turning'}),{kind:'turning'});if(r.material.kind!=='turning')throw new Error();expect(frontFace(r.material)).toBe(-2);expect(r.removedVolume).toBeCloseTo(Math.PI*400*2,5);
  });
  it('плоскость удаляет ровно 60×40×3',()=>{
    const g=generateCAM(defaultCAM('mill-plane')),r=simulate(compile(g.source,{kind:'milling'}),{kind:'milling'});if(r.material.kind!=='milling')throw new Error();expect(depthAt(r.material,30,20)).toBe(3);expect(depthAt(r.material,.2,.2)).toBe(3);expect(r.removedVolume).toBeCloseTo(7200,5);
  });
  it('карман сохраняет материал вне цели и учитывает скруглённые углы',()=>{
    const g=generateCAM(defaultCAM('mill-pocket')),r=simulate(compile(g.source,{kind:'milling'}),{kind:'milling'});if(r.material.kind!=='milling')throw new Error();expect(depthAt(r.material,30,20)).toBe(3);expect(depthAt(r.material,8,20)).toBe(0);expect(depthAt(r.material,10.1,10.1)).toBe(0);expect(Math.abs(r.removedVolume-(40*20-(4-Math.PI)*25)*3)).toBeLessThan(25);
  });
  it('конус проверяется независимым объёмом усечённого конуса',()=>{
    const doc=defaultCAM('turn-profile');doc.contour.segments=[{type:'line',from:{x:0,y:12},to:{x:-30,y:18}}];const g=generateCAM(doc),r=verifyGeneratedCAM(g);expect(g.analyticVolume).toBeCloseTo(Math.PI*30*(400-(144+216+324)/3),5);expect(r.volumeError).toBeLessThan(400);
  });
  it('узкий карман отклоняется до генерации, Ø6 обрабатывает доступную область',()=>{
    const doc=defaultCAM('mill-pocket');doc.contour={closed:true,segments:[{x:10,y:10},{x:18,y:10},{x:18,y:30},{x:10,y:30}].map((from,i,p)=>({type:'line',from,to:p[(i+1)%p.length]!}))};expect(()=>generateCAM(doc)).toThrow('диаметра');doc.tool=2;expect(verifyGeneratedCAM(generateCAM(doc)).passed).toBe(true);
  });
  it('неподдерживаемый поворот/глубина/профиль не публикуется как программа',()=>{
    const doc=defaultCAM('turn-profile');doc.contour.segments=[{type:'line',from:{x:0,y:18},to:{x:-20,y:12}}];expect(()=>generateCAM(doc)).toThrow('радиус');expect(()=>generateCAM({...defaultCAM('turn-face'),depth:6})).toThrow('4 мм');const rotated=defaultCAM('mill-pocket');rotated.contour.segments[0]!.to={x:49,y:12};expect(()=>generateCAM(rotated)).toThrow();
  });
});
