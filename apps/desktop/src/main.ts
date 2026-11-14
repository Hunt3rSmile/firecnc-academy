import {app,BrowserWindow,ipcMain,protocol,net,dialog,shell,type IpcMainInvokeEvent} from 'electron';
import {readFile,writeFile,stat,rename} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {Store} from './store';
import {installationHash,verifyLicense,strictJSON,type TrustStore} from '@firecnc/licensing';
import {projectSchema,DEMO_SOURCES,type LicenseView,type LicenseModule,type AppState,type Result} from '@firecnc/contracts';
import {lessons,introQuestions} from '@firecnc/learning';
import {UpdateChecker} from './updates';
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
function state():AppState {
  return {profile:store.profile(),completed:store.completed(),attempts:store.attempts(),project:store.project(),settings:{theme:store.get('theme')==='light'?'light':'dark',split:Math.min(75,Math.max(30,Number(store.get('split')??55)))},
    license:licenseView(),updates:updates.snapshot(),installationHash:installationHash(store.get('installationId')!),version:app.getVersion(),runtime:{electron:process.versions.electron??'',node:process.versions.node,abi:process.versions.modules}};
}
function sender(event:IpcMainInvokeEvent):void {
  if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url.split('#')[0]!==URL_ROOT)throw new Error('Недопустимый отправитель команды.');
}
function handle<T,U>(channel:string,schema:z.ZodType<T>,operation:(arg:T)=>Promise<U>|U):void {
  ipcMain.handle(channel,async(event,arg):Promise<Result<U>>=>{
    try {sender(event);return {ok:true,value:await operation(schema.parse(arg))};}
    catch(e) {return {ok:false,error:e instanceof z.ZodError?'Параметры команды не соответствуют допустимому формату.':e instanceof Error?e.message:'Операция не выполнена.'};}
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
  updates=new UpdateChecker({version:app.getVersion(),source:releaseSource,automatic:store.get('autoCheckUpdates')!=='false',packaged:app.isPackaged,request:(url,options)=>net.fetch(url,options),onChange:value=>{if(win&&!win.isDestroyed())win.webContents.send('updates:changed',value);}});
  const uiRoot=path.resolve(__dirname,'../ui');
  protocol.handle('firecnc',request=>{
    const url=new URL(request.url);
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
  handle('settings',z.strictObject({theme:z.enum(['dark','light']),split:z.number().min(30).max(75)}),s=>{store.set('theme',s.theme);store.set('split',String(s.split));});
  handle('lessonComplete',z.string().max(80),id=>{if(!lessons.some(l=>l.id===id))throw new Error('Урок не найден.');if(id!==lessons[0]!.id)requireModule('theory');store.complete(id);return state();});
  handle('quizSubmit',z.record(z.string().max(80),z.array(z.string().regex(/^[0-7]$/)).max(8)).refine(a=>Object.keys(a).length===introQuestions.length&&introQuestions.every(q=>Object.hasOwn(a,q.id))),a=>{store.submit(a);return state();});
  handle('projectSave',projectSchema,p=>{requireModule(p.kind);store.saveProject(p);});
  handle('authorizeSimulation',projectSchema,p=>{
    const l=licenseView();
    if(l.status==='active'&&l.modules.includes(p.kind))return true as const;
    if(l.status==='demo'&&p.source===DEMO_SOURCES[p.kind]&&p.offset.x===0&&p.offset.y===0&&p.offset.z===0&&p.resolution===0.25)return true as const;
    requireModule(p.kind);return true as const;
  });
  handle('programOpen',empty,async()=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Программа ЧПУ (UTF-8)',extensions:['nc','tap','txt']} ]});return r.canceled?null:boundedRead(r.filePaths[0]!,400000);});
  handle('programSave',z.string().max(200000),s=>save(s,'nc','Сохранить исходную программу (FireCNC DIN, учебная)'));
  handle('projectExport',projectSchema,p=>save(JSON.stringify(p,null,2),'fcncproject','Экспортировать учебный проект'));
  handle('projectImport',empty,async()=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Учебный проект',extensions:['fcncproject']}]});if(r.canceled)return null;return projectSchema.parse(strictJSON(await boundedRead(r.filePaths[0]!,500000)));});
  handle('licenseImport',z.string().max(12000),importLicense);
  handle('licenseOpen',empty,async()=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Лицензия FireCNC',extensions:['fcnclic']}]});return r.canceled?null:importLicense(await boundedRead(r.filePaths[0]!,12000));});
  handle('licenseExport',empty,()=>{const token=store.get('license');if(!token)throw new Error('Нет импортированной лицензии.');return save(token+'\n','fcnclic','Экспортировать лицензию');});
  handle('activationRequest',empty,()=>save(JSON.stringify({version:1,productId:'firecnc-academy',installationHash:installationHash(store.get('installationId')!)},null,2),'json','Сохранить запрос для владельца'));
  handle('exportResults',empty,()=>save(JSON.stringify({version:1,profile:store.profile(),completed:store.completed(),attempts:store.attempts()},null,2),'json','Экспортировать результаты'));
  handle('backup',empty,async()=>{const r=await dialog.showSaveDialog(win,{title:'Согласованная резервная копия SQLite',defaultPath:'FireCNC-backup.sqlite'});if(r.canceled||!r.filePath)return false;await store.backup(r.filePath);return true;});
  await createWindow();
  updates.start();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)void createWindow();});
}
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('will-quit',()=>{updates?.stop();store?.close();});
void boot().catch(e=>{dialog.showErrorBox('FireCNC Academy',e instanceof Error?e.message:'Ошибка запуска.');app.quit();});
