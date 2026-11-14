import {readFile,writeFile,mkdir,chmod,stat} from 'node:fs/promises';
import path from 'node:path';
import {createPrivateKey,randomBytes} from 'node:crypto';
import Database from 'better-sqlite3';
import {z} from 'zod';
import {parseArgs} from 'node:util';
import {createActivationServer,serverLicenseSchema} from './server';
import {newKeys} from '../../../tools/license-issuer/src/issuer';
import {strictJSON} from '@firecnc/licensing';
const configSchema=z.strictObject({version:z.literal(1),privateKeyFile:z.string().min(1),database:z.string().min(1),adminToken:z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),port:z.number().int().min(1024).max(65535),leaseSeconds:z.number().int().min(60).max(604800),proxy:z.boolean()});
const {positionals,values}=parseArgs({allowPositionals:true,options:{config:{type:'string'},dir:{type:'string'},key:{type:'string'},customer:{type:'string'},edition:{type:'string'},modules:{type:'string'},days:{type:'string'},seats:{type:'string'},id:{type:'string'},output:{type:'string'}}});
const command=positionals[0],directory=path.resolve(values.dir??'.local/activation'),configFile=path.resolve(values.config??path.join(directory,'config.json'));
async function main(){
  if(command==='setup'){
    try{await stat(configFile);throw new Error('Конфигурация уже существует. Она не будет перезаписана.');}catch(error){if(!(error instanceof Error&&'code' in error&&error.code==='ENOENT'))throw error;}
    await mkdir(path.dirname(configFile),{recursive:true,mode:0o700});
    let privateKeyFile=values.key?path.resolve(values.key):path.join(path.dirname(configFile),'server-private.pem');
    if(values.key)await stat(privateKeyFile);else{const pair=newKeys();await writeFile(privateKeyFile,pair.privatePem,{flag:'wx',mode:0o600});await writeFile(path.join(path.dirname(configFile),'server-public.pem'),pair.publicPem,{flag:'wx',mode:0o600});}
    const config={version:1,privateKeyFile,database:path.join(path.dirname(configFile),'activation.sqlite'),adminToken:randomBytes(32).toString('base64url'),port:3679,leaseSeconds:604800,proxy:false};
    await writeFile(configFile,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});console.log('Конфигурация создана: '+configFile+'\nАдминистративный токен сохранён только в этом файле. Сервер слушает localhost.');return;
  }
  const config=configSchema.parse(strictJSON(await readFile(configFile,'utf8')));
  if(command==='start'){
    await mkdir(path.dirname(config.database),{recursive:true,mode:0o700});
    const key=createPrivateKey({key:await readFile(config.privateKeyFile,'utf8'),format:'pem',passphrase:process.env.FCNC_SIGNING_PASSWORD});
    const db=new Database(config.database);if(process.platform!=='win32')await chmod(config.database,0o600);
    const server=await createActivationServer({db,privateKey:key,adminToken:config.adminToken,leaseSeconds:config.leaseSeconds,proxy:config.proxy});
    const close=async()=>{await server.close();db.close();};process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());await server.listen({host:'127.0.0.1',port:config.port});console.log(`FireCNC activation: http://127.0.0.1:${config.port}`);return;
  }
  if(command==='backup'){
    if(!values.output)throw new Error('Укажите --output для согласованной копии SQLite.');
    const file=path.resolve(values.output);try{await stat(file);throw new Error('Файл назначения уже существует.');}catch(error){if(!(error instanceof Error&&'code' in error&&error.code==='ENOENT'))throw error;}
    const db=new Database(config.database,{readonly:true});try{await db.backup(file);if(process.platform!=='win32')await chmod(file,0o600);}finally{db.close();}console.log('Согласованная копия БД сохранена. Закрытый ключ скопируйте отдельно в защищённое хранилище.');return;
  }
  const request=async(method:string,route:string,body?:unknown)=>{
    const response=await fetch(`http://127.0.0.1:${config.port}${route}`,{method,headers:{authorization:'Bearer '+config.adminToken,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000),redirect:'error'});
    if(!response.ok)throw new Error('Сервер отклонил запрос ('+response.status+').');return await response.json() as Record<string,unknown>;
  };
  if(command==='create'){
    const edition=values.edition??'student',data=serverLicenseSchema.parse({licensedTo:values.customer??'',edition,...(values.modules?{modules:values.modules.split(',')}:{}),maxInstallations:Number(values.seats??1),expiresAt:values.days?Math.floor(Date.now()/1000)+Number(values.days)*86400:null});
    const result=await request('POST','/admin/licenses',data),text=JSON.stringify(result,null,2)+'\n';
    if(values.output){await writeFile(values.output,text,{flag:'wx',mode:0o600});console.log('Короткий ключ сохранён в указанный файл. Сервер хранит только хеш.');}else console.log(text);return;
  }
  if(command==='list'){console.log(JSON.stringify(await request('GET','/admin/licenses'),null,2));return;}
  const id=z.string().uuid().parse(values.id);
  if(command==='show'){console.log(JSON.stringify(await request('GET',`/admin/licenses/${id}`),null,2));return;}
  if(command==='revoke'||command==='limit'){console.log(JSON.stringify(await request('PATCH',`/admin/licenses/${id}`,command==='revoke'?{status:'revoked'}:{maxInstallations:Number(values.seats)})));return;}
  if(command==='reset'){console.log(JSON.stringify(await request('POST',`/admin/activations/${id}/reset`)));return;}
  throw new Error('Команды: setup, start, create, list, show, limit, revoke, reset, backup.');
}
void main().catch(error=>{console.error(error instanceof z.ZodError?'Проверьте параметры команды или конфигурацию.':error instanceof Error?error.message:'Сервер не запущен.');process.exitCode=1;});
