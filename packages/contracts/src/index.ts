import { z } from 'zod';
import type { MachineKind, Program } from '@firecnc/core';
import type {CoordinateAttempt} from '@firecnc/learning';
import type {MeasurementAttempt,InstrumentKind} from '@firecnc/learning';
import type {ExamDefinition,ExamView,ExamAnswer} from '@firecnc/learning';
import type {TeachingPackage,Exercise} from '@firecnc/learning';
import type {WorkshopInput,WorkshopState} from '@firecnc/learning';
import type {CAMDocument,GeneratedCAM,verifyGeneratedCAM} from '@firecnc/cam';
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
const currentProjectSchema=oldProjectSchema.omit({version:true}).extend({version:z.literal(2),setup:setupSchema,toolSetId:z.literal('firecnc-basic-v1').default('firecnc-basic-v1')}).superRefine((p,ctx)=>{
  if(p.setup.kind!==p.kind)ctx.addIssue({code:'custom',message:'Заготовка не соответствует типу станка.'});
  for(const message of validateSetup(p.setup))ctx.addIssue({code:'custom',message});
});
export const projectSchema=z.preprocess(value=>{
  if(typeof value==='object'&&value!==null&&'version' in value&&value.version===1){const old=oldProjectSchema.parse(value);return {...old,version:2,setup:defaultSetup(old.kind)};}
  return value;
},currentProjectSchema);
export type CNCProject=z.infer<typeof currentProjectSchema>;
export type CNCProjectInput=z.input<typeof currentProjectSchema>|z.infer<typeof oldProjectSchema>;
export interface LicenseView {status:'demo'|'active'|'expired'|'invalid'|'clock';message:string;edition?:Edition;licensedTo?:string;modules:LicenseModule[];expiresAt?:number|null;licenseId?:string;bound?:boolean;development:boolean}
export interface AttemptView {id:string;createdAt:number;score:number;total:number;answers:Record<string,string[]>;questions:unknown[]}
export interface PracticeAttempt {id:string;createdAt:number;exercise:{id:string;version:number;title:string;lesson:string;target:GeometryTarget};project:CNCProject;grade:ReturnType<typeof assess>;diagnostic:{line:number;message:string;fix:string}|null;statistics:{removedVolume:number;seconds:number;completed:number;frames:number;uncertainty:number}}
export interface UpdateView {status:'idle'|'checking'|'current'|'available'|'error';currentVersion:string;latestVersion:string|null;releaseUrl:string|null;releaseNotes:string;checkedAt:number|null;automatic:boolean;packaged:boolean;message:string}
export interface AppState {profile:{id:string;name:string};completed:string[];attempts:AttemptView[];project:CNCProject|null;settings:{theme:'dark'|'light';split:number};license:LicenseView;updates:UpdateView;installationHash:string;version:string;runtime:{electron:string;node:string;abi:string}}
export type Result<T> = {ok:true;value:T}|{ok:false;error:string};
export interface ExamStartOptions {definitionId:string;seed?:number;count?:number;durationSeconds?:number;passingScore?:number;topics?:string[];hints?:boolean}
export interface ExamCatalog {definitions:ExamDefinition[];topics:{id:string;title:string;course:'turning'|'milling'}[]}
export interface ExamHistoryItem {id:string;title:string;createdAt:number;status:ExamView['status'];score:number|null;passed:boolean|null}
export interface OnlineLicenseView {endpoint:string;activated:boolean;expiresAt:number|null;busy:boolean;protectedStorage:boolean;message:string}
export interface CAMResult {project:CNCProject;target:GeneratedCAM['target'];note:string;validation:ReturnType<typeof verifyGeneratedCAM>}
export interface CAMState {document:CAMDocument;result:CAMResult|null}
export interface DesktopAPI {
  readonly security:{readonly sandbox:boolean;readonly contextIsolation:boolean};
  state():Promise<Result<AppState>>;
  profile(name:string):Promise<Result<AppState>>;
  profiles():Promise<Result<{id:string;name:string}[]>>;
  profileSelect(id:string):Promise<Result<AppState>>;
  teacherStatus():Promise<Result<TeacherStatus>>;
  teacherConfigure(password:string):Promise<Result<TeacherStatus>>;
  teacherUnlock(password:string):Promise<Result<TeacherStatus>>;
  teacherLock():Promise<Result<TeacherStatus>>;
  teacherData():Promise<Result<TeacherData>>;
  teacherCreateProfile(name:string):Promise<Result<TeacherData>>;
  teacherSavePackage(value:TeachingPackage):Promise<Result<TeacherData>>;
  teacherImport():Promise<Result<TeacherData|null>>;
  teacherExport():Promise<Result<boolean>>;
  practiceCatalog():Promise<Result<Exercise[]>>;
  workshopCurrent(kind:MachineKind):Promise<Result<WorkshopState|null>>;
  workshopStart(kind:MachineKind):Promise<Result<WorkshopState>>;
  workshopAdvance(value:{id:string;kind:MachineKind;input:WorkshopInput}):Promise<Result<WorkshopState>>;
  workshopBack(kind:MachineKind):Promise<Result<WorkshopState>>;
  workshopProject(kind:MachineKind):Promise<Result<AppState>>;
  camCurrent():Promise<Result<CAMState|null>>;
  camSave(document:CAMDocument):Promise<Result<void>>;
  camGenerate(document:CAMDocument):Promise<Result<CAMResult>>;
  camCancel():Promise<Result<void>>;
  camOpen():Promise<Result<AppState>>;
  lessonCheckStart(id:string):Promise<Result<ExamView>>;
  lessonComplete(id:string):Promise<Result<AppState>>;
  quizSubmit(answers:Record<string,string[]>):Promise<Result<AppState>>;
  coordinateCurrent():Promise<Result<CoordinateAttempt|null>>;
  coordinateStart(value:{kind:MachineKind;seed?:number}):Promise<Result<CoordinateAttempt>>;
  coordinateAnswer(value:{id:string;values:Record<string,string>}):Promise<Result<CoordinateAttempt>>;
  coordinateNext(id:string):Promise<Result<CoordinateAttempt>>;
  practiceSubmit(value:{exerciseId:string;project:CNCProjectInput}):Promise<Result<PracticeAttempt>>;
  practiceHistory():Promise<Result<PracticeAttempt[]>>;
  practiceCancel():Promise<Result<void>>;
  measurementCurrent():Promise<Result<MeasurementAttempt|null>>;
  measurementStart(value:{kind:InstrumentKind;mode:MeasurementAttempt['mode'];seed?:number}):Promise<Result<MeasurementAttempt>>;
  measurementAnswer(value:{id:string;value:string}):Promise<Result<MeasurementAttempt>>;
  measurementNext(id:string):Promise<Result<MeasurementAttempt>>;
  measurementHistory():Promise<Result<MeasurementAttempt[]>>;
  examCatalog():Promise<Result<ExamCatalog>>;
  examCurrent():Promise<Result<ExamView|null>>;
  examGet(id:string):Promise<Result<ExamView>>;
  examStart(value:ExamStartOptions):Promise<Result<ExamView>>;
  examAnswer(value:{id:string;questionId:string;answer:ExamAnswer}):Promise<Result<ExamView>>;
  examNavigate(value:{id:string;index:number}):Promise<Result<ExamView>>;
  examFinish(id:string):Promise<Result<ExamView>>;
  examHint(value:{id:string;questionId:string}):Promise<Result<{attempt:ExamView;hint:string}>>;
  examExportPdf(id:string):Promise<Result<boolean>>;
  examHistory():Promise<Result<ExamHistoryItem[]>>;
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
  onlineStatus():Promise<Result<OnlineLicenseView>>;
  onlineActivate(value:{endpoint:string;key:string}):Promise<Result<OnlineLicenseView>>;
  onlineRenew():Promise<Result<OnlineLicenseView>>;
  onlineDeactivate():Promise<Result<OnlineLicenseView>>;
  activationRequest():Promise<Result<boolean>>;
  exportResults():Promise<Result<boolean>>;
  backup():Promise<Result<boolean>>;
  restoreBackup():Promise<Result<boolean>>;
  diagnosticsExport():Promise<Result<boolean>>;
  updateCheck():Promise<Result<UpdateView>>;
  updateAutomatic(value:boolean):Promise<Result<UpdateView>>;
  updateOpen():Promise<Result<boolean>>;
  onUpdates(callback:(value:UpdateView)=>void):()=>void;
}
export interface TeacherStatus {configured:boolean;unlocked:boolean;mayWrite:boolean}
export interface TeacherData {content:TeachingPackage;profiles:{id:string;name:string;lessons:number;exams:number;best:number|null;practice:number}[]}
export interface ComputeRequest {id:number;project:CNCProject;frame:number|null}
export type ComputeResponse = {type:'progress';id:number;progress:number}|{type:'done';id:number;program:Program;simulation:import('@firecnc/simulation').SimulationResult}|{type:'error';id:number;message:string};
export const DEMO_SOURCES:Record<MachineKind,string> = {
  turning:'(FireCNC DIN учебный — наружное точение Ø30)\nG21 G18 G90 G54\nT0101\nS800 M3\nG0 X44 Z3\nG1 X30 F100\nG1 Z-30\nG1 X44\nG0 Z5\nM5\nM30',
  milling:'(FireCNC DIN учебный — паз шириной 10, глубиной 3)\nG21 G17 G90 G54\nT1 M6\nS1600 M3\nG0 X-8 Y20 Z5\nG1 Z-3 F100\nG1 X68 F200\nG0 Z10\nM5\nM30'
};
