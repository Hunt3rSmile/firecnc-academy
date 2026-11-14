import type {MachineKind} from '@firecnc/core';
import {diameterAt,depthAt,frontFace,type SimulationResult} from '@firecnc/simulation';
export interface Exercise {id:string;version:1;kind:MachineKind;title:string;goal:string;lesson:string;source:string;checks:{name:string;expected:number;probe:'diameter'|'front'|'depth';x?:number;y?:number;z?:number}[]}
import {z} from 'zod';
import data from '../../../content/exercises.json';
const schema=z.strictObject({id:z.string().min(1),version:z.literal(1),kind:z.enum(['turning','milling']),title:z.string().min(5),goal:z.string().min(50),lesson:z.string(),source:z.string().max(200000),
  checks:z.array(z.strictObject({name:z.string(),expected:z.number(),probe:z.enum(['diameter','front','depth']),x:z.number().optional(),y:z.number().optional(),z:z.number().optional()})).min(2),
  profile:z.string(),stockId:z.enum(['cylinder-40x60','plate-60x40x15']),fixtureId:z.enum(['chuck-15','vise-top-minus5']),allowedTools:z.array(z.number().int().min(1).max(2)),initialOffset:z.strictObject({x:z.literal(0),y:z.literal(0),z:z.literal(0)}),resolution:z.literal(.25),grading:z.strictObject({geometry:z.literal(70),safety:z.literal(30),criticalCollision:z.literal(true)})});
export const exercises:Exercise[]=z.array(schema).parse(data);
if(new Set(exercises.map(e=>e.id)).size!==exercises.length)throw new Error('Повтор ID упражнения.');
export function assess(exercise:Exercise,result:SimulationResult,execution={completed:true}):{score:number;passed:boolean;checks:{name:string;value:number|null;expected:number;tolerance:number;passed:boolean}[]} {
  const checks=exercise.checks.map(check=>{
    const value=check.probe==='front'&&result.material.kind==='turning'?frontFace(result.material):check.probe==='diameter'&&result.material.kind==='turning'?diameterAt(result.material,check.z!):check.probe==='depth'&&result.material.kind==='milling'?depthAt(result.material,check.x!,check.y!):null;
    const tolerance=check.probe==='diameter'?result.uncertainty*2:result.uncertainty;
    return {name:check.name,value,expected:check.expected,tolerance,passed:value!==null&&Math.abs(value-check.expected)<=tolerance};
  });
  const safe=!result.collision&&execution.completed,geometry=checks.filter(c=>c.passed).length/checks.length;
  return {checks,score:safe?Math.round(70*geometry+30):0,passed:safe&&geometry===1};
}
