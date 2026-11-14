import {describe,it,expect} from 'vitest';
import {compile,executeBlock,initialState,lexLine} from '@firecnc/core';
describe('Учебный DIN/ISO: координаты и атомарность',()=>{
  it('100 мм при F100 занимают 60 секунд',()=>{
    const p=compile('g1 x100 f100',{kind:'milling',initialPosition:{x:0,y:0,z:0}});
    expect(p.error).toBeNull();expect(p.state.position.x).toBe(100);expect(p.seconds).toBeCloseTo(60);
  });
  it('отличает G90 от G91 и применяет G54 в физических координатах',()=>{
    const p=compile('G90 G0 X10\nG91 X5\nG90 X2',{kind:'milling',offset:{x:100,y:20,z:0}});
    expect(p.events.map(e=>e.to.x)).toEqual([110,115,102]);
    expect(p.events[0]!.source).toBe('G90 G0 X10');
  });
  it('сохраняет T0101 и переводит диаметр X в радиус, I остаётся радиальным',()=>{
    expect(lexLine('N001 t0101 (резец)',1).tokens[1]!.raw).toBe('0101');
    const p=compile('T0101\nG0 X30\nG91 X-10',{kind:'turning'});
    expect(p.error).toBeNull();expect(p.state.position.x).toBe(10);expect(p.state.tool).toBe(1);
  });
  it('ошибочный кадр не применяет S, F или позицию частично',()=>{
    const p=compile('S800 M3\nG0 X10\nG1 G0 X99 F200 S900',{kind:'milling'});
    expect(p.error?.code).toBe('MODAL_CONFLICT');expect(p.state.rpm).toBe(800);expect(p.state.feed).toBe(0);expect(p.state.position.x).toBe(10);
    const state=initialState({kind:'milling'}),before=structuredClone(state);
    expect(()=>executeBlock(lexLine('F200 G1 X4 M77',3),state,{kind:'milling'})).toThrow();expect(state).toEqual(before);
  });
  it.each(['G20','G96 S100','G81 X1','G1 X1 F0','G0 X1e300','G0 XNaN','G0 X1 X2','G90 G91','M3','G18','G0 X10001'])('отклоняет %s',source=>{
    expect(compile(source,{kind:'milling'}).error).not.toBeNull();
  });
  it('принимает дробные записи и комментарии, отклоняет незакрытые',()=>{
    const p=compile('n10g0x+.5 y-1. (x999) ; остальное',{kind:'milling'});expect(p.error).toBeNull();expect(p.state.position.x).toBe(0.5);
    expect(compile('G0 (bad',{kind:'milling'}).error?.code).toBe('COMMENT');
  });
  it('ограничивает ввод и запрещает команды после M30',()=>{
    expect(compile(' '.repeat(200001),{kind:'milling'}).error?.code).toBe('FILE_LIMIT');
    expect(compile('M30\nG0 X3',{kind:'milling'}).error?.code).toBe('AFTER_END');
  });
});
describe('Геометрия дуг',()=>{
  for(const kind of ['milling','turning'] as const)for(const motion of [2,3])for(const format of ['center','R','largeR']) {
    it(`${kind}, G${motion}, ${format}`,()=>{
      const options={kind,initialPosition:kind==='milling'?{x:10,y:0,z:0}:{x:20,y:0,z:10}};
      const end=kind==='milling'?'X0 Y10':'X60 Z0',center=kind==='milling'?'I-10 J0':'K-10 I0';
      const p=compile(`G${motion} ${end} ${format==='center'?center:format==='R'?'R10':'R-10'} F100`,options);
      expect(p.error).toBeNull();
      const e=p.events[0]!;
      const expected=format==='R'?Math.PI/2:format==='largeR'?3*Math.PI/2:motion===3?Math.PI/2:3*Math.PI/2;
      expect(e.length).toBeCloseTo(10*expected,6);
      const shifted=format==='R'&&motion===2||format==='largeR'&&motion===3;
      for(const point of e.points)expect(kind==='milling'?Math.hypot(point.x-(shifted?10:0),point.y-(shifted?10:0)):Math.hypot(point.z-(shifted?10:0),point.x-20-(shifted?10:0))).toBeCloseTo(10,5);
    });
  }
  it('проверяет радиусы, неоднозначную полную дугу R и запрет винтовой дуги',()=>{
    const options={kind:'milling' as const,initialPosition:{x:10,y:0,z:0}};
    for(const code of ['G2 X0 Y20 I-10 F100','G2 X10 Y0 R10 F100','G2 X0 Y10 R2 F100','G2 X0 Y10 I-10 R10 F100','G3 X0 Y10 Z1 I-10 F100']) expect(compile(code,options).error).not.toBeNull();
    const full=compile('G3 I-10 F100',options);expect(full.error).toBeNull();expect(full.events[0]!.length).toBeCloseTo(Math.PI*20);
  });
});
