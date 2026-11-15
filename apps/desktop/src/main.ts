import {app,BrowserWindow,ipcMain,protocol,net,dialog,shell,safeStorage,type IpcMainInvokeEvent} from 'electron';
import {readFile,writeFile,stat,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {randomBytes,randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {Store} from './store';
import {installationHash,verifyLicense,strictJSON,type TrustStore} from '@firecnc/licensing';
import {projectSchema,DEMO_SOURCES,type LicenseView,type LicenseModule,type AppState,type Result,type CNCProject,type PracticeAttempt,type TeacherStatus,type CAMResult,type CAMState} from '@firecnc/contracts';
import {lessons,introQuestions,createCoordinateAttempt,answerCoordinate,advanceCoordinate,exercises,instrumentKind,measurementMode,createMeasurementAttempt,answerMeasurement,advanceMeasurement,examBank,examDefinitions,examView,tickExam,createExam,answerExam,navigateExam,finishExam,useExamHint,examAnswerSchema,type CoordinateAttempt} from '@firecnc/learning';
import {UpdateChecker} from './updates';
import {isDefaultSetup} from '@firecnc/simulation';
import {reportHTML,renderExamPdf} from './exam-report';
import {hashPassword,checkPassword} from './password';
import {OnlineLicensing} from './online-license';
import {teachingPackageSchema,mergeTeachingPackages,type TeachingPackage,type Exercise} from '@firecnc/learning';
import {workshopInputSchema,workshopStateSchema,createWorkshop,advanceWorkshop,workshopErrors,type WorkshopState} from '@firecnc/learning';
import {camDocumentSchema,type CAMDocument} from '@firecnc/cam';
import {targetSchema} from '../../../packages/learning/src/geometry-grade';
import {prepareRestore} from './restore';
import {redactDiagnostics} from './diagnostics';
import releaseSource from '../../../config/release.json';
declare const __TRUSTED_KEYS__:TrustStore;
declare const __DEVELOPMENT_TRUST__:boolean;
app.setName('FireCNC Academy');
protocol.registerSchemesAsPrivileged([{scheme:'firecnc',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
// This override selects only a data directory for development / integration tests; it cannot grant modules.
if(!app.isPackaged&&process.env.FCNC_DATA_DIR)app.setPath('userData',path.resolve(process.env.FCNC_DATA_DIR));
let win:BrowserWindow;
let store:Store;
let updates:UpdateChecker;
let online:OnlineLicensing,renewTimer:ReturnType<typeof setInterval>|undefined;
let gradingWorker:Worker|null=null;
let teachingWorker:Worker|null=null,teacherUntil=0,unlockFailures=0,unlockAfter=0;
let camWorker:Worker|null=null;
let restoring=false;
function automaticRenew():void {if(!restoring)void online.automaticRenew();}
const camKey=()=>`cam:${store.profileId}`;
function readCAM():CAMState|null {
  const raw=store.get(camKey());if(!raw)return null;const value=JSON.parse(raw) as CAMState;
  const document=camDocumentSchema.parse(value.document);if(value.result){projectSchema.parse(value.result.project);targetSchema.parse(value.result.target);}
  return {document,result:value.result??null};
}
async function calculateCAM(document:CAMDocument):Promise<CAMResult> {
  if(camWorker)throw new Error('Расчёт CAM уже выполняется.');
  const worker=new Worker(path.join(__dirname,'cam.cjs'),{workerData:document,resourceLimits:{maxOldGenerationSizeMb:128}});camWorker=worker;
  try{return await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{void worker.terminate();reject(new Error('Расчёт CAM превысил 30 секунд. Упростите контур.'));},30000);worker.once('message',(r:Result<CAMResult>)=>{clearTimeout(timeout);r.ok?resolve(r.value):reject(new Error(r.error));});worker.once('error',e=>{clearTimeout(timeout);reject(e);});worker.once('exit',()=>{clearTimeout(timeout);reject(new Error('Расчёт CAM отменён.'));});});}
  finally{await worker.terminate();if(camWorker===worker)camWorker=null;}
}
const localContent=()=>mergeTeachingPackages([store.teaching()]);
function teacherStatus():TeacherStatus {const l=licenseView();return {configured:!!store.get('teacherPassword'),unlocked:performance.now()<teacherUntil,mayWrite:performance.now()<teacherUntil&&l.status==='active'&&l.modules.includes('teacher')};}
function requireTeacher(write=false):void {if(performance.now()>=teacherUntil)throw new Error('Войдите в режим преподавателя. Сеанс действует 30 минут.');if(write)requireModule('teacher');}
const teacherData=()=>({content:store.teaching(),profiles:store.classroom()});
async function validatePackage(value:unknown):Promise<TeachingPackage> {
  if(Buffer.byteLength(JSON.stringify(value),'utf8')>2000000)throw new Error('Учебный пакет превышает 2 МБ.');
  if(teachingWorker)throw new Error('Проверка учебного пакета уже выполняется.');
  const worker=new Worker(path.join(__dirname,'teaching.cjs'),{workerData:value,resourceLimits:{maxOldGenerationSizeMb:128}});teachingWorker=worker;
  try{return await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{void worker.terminate();reject(new Error('Пакет превысил лимит проверки 30 секунд.'));},30000);worker.once('message',(r:Result<TeachingPackage>)=>{clearTimeout(timeout);r.ok?resolve(r.value):reject(new Error(r.error));});worker.once('error',e=>{clearTimeout(timeout);reject(e);});worker.once('exit',()=>{clearTimeout(timeout);reject(new Error('Проверка пакета остановлена.'));});});}
  finally{await worker.terminate();teachingWorker=null;}
}
const URL_ROOT='firecnc://app/index.html';
const now=()=>Math.floor(Date.now()/1000);
function licenseView():LicenseView {
  const base={modules:[] as LicenseModule[],development:__DEVELOPMENT_TRUST__};
  const token=store.get('license');
  if(!token)return {...base,status:'demo',message:'Ознакомительный режим: вводный урок, тест и два неизменяемых примера обработки.'};
  const result=verifyLicense(token,__TRUSTED_KEYS__,{now:now(),installationHash:installationHash(store.get('installationId')!)});
  if(!result.ok)return {...base,...(result.payload?{edition:result.payload.edition,licensedTo:result.payload.licensedTo,modules:result.payload.modules,expiresAt:result.payload.expiresAt,licenseId:result.payload.licenseId,bound:!!result.payload.binding}:{}),status:result.code==='EXPIRED'?'expired':'invalid',message:result.message};
  const p=result.payload,details={edition:p.edition,licensedTo:p.licensedTo,modules:p.modules,expiresAt:p.expiresAt,licenseId:p.licenseId,bound:!!p.binding};
  const last=Number(store.get('lastObservedTime')??0);
  if(p.expiresAt!==null&&now()+300<last)return {...base,...details,status:'clock',message:'Обнаружен откат часов более чем на 5 минут. Восстановите дату или запросите перевыпуск. Данные и экспорт доступны.'};
  store.set('lastObservedTime',String(Math.max(now(),last)));
  return {...base,...details,status:'active',message:'Подпись проверена. Лицензия действует.'};
}
function requireModule(module:LicenseModule):void {
  const l=licenseView();if(l.status!=='active'||!l.modules.includes(module))throw new Error(`Для нового действия требуется действующая лицензия с модулем «${module}». Данные и экспорт доступны.`);
}
function coordinateAccess(a:CoordinateAttempt):void {if(a.demo&&licenseView().status==='demo')return;requireModule(a.kind);}
function authorizeProject(p:CNCProject):true {
  const l=licenseView();
  if(l.status==='active'&&l.modules.includes(p.kind))return true;
  if(l.status==='demo'&&p.source===DEMO_SOURCES[p.kind]&&p.offset.x===0&&p.offset.y===0&&p.offset.z===0&&p.resolution===0.25&&isDefaultSetup(p.setup))return true;
  requireModule(p.kind);return true;
}
async function assessProject(exercise:Exercise,project:CNCProject):Promise<PracticeAttempt> {
  if(gradingWorker)throw new Error('Одна проверка уже выполняется. Дождитесь результата или отмените её.');
  const worker=new Worker(path.join(__dirname,'assessment.cjs'),{workerData:{id:randomUUID(),createdAt:Date.now(),exercise,project},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:32}});gradingWorker=worker;
  try {return await new Promise<PracticeAttempt>((resolve,reject)=>{
    const timeout=setTimeout(()=>{void worker.terminate();reject(new Error('Проверка превысила 30 секунд. Увеличьте шаг сетки.'));},30000);
    worker.once('message',(r:Result<PracticeAttempt>)=>{clearTimeout(timeout);if(r.ok)resolve(r.value);else reject(new Error(r.error));});
    worker.once('error',error=>{clearTimeout(timeout);reject(error);});
    worker.once('exit',()=>{clearTimeout(timeout);reject(new Error('Проверка практики отменена.'));});
  });}finally{await worker.terminate();if(gradingWorker===worker)gradingWorker=null;}
}
function readExam(id?:string){const a=store.exam(id);if(!a){if(id)throw new Error('Попытка не найдена в вашем профиле.');return null;}const next=tickExam(a,Date.now());store.saveExam(next);return next;}
function workshopKey(kind:'turning'|'milling'):string {return `workshop:${store.profileId}:${kind}`;}
function readWorkshop(kind:'turning'|'milling'):WorkshopState|null {const raw=store.get(workshopKey(kind));return raw?workshopStateSchema.parse(strictJSON(raw,{maxDepth:8,maxNodes:200})):null;}
function state():AppState {
  return {profile:store.profile(),completed:store.completed(),attempts:store.attempts(),project:store.project(),settings:{theme:store.get('theme')==='light'?'light':'dark',split:Math.min(75,Math.max(30,Number(store.get('split')??55)))},
    license:licenseView(),updates:updates.snapshot(),installationHash:installationHash(store.get('installationId')!),version:app.getVersion(),runtime:{electron:process.versions.electron??'',node:process.versions.node,abi:process.versions.modules}};
}
function sender(event:IpcMainInvokeEvent):void {
  if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url.split('#')[0]!==URL_ROOT)throw new Error('Недопустимый отправитель команды.');
}
function handle<T,U>(channel:string,schema:z.ZodType<T>,operation:(arg:T)=>Promise<U>|U):void {
  ipcMain.handle(channel,async(event,arg):Promise<Result<U>>=>{
    try {sender(event);if(restoring)throw new Error('Восстанавливаются данные. Приложение будет перезапущено.');return {ok:true,value:await operation(schema.parse(arg))};}
    catch(e) {try{store?.audit('ipc-error',channel);}catch{}return {ok:false,error:e instanceof z.ZodError?(e.issues.filter(issue=>issue.code==='custom').map(issue=>issue.message).join(' ')||'Параметры команды не соответствуют допустимому формату.'):e instanceof Error?e.message:'Операция не выполнена.'};}
  });
}
async function boundedRead(file:string,max:number):Promise<string> {
  if((await stat(file)).size>max)throw new Error(`Файл превышает допустимый размер ${max} байт.`);
  const buffer=await readFile(file);if(buffer.length>max)throw new Error('Файл вырос во время чтения.');
  return new TextDecoder('utf-8',{fatal:true}).decode(buffer);
}
async function save(text:string,extension:string,title:string):Promise<boolean> {
  const result=await dialog.showSaveDialog(win,{title,defaultPath:`FireCNC.${extension}`,filters:[{name:extension,extensions:[extension]}]});
  if(result.canceled||!result.filePath)return false;
  const temporary=result.filePath+`.${process.pid}.tmp`;
  await writeFile(temporary,text,{encoding:'utf8',flag:'wx',mode:0o600});await rename(temporary,result.filePath);return true;
}
function importLicense(text:string):LicenseView {
  const token=text.trim();const result=verifyLicense(token,__TRUSTED_KEYS__,{now:now(),installationHash:installationHash(store.get('installationId')!)});
  if(!result.ok)throw new Error(result.message);
  if(result.payload.expiresAt!==null&&now()+300<Number(store.get('lastObservedTime')??0))throw new Error('Исправьте системную дату перед импортом срочной лицензии.');
  store.set('license',token);return licenseView();
}
async function createWindow():Promise<void> {
  win=new BrowserWindow({width:1440,height:900,minWidth:800,minHeight:550,title:'FireCNC Academy',backgroundColor:'#10191c',autoHideMenuBar:true,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  win.webContents.on('will-prevent-unload',event=>{const choice=dialog.showMessageBoxSync(win,{type:'question',title:'Несохранённый проект',message:'Закрыть приложение без сохранения изменений?',buttons:['Остаться','Закрыть без сохранения'],defaultId:0,cancelId:0});if(choice===1)event.preventDefault();});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(e,url)=>{if(url.split('#')[0]!==URL_ROOT)e.preventDefault();});
  win.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  win.webContents.session.setPermissionCheckHandler(()=>false);
  await win.loadURL(URL_ROOT);
}
async function boot():Promise<void> {
  await app.whenReady();
  store=await Store.open(app.getPath('userData'));
  online=new OnlineLicensing({get:key=>store.get(key),set:(key,value)=>store.set(key,value),installationId:store.get('installationId')!,trust:__TRUSTED_KEYS__,request:(url,options)=>net.fetch(url instanceof URL?url.href:url,options),importToken:token=>{importLicense(token);},protect:{available:()=>safeStorage.isEncryptionAvailable()&&(process.platform!=='linux'||safeStorage.getSelectedStorageBackend()!=='basic_text'),encrypt:text=>safeStorage.encryptString(text),decrypt:bytes=>safeStorage.decryptString(bytes)}});
  updates=new UpdateChecker({version:app.getVersion(),source:releaseSource,automatic:store.get('autoCheckUpdates')!=='false',packaged:app.isPackaged,request:(url,options)=>net.fetch(url,options),onChange:value=>{if(win&&!win.isDestroyed())win.webContents.send('updates:changed',value);}});
  const uiRoot=path.resolve(__dirname,'../ui');
  protocol.handle('firecnc',request=>{
    const url=new URL(request.url);
    if(url.hostname==='report'&&request.method==='GET'){const html=reportHTML(url.pathname.slice(1));return new Response(html??'',{status:html?200:404,headers:{'content-type':'text/html; charset=utf-8'}});}
    if(url.hostname!=='app'||request.method!=='GET')return new Response('',{status:403});
    let file:string;try{file=path.resolve(uiRoot,'.'+decodeURIComponent(url.pathname));}catch{return new Response('',{status:400});}
    if(!file.startsWith(uiRoot+path.sep))return new Response('',{status:403});
    return net.fetch(pathToFileURL(file).href);
  });
  const empty=z.undefined();
  handle('state',empty,()=>state());
  handle('updateCheck',empty,()=>updates.check());
  handle('updateAutomatic',z.boolean(),value=>{store.set('autoCheckUpdates',String(value));return updates.setAutomatic(value);});
  handle('updateOpen',empty,async()=>{const url=updates.releaseURL();if(!url)throw new Error('Нет доступного нового выпуска. Сначала проверьте обновления.');await shell.openExternal(url);return true;});
  handle('profile',z.string().trim().min(1).max(80),name=>{store.rename(name);return state();});
  handle('profiles',empty,()=>store.profiles());
  handle('profileSelect',z.string().uuid(),id=>{if(gradingWorker||teachingWorker||camWorker)throw new Error('Дождитесь завершения расчёта.');store.selectProfile(id);return state();});
  handle('teacherStatus',empty,teacherStatus);
  handle('teacherConfigure',z.string().min(12).max(128),async password=>{requireModule('teacher');if(store.get('teacherPassword'))throw new Error('Пароль уже задан. Войдите с существующим паролем.');const record=await hashPassword(password);requireModule('teacher');if(store.get('teacherPassword'))throw new Error('Пароль уже задан.');store.set('teacherPassword',JSON.stringify(record));teacherUntil=performance.now()+1800000;store.audit('teacher-setup','Пароль настроен.');return teacherStatus();});
  handle('teacherUnlock',z.string().max(128),async password=>{
    if(performance.now()<unlockAfter)throw new Error('Слишком много попыток. Повторите через 30 секунд.');const record=store.get('teacherPassword');
    if(!record||!await checkPassword(password,JSON.parse(record))){if(++unlockFailures>=5){unlockAfter=performance.now()+30000;unlockFailures=0;}throw new Error('Пароль преподавателя не подходит.');}
    unlockFailures=0;teacherUntil=performance.now()+1800000;return teacherStatus();
  });
  handle('teacherLock',empty,()=>{teacherUntil=0;return teacherStatus();});
  handle('teacherData',empty,()=>{requireTeacher();return teacherData();});
  handle('teacherCreateProfile',z.string().trim().min(1).max(80),name=>{requireTeacher(true);store.createProfile(name);return teacherData();});
  handle('teacherSavePackage',teachingPackageSchema,async value=>{requireTeacher(true);const p=await validatePackage(value);requireTeacher(true);store.importTeaching(p);return teacherData();});
  handle('teacherImport',empty,async()=>{requireTeacher(true);const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Учебный пакет FireCNC',extensions:['fcnccontent','json']}]});if(r.canceled)return null;const p=await validatePackage(strictJSON(await boundedRead(r.filePaths[0]!,2000000),{maxDepth:15,maxNodes:50000}));requireTeacher(true);store.importTeaching(p);return teacherData();});
  handle('teacherExport',empty,()=>{requireTeacher();return save(JSON.stringify(store.teaching(),null,2),'fcnccontent','Экспорт собственных материалов');});
  handle('practiceCatalog',empty,()=>localContent().exercises);
  handle('camCurrent',empty,readCAM);
  handle('camSave',camDocumentSchema,document=>{requireModule('cadcam');const previous=readCAM();store.set(camKey(),JSON.stringify({document,result:previous&&JSON.stringify(previous.document)===JSON.stringify(document)?previous.result:null}));});
  handle('camGenerate',camDocumentSchema,async document=>{const kind=document.operation.startsWith('turn')?'turning':'milling';requireModule('cadcam');requireModule(kind);const result=await calculateCAM(document);requireModule('cadcam');requireModule(kind);store.set(camKey(),JSON.stringify({document,result}));return result;});
  handle('camCancel',empty,()=>{void camWorker?.terminate();});
  handle('camOpen',empty,()=>{requireModule('cadcam');const current=readCAM();if(!current?.result)throw new Error('Сначала постройте и проверьте программу.');requireModule(current.result.project.kind);store.saveProject(projectSchema.parse(current.result.project));return state();});
  handle('workshopCurrent',z.enum(['turning','milling']),readWorkshop);
  handle('workshopStart',z.enum(['turning','milling']),kind=>{requireModule(kind);const state=createWorkshop(kind,randomUUID());store.set(workshopKey(kind),JSON.stringify(state));return state;});
  handle('workshopAdvance',z.strictObject({id:z.string().uuid(),kind:z.enum(['turning','milling']),input:workshopInputSchema}),value=>{requireModule(value.kind);const current=readWorkshop(value.kind);if(!current||current.id!==value.id)throw new Error('Сценарий наладки изменился. Откройте его заново.');const next=advanceWorkshop(current,value.input);store.set(workshopKey(value.kind),JSON.stringify(next));return next;});
  handle('workshopBack',z.enum(['turning','milling']),kind=>{requireModule(kind);const current=readWorkshop(kind);if(!current)throw new Error('Начните наладку.');const next={...current,step:Math.max(0,current.step-1)};store.set(workshopKey(kind),JSON.stringify(next));return next;});
  handle('workshopProject',z.enum(['turning','milling']),kind=>{
    requireModule(kind);const current=readWorkshop(kind);if(!current||current.step!==6)throw new Error('Завершите все шаги наладки.');const errors=workshopErrors(kind,current.input);if(errors.length)throw new Error(errors.join(' '));
    const project=projectSchema.parse({version:2,toolSetId:'firecnc-basic-v1',name:'После учебной наладки',kind,source:DEMO_SOURCES[kind].replace(kind==='turning'?'S800':'S1600','S'+current.input.rpm),offset:current.input.offset,resolution:.25,setup:current.input.setup});store.saveProject(project);return state();
  });
  handle('coordinateCurrent',empty,()=>store.coordinate());
  handle('coordinateStart',z.strictObject({kind:z.enum(['turning','milling']),seed:z.number().int().min(0).max(0xffffffff).optional()}),value=>{
    const demo=licenseView().status==='demo';
    if(demo&&value.kind!=='turning')requireModule(value.kind);
    if(!demo)requireModule(value.kind);
    const attempt=createCoordinateAttempt({id:randomUUID(),kind:value.kind,seed:demo?2026:value.seed??randomBytes(4).readUInt32LE(),now:Date.now(),demo});
    store.saveCoordinate(attempt);return attempt;
  });
  handle('coordinateAnswer',z.strictObject({id:z.string().uuid(),values:z.partialRecord(z.enum(['x','y','z']),z.string().max(32))}),value=>{
    const current=store.coordinate(value.id);if(!current)throw new Error('Попытка не найдена в вашем профиле.');coordinateAccess(current);
    const result=answerCoordinate(current,value.values as Record<string,string>,Date.now());store.saveCoordinate(result);return result;
  });
  handle('coordinateNext',z.string().uuid(),id=>{const current=store.coordinate(id);if(!current)throw new Error('Попытка не найдена.');coordinateAccess(current);const result=advanceCoordinate(current);store.saveCoordinate(result);return result;});
  handle('measurementCurrent',empty,()=>store.measurement());
  handle('measurementHistory',empty,()=>store.measurementHistory());
  handle('measurementStart',z.strictObject({kind:instrumentKind,mode:measurementMode,seed:z.number().int().min(0).max(0xffffffff).optional()}),value=>{
    if(value.mode!=='explain')requireModule('measurements');
    const a=createMeasurementAttempt({id:randomUUID(),kind:value.kind,mode:value.mode,seed:value.seed??randomBytes(4).readUInt32LE(),now:Date.now()});store.saveMeasurement(a);return a;
  });
  handle('measurementAnswer',z.strictObject({id:z.string().uuid(),value:z.string().max(32)}),value=>{
    requireModule('measurements');const a=store.measurement(value.id);if(!a)throw new Error('Попытка измерения не найдена.');const next=answerMeasurement(a,value.value,Date.now());store.saveMeasurement(next);return next;
  });
  handle('measurementNext',z.string().uuid(),id=>{requireModule('measurements');const a=store.measurement(id);if(!a)throw new Error('Попытка измерения не найдена.');const next=advanceMeasurement(a);store.saveMeasurement(next);return next;});
  handle('examCatalog',empty,()=>({definitions:[...examDefinitions,...localContent().exams],topics:lessons.map(l=>({id:l.id,title:l.title,course:l.course}))}));
  handle('examCurrent',empty,()=>{const a=readExam();return a?examView(a):null;});
  handle('examGet',z.string().uuid(),id=>examView(readExam(id)!));
  handle('examStart',z.strictObject({definitionId:z.string().max(80),seed:z.number().int().min(0).max(0xffffffff).optional(),count:z.number().int().min(1).max(50).optional(),durationSeconds:z.number().int().min(60).max(7200).optional(),passingScore:z.number().min(0).max(100).optional(),topics:z.array(z.string().max(80)).min(1).max(30).optional(),hints:z.boolean().optional()}),value=>{
    requireModule('exams');const previous=readExam();if(previous?.status==='active')throw new Error('Сначала продолжите или завершите текущую попытку.');
    const template=[...examDefinitions,...localContent().exams].find(d=>d.id===value.definitionId);if(!template)throw new Error('Определение экзамена не найдено.');
    if(store.examCount(template.id)>=template.maxAttempts)throw new Error(`Для этого теста установлен предел ${template.maxAttempts} попыток. Выберите другой учебный тест.`);
    const definition={...template,...Object.fromEntries(Object.entries(value).filter(([key])=>!['definitionId','seed'].includes(key)))};
    const a=createExam({id:randomUUID(),definition,seed:value.seed??randomBytes(4).readUInt32LE(),now:Date.now(),bank:localContent().questions});store.saveExam(a);return examView(a);
  });
  handle('examAnswer',z.strictObject({id:z.string().uuid(),questionId:z.string().max(80),answer:examAnswerSchema}),value=>{requireModule('exams');const next=answerExam(readExam(value.id)!,value.questionId,value.answer,Date.now());store.saveExam(next);return examView(next);});
  handle('examNavigate',z.strictObject({id:z.string().uuid(),index:z.number().int().min(0).max(49)}),value=>{const next=navigateExam(readExam(value.id)!,value.index,Date.now());store.saveExam(next);return examView(next);});
  handle('examFinish',z.string().uuid(),id=>{const next=finishExam(readExam(id)!,Date.now());store.saveExam(next);return examView(next);});
  handle('examHint',z.strictObject({id:z.string().uuid(),questionId:z.string().max(80)}),value=>{requireModule('exams');const a=useExamHint(readExam(value.id)!,value.questionId,Date.now());store.saveExam(a);const q=a.questions.find(q=>q.id===value.questionId)!;return {attempt:examView(a),hint:lessons.find(l=>l.id===q.lessonId)?.objective??'Вспомните связанные темы.'};});
  handle('examExportPdf',z.string().uuid(),async id=>{
    const view=examView(readExam(id)!);if(!view.review)throw new Error('Сначала завершите попытку.');
    const result=await dialog.showSaveDialog(win,{title:'PDF-отчёт экзамена',defaultPath:'FireCNC-exam.pdf',filters:[{name:'PDF',extensions:['pdf']}]});if(result.canceled||!result.filePath)return false;
    const pdf=await renderExamPdf(view,store.profile().name),temporary=result.filePath+`.${process.pid}.tmp`;
    await writeFile(temporary,pdf,{flag:'wx',mode:0o600});await rename(temporary,result.filePath);return true;
  });
  handle('examHistory',empty,()=>store.examHistory().map(a=>{const view=examView(a);return {id:a.id,title:a.definition.title,createdAt:a.createdAt,status:a.status,score:view.review?.score??null,passed:view.review?.passed??null};}));
  handle('settings',z.strictObject({theme:z.enum(['dark','light']),split:z.number().min(30).max(75)}),s=>{store.set('theme',s.theme);store.set('split',String(s.split));});
  handle('lessonCheckStart',z.string().max(80),id=>{
    requireModule('exams');const lesson=lessons.find(l=>l.id===id);if(!lesson)throw new Error('Тема не найдена.');
    if(readExam()?.status==='active')throw new Error('У вас есть незавершённая попытка. Откройте раздел «Экзамены», чтобы продолжить её.');
    const definition={id:'lesson-'+id,version:1,title:'Проверка темы: '+lesson.title,course:lesson.course,count:Math.min(5,examBank.filter(q=>q.lessonId===id).length),durationSeconds:300,passingScore:70,topics:[id],hints:true,maxAttempts:100};
    if(store.examCount(definition.id)>=definition.maxAttempts)throw new Error('Достигнут предел попыток этой темы.');
    const a=createExam({id:randomUUID(),definition,seed:randomBytes(4).readUInt32LE(),now:Date.now()});store.saveExam(a);return examView(a);
  });
  handle('lessonComplete',z.string().max(80),id=>{if(!lessons.some(l=>l.id===id))throw new Error('Урок не найден.');if(id!==lessons[0]!.id)requireModule('theory');store.complete(id);return state();});
  handle('quizSubmit',z.record(z.string().max(80),z.array(z.string().regex(/^[0-7]$/)).max(8)).refine(a=>Object.keys(a).length===introQuestions.length&&introQuestions.every(q=>Object.hasOwn(a,q.id))),a=>{store.submit(a);return state();});
  handle('projectSave',projectSchema,p=>{requireModule(p.kind);store.saveProject(p);});
  handle('authorizeSimulation',projectSchema,authorizeProject);
  handle('practiceHistory',empty,()=>store.practiceHistory());
  handle('practiceCancel',empty,()=>{void gradingWorker?.terminate();});
  handle('practiceSubmit',z.strictObject({exerciseId:z.string().max(80),project:projectSchema}),async value=>{
    const e=localContent().exercises.find(e=>e.id===value.exerciseId&&e.kind===value.project.kind);if(!e)throw new Error('Задание не найдено для этого станка.');
    authorizeProject(value.project);
    if(licenseView().status==='demo'&&!['turn-shaft','mill-slot'].includes(e.id))requireModule(value.project.kind);
    const result=await assessProject(e,value.project);store.savePractice(result);return result;
  });
  handle('programOpen',empty,async()=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Программа ЧПУ (UTF-8)',extensions:['nc','tap','txt']} ]});return r.canceled?null:boundedRead(r.filePaths[0]!,400000);});
  handle('programSave',z.string().max(200000),s=>save(s,'nc','Сохранить исходную программу (FireCNC DIN, учебная)'));
  handle('projectExport',projectSchema,p=>save(JSON.stringify(p,null,2),'fcncproject','Экспортировать учебный проект'));
  handle('projectImport',empty,async()=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Учебный проект',extensions:['fcncproject']}]});if(r.canceled)return null;return projectSchema.parse(strictJSON(await boundedRead(r.filePaths[0]!,500000)));});
  handle('licenseImport',z.string().max(12000),importLicense);
  handle('onlineStatus',empty,()=>online.view());
  handle('onlineActivate',z.strictObject({endpoint:z.string().trim().min(1).max(500),key:z.string().trim().min(1).max(80)}),value=>online.activate(value.endpoint,value.key));
  handle('onlineRenew',empty,()=>online.renew());
  handle('onlineDeactivate',empty,()=>online.deactivate());
  handle('licenseOpen',empty,async()=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Лицензия FireCNC',extensions:['fcnclic']}]});return r.canceled?null:importLicense(await boundedRead(r.filePaths[0]!,12000));});
  handle('licenseExport',empty,()=>{const token=store.get('license');if(!token)throw new Error('Нет импортированной лицензии.');return save(token+'\n','fcnclic','Экспортировать лицензию');});
  handle('activationRequest',empty,()=>save(JSON.stringify({version:1,productId:'firecnc-academy',installationHash:installationHash(store.get('installationId')!)},null,2),'json','Сохранить запрос для владельца'));
  handle('exportResults',empty,()=>save(JSON.stringify({version:2,profile:store.profile(),completed:store.completed(),attempts:store.attempts(true),coordinateAttempts:store.coordinateHistory(true),practiceAttempts:store.practiceHistory(true),measurementAttempts:store.measurementHistory(true),examAttempts:store.examHistory(true).map(examView)},null,2),'json','Экспортировать результаты'));
  handle('backup',empty,async()=>{const r=await dialog.showSaveDialog(win,{title:'Согласованная резервная копия SQLite',defaultPath:'FireCNC-backup.sqlite'});if(r.canceled||!r.filePath)return false;await store.backup(r.filePath);return true;});
  handle('diagnosticsExport',empty,()=>{
    const license=licenseView(),report={format:'firecnc-diagnostics',version:1,createdAt:new Date().toISOString(),appVersion:app.getVersion(),platform:process.platform,arch:process.arch,runtime:{electron:process.versions.electron,node:process.versions.node,abi:process.versions.modules},databaseVersion:store.db.pragma('user_version',{simple:true}),profileCount:store.profiles().length,license:{status:license.status,edition:license.edition,modules:license.modules,expiresAt:license.expiresAt,bound:license.bound},updates:{status:updates.snapshot().status},recentEvents:store.db.prepare('SELECT created_at,action FROM audit ORDER BY id DESC LIMIT 100').all()};
    return save(JSON.stringify(redactDiagnostics(report),null,2),'json','Экспорт диагностики без секретов');
  });
  handle('restoreBackup',empty,async()=>{
    if(gradingWorker||teachingWorker||camWorker||online.view().busy)throw new Error('Дождитесь завершения расчёта или активации перед восстановлением.');
    const r=await dialog.showOpenDialog(win,{title:'Восстановить резервную копию FireCNC',properties:['openFile'],filters:[{name:'SQLite backup',extensions:['sqlite']}]});if(r.canceled)return false;
    const file=r.filePaths[0]!,directory=app.getPath('userData'),database=path.join(directory,'academy.sqlite');
    const normalize=(v:string)=>process.platform==='win32'?path.resolve(v).toLowerCase():path.resolve(v);if(normalize(file)===normalize(database))throw new Error('Выберите отдельную резервную копию, а не открытую рабочую БД.');
    const confirmed=await dialog.showMessageBox(win,{type:'warning',title:'Восстановление данных',message:'Заменить локальные данные выбранной резервной копией?',detail:'Файл: '+file+'\nТекущие данные сначала сохранятся в before-restore-*.sqlite в пользовательском каталоге. Приложение будет перезапущено. Более новые изменения останутся в этой защитной копии.',buttons:['Отмена','Сохранить текущие и восстановить'],defaultId:0,cancelId:0});if(confirmed.response!==1)return false;
    if(gradingWorker||teachingWorker||camWorker||online.view().busy)throw new Error('Дождитесь завершения текущей операции и повторите восстановление.');
    restoring=true;let candidate:string|undefined,closed=false;
    try{
      candidate=await prepareRestore(file,directory);await store.backup(path.join(directory,`before-restore-${Date.now()}-${randomUUID()}.sqlite`));
      clearInterval(renewTimer);store.db.pragma('wal_checkpoint(TRUNCATE)');store.close();closed=true;
      await unlink(database+'-wal').catch(()=>{});await unlink(database+'-shm').catch(()=>{});await rename(candidate,database);candidate=undefined;
      updates.stop();app.relaunch();setTimeout(()=>app.exit(0),150);return true;
    }catch(error){if(candidate)await unlink(candidate).catch(()=>{});if(closed){store=await Store.open(directory);renewTimer=setInterval(automaticRenew,6*60*60*1000);renewTimer.unref();}restoring=false;throw error;}
  });
  await createWindow();
  updates.start();
  automaticRenew();renewTimer=setInterval(automaticRenew,6*60*60*1000);renewTimer.unref();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)void createWindow();});
}
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('will-quit',()=>{updates?.stop();clearInterval(renewTimer);void gradingWorker?.terminate();void teachingWorker?.terminate();void camWorker?.terminate();store?.close();});
if(!app.requestSingleInstanceLock())app.quit();else void boot().catch(e=>{dialog.showErrorBox('FireCNC Academy',e instanceof Error?e.message:'Ошибка запуска.');app.quit();});
app.on('second-instance',()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.focus();}});
