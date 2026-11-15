import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {verifyLicense,installationHash,strictJSON,type TrustStore} from '@firecnc/licensing';
import {normalizeActivationKey,secretHash} from '../../../packages/licensing/src/activation';
import type {OnlineLicenseView} from '@firecnc/contracts';
const recordSchema=z.strictObject({version:z.literal(1),endpoint:z.string().max(500),activationId:z.string().uuid().nullable(),keyHash:z.string().regex(/^[a-f0-9]{64}$/),secret:z.string().max(2000),encrypted:z.boolean(),expiresAt:z.number().int().nullable()});
type OnlineRecord=z.infer<typeof recordSchema>;
export function activationEndpoint(input:string):string {
  const u=new URL(input);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!(u.protocol==='https:'||u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw new Error('Укажите корень HTTPS-сервера активации. HTTP разрешён только для localhost.');
  return u.origin;
}
interface Options {get:(key:string)=>string|undefined;set:(key:string,value:string)=>void;installationId:string;trust:TrustStore;request:typeof fetch;importToken:(token:string)=>void;protect:{available:()=>boolean;encrypt:(text:string)=>Buffer;decrypt:(bytes:Buffer)=>string};clock?:()=>number}
export class OnlineLicensing {
  private busy=false;private message='Короткий ключ выдаёт владелец сервера. Офлайн-файл работает независимо от сервера.';
  constructor(private readonly options:Options){}
  private record():OnlineRecord|null {const raw=this.options.get('onlineState');if(!raw)return null;try{return recordSchema.parse(strictJSON(raw));}catch{throw new Error('Служебные данные активации повреждены. Восстановите резервную копию или обратитесь к владельцу.');}}
  private save(record:OnlineRecord):void {this.options.set('onlineState',JSON.stringify(record));}
  view():OnlineLicenseView {let r:OnlineRecord|null=null;try{r=this.record();}catch(error){this.message=error instanceof Error?error.message:'Ошибка активации.';}return {endpoint:r?.endpoint??'',activated:!!r?.activationId,expiresAt:r?.expiresAt??null,busy:this.busy,protectedStorage:r?.encrypted??this.options.protect.available(),message:this.message};}
  private secret(r:OnlineRecord):string {return r.encrypted?this.options.protect.decrypt(Buffer.from(r.secret,'base64')):r.secret;}
  private async exclusive<T>(action:()=>Promise<T>):Promise<T>{if(this.busy)throw new Error('Операция активации уже выполняется.');this.busy=true;try{return await action();}catch(error){this.message=error instanceof Error?error.message:'Сервер недоступен.';throw error;}finally{this.busy=false;}}
  private async call(endpoint:string,operation:'activate'|'renew'|'deactivate',value:unknown):Promise<unknown> {
    try{
      const response=await this.options.request(activationEndpoint(endpoint)+'/v1/'+operation,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error(response.status===429?'Слишком много запросов. Повторите позже.':'Сервер не разрешил операцию. Проверьте ключ, срок, лимит мест или обратитесь к владельцу.');
      if(Number(response.headers.get('content-length')??0)>20000)throw new Error('Ответ сервера слишком велик.');
      const reader=response.body?.getReader();if(!reader)throw new Error('Пустой ответ сервера.');let size=0;const chunks:Uint8Array[]=[];
      try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>20000){await reader.cancel();throw new Error('Ответ сервера слишком велик.');}chunks.push(part.value);}}finally{reader.releaseLock();}
      return strictJSON(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    }catch(error){if(error instanceof Error&&['TimeoutError','AbortError','TypeError'].includes(error.name))throw new Error('Сервер недоступен. Действующая лицензия продолжает работать до своего срока. Повторите запрос позже.');throw error;}
  }
  private accept(value:unknown,r:OnlineRecord):void {
    const response=z.strictObject({token:z.string().max(12000),activationId:z.string().uuid(),expiresAt:z.number().int()}).parse(value),verified=verifyLicense(response.token,this.options.trust,{now:this.options.clock?.()??Math.floor(Date.now()/1000),installationHash:installationHash(this.options.installationId)});
    if(!verified.ok)throw new Error(verified.message);const p=verified.payload;
    if(p.kind!=='lease'||p.activationId!==response.activationId||p.expiresAt!==response.expiresAt||r.activationId!==null&&r.activationId!==p.activationId)throw new Error('Ответ сервера не соответствует этой активации.');
    this.options.importToken(response.token);this.save({...r,activationId:response.activationId,expiresAt:response.expiresAt});
    this.message='Подписанное разрешение получено. Автономная работа доступна до указанного срока.';
  }
  async activate(endpoint:string,key:string):Promise<OnlineLicenseView> {
    await this.exclusive(async()=>{
      endpoint=activationEndpoint(endpoint);const normalized=normalizeActivationKey(key),hash=secretHash('activation-key',normalized);let r=this.record();
      const now=this.options.clock?.()??Math.floor(Date.now()/1000);
      if(r?.activationId&&(r.endpoint!==endpoint||r.keyHash!==hash)&&(r.expiresAt===null||r.expiresAt>now))throw new Error('Прежний автономный lease ещё действует. Сначала деактивируйте его либо дождитесь срока. Офлайн-файл можно импортировать независимо от него.');
      if(!r||r.endpoint!==endpoint||r.keyHash!==hash){const secret=randomBytes(32).toString('base64url'),encrypted=this.options.protect.available();r={version:1,endpoint,keyHash:hash,activationId:null,expiresAt:null,encrypted,secret:encrypted?this.options.protect.encrypt(secret).toString('base64'):secret};this.save(r);}
      const value=await this.call(endpoint,'activate',{key:normalized,installationId:this.options.installationId,secret:this.secret(r)});this.accept(value,r);
    });return this.view();
  }
  async renew():Promise<OnlineLicenseView> {
    await this.exclusive(async()=>{
      const r=this.record();if(!r?.activationId)throw new Error('Нет серверной активации для продления.');
      const token=this.options.get('license'),v=token?verifyLicense(token,this.options.trust,{now:this.options.clock?.()??Math.floor(Date.now()/1000),installationHash:installationHash(this.options.installationId)}):null,p=v?.ok?v.payload:v?.payload;
      if(p?.kind!=='lease'||p.activationId!==r.activationId)throw new Error('Текущая лицензия не относится к этой серверной активации.');
      const value=await this.call(r.endpoint,'renew',{activationId:r.activationId,installationId:this.options.installationId,secret:this.secret(r)});this.accept(value,r);
    });return this.view();
  }
  async deactivate():Promise<OnlineLicenseView> {
    await this.exclusive(async()=>{
      const r=this.record();if(!r?.activationId)throw new Error('Нет серверной активации.');
      const response=z.strictObject({ok:z.literal(true),reservedUntil:z.number().int()}).parse(await this.call(r.endpoint,'deactivate',{activationId:r.activationId,installationId:this.options.installationId,secret:this.secret(r)}));
      const token=this.options.get('license'),v=token?verifyLicense(token,this.options.trust,{now:this.options.clock?.()??Math.floor(Date.now()/1000),installationHash:installationHash(this.options.installationId)}):null,p=v?.ok?v.payload:v?.payload;
      if(p?.kind==='lease'&&p.activationId===r.activationId)this.options.set('license','');this.save({...r,activationId:null,expiresAt:null});this.message=`Эта установка деактивирована. Ранее выданный автономный lease резервирует место до ${new Date(response.reservedUntil*1000).toLocaleString('ru-RU')}. Данные сохранены.`;
    });return this.view();
  }
  async automaticRenew():Promise<void> {
    try{const r=this.record(),now=this.options.clock?.()??Math.floor(Date.now()/1000);if(r?.activationId&&r.expiresAt!==null&&r.expiresAt<now+2*86400)await this.renew();}catch{/* Existing signed token is never changed by a failed renewal. */}
  }
}
