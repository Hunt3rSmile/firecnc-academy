import { z } from 'zod';
import type { MachineKind, Program } from '@firecnc/core';
import type {CoordinateAttempt} from '@firecnc/learning';
import type {assess} from '@firecnc/learning';
import type {GeometryTarget} from '../../learning/src/geometry-grade';
import {defaultSetup,validateSetup} from '@firecnc/simulation';
export const MODULES = ['theory','turning','milling','measurements','exams','teacher','cadcam'] as const;
export type LicenseModule = typeof MODULES[number];
export const EDITIONS = {student:['theory','turning','milling','measurements','exams'], teacher:['theory','turning','milling','measurements','exams','teacher'], lab:[...MODULES]} satisfies Record<string,LicenseModule[]>;
export type Edition = keyof typeof EDITIONS;
const oldProjectSchema = z.strictObject({version:z.literal(1),name:z.string().trim().min(1).max(100),kind:z.enum(['turning','milling']),source:z.string().max(200000),offset:z.strictObject({x:z.number().min(-1000).max(1000),y:z.number().min(-1000).max(1000),z:z.number().min(-1000).max(1000)}),resolution:z.number().min(0.1).max(1)});
const size=z.number().finite().min(0).max(1000);
export const setupSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('turning'),diameter:size,length:size,clampLength:size}),
  z.strictObject({kind:z.literal('milling'),width:size,depth:size,thickness:size,jawGrip:size})
]);
const currentProjectSchema=oldProjectSchema.omit({version:true}).extend({version:z.literal(2),setup:setupSchema}).superRefine((p,ctx)=>{
  if(p.setup.kind!==p.kind)ctx.addIssue({code:'custom',message:'Заготовка не соответствует типу станка.'});
  for(const message of validateSetup(p.setup))ctx.addIssue({code:'custom',message});
});
export const projectSchema=z.preprocess(value=>{
  if(typeof value==='object'&&value!==null&&'version' in value&&value.version===1){const old=oldProjectSchema.parse(value);return {...old,version:2,setup:defaultSetup(old.kind)};}
  return value;
},currentProjectSchema);
export type CNCProject=z.infer<typeof currentProjectSchema>;
export type CNCProjectInput=CNCProject|z.infer<typeof oldProjectSchema>;
export interface LicenseView {status:'demo'|'active'|'expired'|'invalid'|'clock';message:string;edition?:Edition;licensedTo?:string;modules:LicenseModule[];expiresAt?:number|null;licenseId?:string;bound?:boolean;development:boolean}
export interface AttemptView {id:string;createdAt:number;score:number;total:number;answers:Record<string,string[]>;questions:unknown[]}
export interface PracticeAttempt {id:string;createdAt:number;exercise:{id:string;version:number;title:string;lesson:string;target:GeometryTarget};project:CNCProject;grade:ReturnType<typeof assess>;diagnostic:{line:number;message:string;fix:string}|null;statistics:{removedVolume:number;seconds:number;completed:number;frames:number;uncertainty:number}}
export interface UpdateView {status:'idle'|'checking'|'current'|'available'|'error';currentVersion:string;latestVersion:string|null;releaseUrl:string|null;releaseNotes:string;checkedAt:number|null;automatic:boolean;packaged:boolean;message:string}
export interface AppState {profile:{id:string;name:string};completed:string[];attempts:AttemptView[];project:CNCProject|null;settings:{theme:'dark'|'light';split:number};license:LicenseView;updates:UpdateView;installationHash:string;version:string;runtime:{electron:string;node:string;abi:string}}
export type Result<T> = {ok:true;value:T}|{ok:false;error:string};
export interface DesktopAPI {
  readonly security:{readonly sandbox:boolean;readonly contextIsolation:boolean};
  state():Promise<Result<AppState>>;
  profile(name:string):Promise<Result<AppState>>;
  lessonComplete(id:string):Promise<Result<AppState>>;
  quizSubmit(answers:Record<string,string[]>):Promise<Result<AppState>>;
  coordinateCurrent():Promise<Result<CoordinateAttempt|null>>;
  coordinateStart(value:{kind:MachineKind;seed?:number}):Promise<Result<CoordinateAttempt>>;
  coordinateAnswer(value:{id:string;values:Record<string,string>}):Promise<Result<CoordinateAttempt>>;
  coordinateNext(id:string):Promise<Result<CoordinateAttempt>>;
  practiceSubmit(value:{exerciseId:string;project:CNCProjectInput}):Promise<Result<PracticeAttempt>>;
  practiceHistory():Promise<Result<PracticeAttempt[]>>;
  practiceCancel():Promise<Result<void>>;
  settings(value:{theme:'dark'|'light';split:number}):Promise<Result<void>>;
  projectSave(project:CNCProjectInput):Promise<Result<void>>;
  projectImport():Promise<Result<CNCProject|null>>;
  projectExport(project:CNCProjectInput):Promise<Result<boolean>>;
  programOpen():Promise<Result<string|null>>;
  programSave(source:string):Promise<Result<boolean>>;
  authorizeSimulation(project:CNCProjectInput):Promise<Result<true>>;
  licenseImport(token:string):Promise<Result<LicenseView>>;
  licenseOpen():Promise<Result<LicenseView|null>>;
  licenseExport():Promise<Result<boolean>>;
  activationRequest():Promise<Result<boolean>>;
  exportResults():Promise<Result<boolean>>;
  backup():Promise<Result<boolean>>;
  updateCheck():Promise<Result<UpdateView>>;
  updateAutomatic(value:boolean):Promise<Result<UpdateView>>;
  updateOpen():Promise<Result<boolean>>;
  onUpdates(callback:(value:UpdateView)=>void):()=>void;
}
export interface ComputeRequest {id:number;project:CNCProject;frame:number|null}
export type ComputeResponse = {type:'progress';id:number;progress:number}|{type:'done';id:number;program:Program;simulation:import('@firecnc/simulation').SimulationResult}|{type:'error';id:number;message:string};
export const DEMO_SOURCES:Record<MachineKind,string> = {
  turning:'(FireCNC DIN учебный — наружное точение Ø30)\nG21 G18 G90 G54\nT0101\nS800 M3\nG0 X44 Z3\nG1 X30 F100\nG1 Z-30\nG1 X44\nG0 Z5\nM5\nM30',
  milling:'(FireCNC DIN учебный — паз шириной 10, глубиной 3)\nG21 G17 G90 G54\nT1 M6\nS1600 M3\nG0 X-8 Y20 Z5\nG1 Z-3 F100\nG1 X68 F200\nG0 Z10\nM5\nM30'
};
