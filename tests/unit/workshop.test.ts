import {it,expect} from 'vitest';
import {createWorkshop,advanceWorkshop,workshopErrors} from '@firecnc/learning';
it.each(['turning','milling'] as const)('%s: порядок наладки и атомарный отказ ошибке',kind=>{
  let state=createWorkshop(kind,crypto.randomUUID());const ready={...state.input,fixture:kind==='turning'?'chuck' as const:'vise' as const,tool:1,slot:1,direction:'cw' as const,rpm:800};
  expect(()=>advanceWorkshop(state,{...ready,fixture:'clamps'})).toThrow();expect(state.step).toBe(0);
  state=advanceWorkshop(state,ready);const invalidSetup=kind==='turning'?{kind,diameter:40,length:60,clampLength:5}:{kind,width:60,depth:40,thickness:15,jawGrip:2};
  expect(()=>advanceWorkshop(state,{...ready,setup:invalidSetup})).toThrow();expect(state.step).toBe(1);state=advanceWorkshop(state,ready);
  expect(()=>advanceWorkshop(state,{...ready,tool:2,slot:2})).toThrow();state=advanceWorkshop(state,ready);
  expect(()=>advanceWorkshop(state,{...ready,offset:{x:0,y:0,z:10}})).toThrow();state=advanceWorkshop(state,ready);
  expect(()=>advanceWorkshop(state,{...ready,direction:'ccw'})).toThrow();state=advanceWorkshop(state,ready);state=advanceWorkshop(state,ready);
  expect(state.step).toBe(6);expect(workshopErrors(kind,state.input)).toEqual([]);expect(()=>advanceWorkshop(state,ready)).toThrow();
});
it('отклоняет слишком большой вылет и недостаточное свободное место для прохода',()=>{
  const s=createWorkshop('turning',crypto.randomUUID()),good={...s.input,fixture:'chuck' as const,tool:1,direction:'cw' as const};
  expect(workshopErrors('turning',{...good,setup:{kind:'turning',diameter:40,length:100,clampLength:15}}).some(s=>s.includes('вылет'))).toBe(true);
  expect(workshopErrors('turning',{...good,setup:{kind:'turning',diameter:40,length:60,clampLength:35}}).some(s=>s.includes('35 мм'))).toBe(true);
});
