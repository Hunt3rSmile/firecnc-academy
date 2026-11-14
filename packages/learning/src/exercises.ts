import type {MachineKind} from '@firecnc/core';
import {diameterAt,depthAt,frontFace,type SimulationResult} from '@firecnc/simulation';
import {targetSchema,gradeGeometry,type GeometryTarget} from './geometry-grade';
export interface Exercise {id:string;version:number;kind:MachineKind;title:string;goal:string;lesson:string;source:string;initialSource?:string;target:GeometryTarget;allowedTools:number[];checks:{name:string;expected:number;probe:'diameter'|'front'|'depth';x?:number;y?:number;z?:number}[]}
import {z} from 'zod';
import data from '../../../content/exercises.json' with {type:'json'};
export const exerciseSchema=z.strictObject({id:z.string().min(1).max(80),version:z.number().int().positive(),kind:z.enum(['turning','milling']),title:z.string().min(5).max(160),goal:z.string().min(50).max(3000),lesson:z.string().max(80),source:z.string().max(200000),initialSource:z.string().max(200000).optional(),
  checks:z.array(z.strictObject({name:z.string(),expected:z.number(),probe:z.enum(['diameter','front','depth']),x:z.number().optional(),y:z.number().optional(),z:z.number().optional()})).min(2),
  target:targetSchema,profile:z.enum(['firecnc-din-v1-turning','firecnc-din-v1-milling']),stockId:z.enum(['cylinder-40x60','plate-60x40x15']),fixtureId:z.enum(['chuck-15','vise-top-minus5']),allowedTools:z.array(z.number().int().min(1).max(2)).min(1).max(2),initialOffset:z.strictObject({x:z.literal(0),y:z.literal(0),z:z.literal(0)}),resolution:z.literal(.25),grading:z.strictObject({geometry:z.literal(70),safety:z.literal(30),criticalCollision:z.literal(true)})}).refine(e=>e.target.kind===e.kind&&e.profile===`firecnc-din-v1-${e.kind}`);
export const exercises:Exercise[]=z.array(exerciseSchema).parse(data);
if(new Set(exercises.map(e=>e.id)).size!==exercises.length)throw new Error('Повтор ID упражнения.');
export function assess(exercise:Exercise,result:SimulationResult,execution={completed:true}) {
  const checks=exercise.checks.map(check=>{
    const value=check.probe==='front'&&result.material.kind==='turning'?frontFace(result.material):check.probe==='diameter'&&result.material.kind==='turning'?diameterAt(result.material,check.z!):check.probe==='depth'&&result.material.kind==='milling'?depthAt(result.material,check.x!,check.y!):null;
    const tolerance=check.probe==='diameter'?result.uncertainty*2:result.uncertainty;
    return {name:check.name,value,expected:check.expected,tolerance,passed:value!==null&&Math.abs(value-check.expected)<=tolerance};
  });
  const safeStop=result.state.stopped==='end'&&result.state.spindle==='off',forbiddenTools=result.usedTools.filter(tool=>!exercise.allowedTools.includes(tool)),safe=!result.collision&&execution.completed&&safeStop&&forbiddenTools.length===0,dimensions=checks.filter(c=>c.passed).length/checks.length,geometry=gradeGeometry(exercise.target,result);
  return {checks,geometry,forbiddenTools,safeStop,score:safe?Math.round(40*Number(geometry.passed)+30*dimensions+30):0,passed:safe&&dimensions===1&&geometry.passed};
}
