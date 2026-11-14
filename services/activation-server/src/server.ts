import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import Database from 'better-sqlite3';
import {createPrivateKey,createPublicKey,randomUUID,type KeyObject} from 'node:crypto';
import {z} from 'zod';
import {MODULES,EDITIONS} from '@firecnc/contracts';
import {keyId,installationHash,signLicense,strictJSON,type LicensePayload} from '@firecnc/licensing';
import {newActivationKey,normalizeActivationKey,secretHash,sameSecretHash} from '../../../packages/licensing/src/activation';
const time=z.number().int().min(0).max(4102444800);
export const serverLicenseSchema=z.strictObject({licensedTo:z.string().trim().min(1).max(160),edition:z.enum(['student','teacher','lab']),modules:z.array(z.enum(MODULES)).min(1).max(7).refine(v=>new Set(v).size===v.length).optional(),expiresAt:time.nullable(),notBefore:time.optional(),maxInstallations:z.number().int().min(1).max(500)});
type ServerLicense={id:string;key_hash:string;document:string;status:string;max_installations:number};
type Activation={id:string;license_id:string;installation_hash:string;secret_hash:string;active:number;blocked:number;lease_until:number};
export interface ServerOptions {db:Database.Database;privateKey:KeyObject;adminToken:string;leaseSeconds?:number;clock?:()=>number;rateMax?:number;proxy?:boolean}
export async function createActivationServer(options:ServerOptions) {
  if(options.privateKey.asymmetricKeyType!=='ed25519'||options.privateKey.type!=='private'||!/^[A-Za-z0-9_-]{43,128}$/.test(options.adminToken))throw new Error('Нужны Ed25519 и отдельный случайный административный токен не менее 32 байт.');
  const leaseSeconds=options.leaseSeconds??7*86400;if(!Number.isInteger(leaseSeconds)||leaseSeconds<60||leaseSeconds>7*86400)throw new Error('Автономное разрешение: от 60 секунд до 7 суток.');
  const {db}=options,clock=options.clock??(()=>Math.floor(Date.now()/1000)),signingId=keyId(createPublicKey(options.privateKey));
  db.pragma('journal_mode = WAL');db.pragma('foreign_keys = ON');db.pragma('busy_timeout = 5000');
  const version=db.pragma('user_version',{simple:true}) as number;if(version>1)throw new Error('Версия серверной БД новее программы.');
  if(version===0)db.transaction(()=>db.exec(`CREATE TABLE licenses(id TEXT PRIMARY KEY,key_hash TEXT UNIQUE NOT NULL,document TEXT NOT NULL,status TEXT NOT NULL,max_installations INTEGER NOT NULL CHECK(max_installations>0));
    CREATE TABLE activations(id TEXT PRIMARY KEY,license_id TEXT NOT NULL REFERENCES licenses(id),installation_hash TEXT NOT NULL,secret_hash TEXT NOT NULL,active INTEGER NOT NULL,blocked INTEGER NOT NULL,lease_until INTEGER NOT NULL,UNIQUE(license_id,installation_hash));
    CREATE TABLE audit(id INTEGER PRIMARY KEY,created_at INTEGER NOT NULL,action TEXT NOT NULL,subject TEXT NOT NULL);
    PRAGMA user_version=1;`))();
  const audit=(action:string,id:string)=>{db.prepare('INSERT INTO audit(created_at,action,subject) VALUES (?,?,?)').run(clock(),action,id);db.prepare('DELETE FROM audit WHERE id NOT IN (SELECT id FROM audit ORDER BY id DESC LIMIT 10000)').run();};
  const app=Fastify({bodyLimit:16000,logger:false,trustProxy:options.proxy?['127.0.0.1','::1']:false});
  app.removeContentTypeParser('application/json');app.addContentTypeParser('application/json',{parseAs:'string'},(_request,body,done)=>{try{done(null,strictJSON(String(body),{maxDepth:6,maxNodes:150}));}catch{done(Object.assign(new Error('Некорректный JSON.'),{statusCode:400}));}});
  await app.register(rateLimit,{max:options.rateMax??60,timeWindow:60000});
  app.setErrorHandler((error,_request,reply)=>{const code=error instanceof z.ZodError?400:typeof error==='object'&&error&&'statusCode' in error?Number(error.statusCode):500;void reply.code([400,401,403,404,409,413,429].includes(code)?code:500).send({error:code===429?'Слишком много запросов. Повторите позже.':code===403?'Активация недоступна. Проверьте ключ и обратитесь к владельцу.':code===401?'Нужна административная аутентификация.':code===400?'Проверьте формат запроса.':'Запрос не выполнен.'});});
  app.addHook('onRequest',async(request,reply)=>{reply.header('cache-control','no-store');if(request.url.startsWith('/admin/')){const token=request.headers.authorization?.replace(/^Bearer /,'')??'';if(!sameSecretHash(secretHash('admin',token),secretHash('admin',options.adminToken)))throw Object.assign(new Error(),{statusCode:401});}});
  app.get('/health',()=>({ok:true,service:'firecnc-activation',version:1}));
  const unavailable=():never=>{throw Object.assign(new Error(),{statusCode:403});};
  const occupied=(license:string)=>Number((db.prepare('SELECT COUNT(*) n FROM activations WHERE license_id=? AND (active=1 OR lease_until>?)').get(license,clock()) as {n:number}).n);
  const issue=(license:ServerLicense,activation:Activation)=>{
    const source=serverLicenseSchema.parse(JSON.parse(license.document)),now=clock();if(license.status!=='active'||(source.notBefore??0)>now||source.expiresAt!==null&&source.expiresAt<=now||!activation.active||activation.blocked)unavailable();
    const expiresAt=Math.min(now+leaseSeconds,source.expiresAt??4102444800),payload:LicensePayload={version:1,productId:'firecnc-academy',kind:'lease',licenseId:license.id,keyId:signingId,licensedTo:source.licensedTo,edition:source.edition,modules:source.modules??EDITIONS[source.edition],issuedAt:now,notBefore:now,expiresAt,binding:{installationHash:activation.installation_hash},activationId:activation.id};
    const token=signLicense(payload,options.privateKey);db.prepare('UPDATE activations SET lease_until=MAX(lease_until,?) WHERE id=?').run(expiresAt,activation.id);return {token,activationId:activation.id,expiresAt};
  };
  const activationSchema=z.strictObject({key:z.string().max(80),installationId:z.string().uuid(),secret:z.string().regex(/^[A-Za-z0-9_-]{43}$/)});
  app.post('/v1/activate',{config:{rateLimit:{max:options.rateMax??10,timeWindow:60000}}},request=>{
    const value=activationSchema.parse(request.body);let normalized:string;try{normalized=normalizeActivationKey(value.key);}catch{return unavailable();}
    return db.transaction(()=>{
      const license=db.prepare('SELECT * FROM licenses WHERE key_hash=?').get(secretHash('activation-key',normalized)) as ServerLicense|undefined;if(!license)unavailable();
      const hash=installationHash(value.installationId),secret=secretHash('installation-secret',value.secret),previous=db.prepare('SELECT * FROM activations WHERE license_id=? AND installation_hash=?').get(license!.id,hash) as Activation|undefined;
      if(previous&&!previous.blocked&&sameSecretHash(previous.secret_hash,secret)){
        if(!previous.active){if(previous.lease_until<=clock()&&occupied(license!.id)>=license!.max_installations)unavailable();db.prepare('UPDATE activations SET active=1 WHERE id=?').run(previous.id);previous.active=1;}
        return issue(license!,previous);
      }
      if(previous&&(previous.active||previous.lease_until>clock()))unavailable();
      if(occupied(license!.id)>=license!.max_installations)unavailable();
      if(previous)db.prepare('DELETE FROM activations WHERE id=?').run(previous.id);
      const activation:Activation={id:randomUUID(),license_id:license!.id,installation_hash:hash,secret_hash:secret,active:1,blocked:0,lease_until:0};
      db.prepare('INSERT INTO activations VALUES (@id,@license_id,@installation_hash,@secret_hash,@active,@blocked,@lease_until)').run(activation);audit('activate',activation.id);return issue(license!,activation);
    }).immediate();
  });
  const ownSchema=z.strictObject({activationId:z.string().uuid(),installationId:z.string().uuid(),secret:z.string().regex(/^[A-Za-z0-9_-]{43}$/)});
  const own=(body:unknown)=>{const v=ownSchema.parse(body),a=db.prepare('SELECT * FROM activations WHERE id=? AND installation_hash=?').get(v.activationId,installationHash(v.installationId)) as Activation|undefined;if(!a||!sameSecretHash(a.secret_hash,secretHash('installation-secret',v.secret)))unavailable();return a!;};
  app.post('/v1/renew',request=>db.transaction(()=>{const a=own(request.body),license=db.prepare('SELECT * FROM licenses WHERE id=?').get(a.license_id) as ServerLicense;return issue(license,a);}).immediate());
  app.post('/v1/deactivate',request=>db.transaction(()=>{const a=own(request.body);db.prepare('UPDATE activations SET active=0 WHERE id=?').run(a.id);audit('deactivate',a.id);return {ok:true,reservedUntil:a.lease_until};}).immediate());
  app.post('/admin/licenses',request=>{
    const value=serverLicenseSchema.parse(request.body),now=clock();if(value.expiresAt!==null&&value.expiresAt<=Math.max(now,value.notBefore??now))throw Object.assign(new Error(),{statusCode:400});
    const key=newActivationKey(),id=randomUUID();db.transaction(()=>{db.prepare('INSERT INTO licenses VALUES (?,?,?,?,?)').run(id,secretHash('activation-key',normalizeActivationKey(key)),JSON.stringify({...value,modules:value.modules??EDITIONS[value.edition],notBefore:value.notBefore??now}),'active',value.maxInstallations);audit('license-create',id);}).immediate();
    return {id,key,message:'Сохраните ключ сейчас. Сервер хранит только его хеш.'};
  });
  const licenseView=(r:ServerLicense)=>({id:r.id,...serverLicenseSchema.parse(JSON.parse(r.document)),status:r.status,maxInstallations:r.max_installations,occupied:occupied(r.id),activations:(db.prepare('SELECT id,installation_hash,active,blocked,lease_until FROM activations WHERE license_id=?').all(r.id))});
  app.get('/admin/licenses',()=>({licenses:(db.prepare('SELECT * FROM licenses ORDER BY rowid DESC LIMIT 500').all() as ServerLicense[]).map(licenseView)}));
  app.get('/admin/licenses/:id',request=>{const id=z.object({id:z.string().uuid()}).parse(request.params).id,row=db.prepare('SELECT * FROM licenses WHERE id=?').get(id) as ServerLicense|undefined;if(!row)throw Object.assign(new Error(),{statusCode:404});return licenseView(row);});
  app.patch('/admin/licenses/:id',request=>{
    const id=z.object({id:z.string().uuid()}).parse(request.params).id,value=z.strictObject({status:z.enum(['active','revoked']).optional(),maxInstallations:z.number().int().min(1).max(500).optional()}).refine(v=>Object.keys(v).length>0).parse(request.body);
    db.transaction(()=>{const row=db.prepare('SELECT * FROM licenses WHERE id=?').get(id) as ServerLicense|undefined;if(!row)throw Object.assign(new Error(),{statusCode:404});if(value.maxInstallations!==undefined&&value.maxInstallations<occupied(id))throw Object.assign(new Error(),{statusCode:409});db.prepare('UPDATE licenses SET status=?,max_installations=? WHERE id=?').run(value.status??row.status,value.maxInstallations??row.max_installations,id);audit('license-change',id);}).immediate();return {ok:true};
  });
  app.post('/admin/activations/:id/reset',request=>{
    const id=z.object({id:z.string().uuid()}).parse(request.params).id,a=db.prepare('SELECT * FROM activations WHERE id=?').get(id) as Activation|undefined;if(!a)throw Object.assign(new Error(),{statusCode:404});
    db.transaction(()=>{db.prepare('UPDATE activations SET active=0,blocked=1 WHERE id=?').run(id);audit('activation-reset',id);}).immediate();return {ok:true,reservedUntil:a.lease_until};
  });
  return app;
}
