import {describe,it,expect} from 'vitest';
import {createMaterial,simulate,diameterAt,volume,validateSetup,defaultSetup} from '@firecnc/simulation';
import {compile} from '@firecnc/core';
import {projectSchema} from '@firecnc/contracts';
import {exercises,assess} from '@firecnc/learning';
describe('Заготовка и закрепление проекта v2',()=>{
  it('проверяет заданный учебный регламент зажима и вылета',()=>{
    expect(validateSetup({kind:'turning',diameter:40,length:60,clampLength:5}).join(' ')).toContain('Недостаточный зажим');
    expect(validateSetup({kind:'turning',diameter:40,length:100,clampLength:15}).join(' ')).toContain('вылет');
    expect(validateSetup({kind:'turning',diameter:40,length:60,clampLength:60}).join(' ')).toContain('короче');
    expect(validateSetup({kind:'milling',width:60,depth:40,thickness:15,jawGrip:3}).join(' ')).toContain('захват');
    expect(validateSetup({kind:'milling',width:60,depth:40,thickness:15,jawGrip:20}).join(' ')).toContain('толщину');
    expect(validateSetup(defaultSetup('turning'))).toEqual([]);
  });
  it('сохраняет исходный текст при миграции старого проекта',()=>{
    const old={version:1,kind:'turning',name:'Мой вал',source:'G90\nG0 X44',offset:{x:2,y:0,z:1},resolution:.25};
    expect(projectSchema.parse(old)).toEqual({...old,version:2,toolSetId:'firecnc-basic-v1',setup:defaultSetup('turning')});expect(old.version).toBe(1);
    expect(()=>projectSchema.parse({...old,source:'G0',extra:true})).toThrow();
  });
  it('получает независимый аналитический объём точения заготовки Ø50×70',()=>{
    const setup={kind:'turning' as const,diameter:50,length:70,clampLength:20};
    const original=createMaterial('turning',.25,setup);expect(volume(original)).toBeCloseTo(Math.PI*25**2*70,4);
    const p=compile('T0101\nS800 M3\nG0 X60 Z3\nG1 X40 F100\nG1 Z-20\nG1 X60\nM30',{kind:'turning'});
    const r=simulate(p,{kind:'turning',setup});expect(r.collision).toBeNull();expect(r.material.kind).toBe('turning');
    if(r.material.kind==='turning'){expect(diameterAt(r.material,-10)).toBe(40);expect(diameterAt(r.material,-30)).toBe(50);}
    expect(r.removedVolume).toBeCloseTo(Math.PI*(25**2-20**2)*20,4);
  });
  it('сдвигает защищённую зону патрона при изменении зажима',()=>{
    const p=compile('T0101\nS800 M3\nG0 X44 Z3\nG1 X30 F100\nG1 Z-40',{kind:'turning'});
    expect(simulate(p,{kind:'turning'}).collision).toBeNull();
    const blocked=simulate(p,{kind:'turning',setup:{kind:'turning',diameter:40,length:60,clampLength:25}});
    expect(blocked.collision?.code).toBe('FIXTURE');expect(blocked.completed).toBeLessThan(p.events.length);
  });
  it('снимает аналитический паз в плите другого размера',()=>{
    const setup={kind:'milling' as const,width:80,depth:50,thickness:12,jawGrip:7};
    const p=compile('T1 M6\nS1600 M3\nG0 X-8 Y25 Z5\nG1 Z-2 F100\nG1 X88 F200\nG0 Z5\nM30',{kind:'milling'});
    const r=simulate(p,{kind:'milling',setup});expect(r.collision).toBeNull();expect(r.removedVolume).toBeCloseTo(80*10*2,5);
  });
  it('отклоняет неверный тип и чрезмерную сетку до расчёта',()=>{
    expect(()=>createMaterial('turning',.25,defaultSetup('milling'))).toThrow('типу');
    expect(()=>createMaterial('milling',.1,{kind:'milling',width:150,depth:100,thickness:15,jawGrip:10})).toThrow('Сетка');
  });
  it('не засчитывает повреждение между правильными контрольными диаметрами',()=>{
    const e=exercises.find(e=>e.id==='turn-shaft')!,r=simulate(compile(e.source,{kind:'turning'}),{kind:'turning'});
    if(r.material.kind!=='turning')throw new Error('Wrong kind');
    const row=Math.floor((-22-r.material.zMin)/(r.material.length/r.material.nz));r.material.occupied[row*r.material.nr+10]=0;
    const grade=assess(e,r);expect(grade.checks.every(c=>c.passed)).toBe(true);expect(grade.geometry.passed).toBe(false);expect(grade.passed).toBe(false);expect(grade.score).toBeLessThan(100);
  });
});
