import {createHash,createPublicKey,verify,sign,type KeyObject} from 'node:crypto';
import {z} from 'zod';
import {MODULES} from '@firecnc/contracts';
export {MODULES,EDITIONS} from '@firecnc/contracts';
export const DOMAIN = Buffer.from('FireCNC-License-v1\0','ascii');
export const MAX_TOKEN_BYTES = 12000;
const timestamp=z.number().int().min(0).max(4102444800);
export const payloadSchema=z.strictObject({
  version:z.literal(1),productId:z.literal('firecnc-academy'),kind:z.enum(['offline','lease']),
  licenseId:z.string().regex(/^[a-zA-Z0-9-]{8,64}$/),keyId:z.string().regex(/^[a-f0-9]{16}$/),
  licensedTo:z.string().trim().min(1).max(160),edition:z.enum(['student','teacher','lab']),
  modules:z.array(z.enum(MODULES)).min(1).max(7).refine(v=>new Set(v).size===v.length),
  issuedAt:timestamp,notBefore:timestamp,expiresAt:timestamp.nullable(),
  binding:z.strictObject({installationHash:z.string().regex(/^[a-f0-9]{64}$/)}).nullable(),
  activationId:z.string().uuid().optional()
}).superRefine((p,ctx)=>{
  if(p.notBefore<p.issuedAt||p.expiresAt!==null&&p.expiresAt<=p.notBefore) ctx.addIssue({code:'custom',message:'Неверный диапазон времени.'});
  if(p.kind==='lease'&&(!p.activationId||!p.binding||p.expiresAt===null)) ctx.addIssue({code:'custom',message:'Для lease нужны срок, привязка и activationId.'});
  if(p.kind==='offline'&&p.activationId!==undefined) ctx.addIssue({code:'custom',message:'activationId допустим только для lease.'});
  if(p.edition==='lab'&&p.kind!=='lease')ctx.addIssue({code:'custom',message:'Lab требует серверный lease с учётом установок.'});
});
export type LicensePayload=z.infer<typeof payloadSchema>;
export type Verification = {ok:true;payload:LicensePayload}|{ok:false;code:string;message:string;payload?:LicensePayload};
export type TrustStore=Record<string,string>;
export function signLicense(value:LicensePayload,privateKey:KeyObject):string {
  if(privateKey.asymmetricKeyType!=='ed25519'||privateKey.type!=='private')throw new Error('Нужен закрытый ключ Ed25519.');
  const payload=payloadSchema.parse(value);if(payload.keyId!==keyId(createPublicKey(privateKey)))throw new Error('keyId не соответствует ключу подписи.');
  const encoded=Buffer.from(JSON.stringify(payload),'utf8').toString('base64url');
  return `FCNC1.${encoded}.${sign(null,Buffer.concat([DOMAIN,Buffer.from(encoded,'ascii')]),privateKey).toString('base64url')}`;
}
// This parser detects duplicate keys before JSON.parse can silently overwrite them.
export function strictJSON(text:string,limits={maxDepth:6,maxNodes:150}):unknown {
  let i=0,nodes=0;
  const ws=()=>{while(/[ \t\r\n]/.test(text[i]??'')&&i<text.length)i++;};
  const parse=(depth:number):unknown=>{
    if(depth>limits.maxDepth||++nodes>limits.maxNodes) throw new Error('Слишком сложный JSON.');
    ws();const c=text[i];
    if(c==='"') {
      const start=i++;
      while(i<text.length) {if(text[i]==='\\'){i+=2;continue;}if(text[i++]==='"')return JSON.parse(text.slice(start,i)) as string;}
      throw new Error('Незакрытая строка.');
    }
    if(c==='{') {
      i++;ws();const result:Record<string,unknown>=Object.create(null) as Record<string,unknown>;const seen=new Set<string>();
      if(text[i]==='}') {i++;return result;}
      for(;;) {
        ws();if(text[i]!=='"')throw new Error('Ожидается имя поля.');
        const key=parse(depth+1) as string;
        if(seen.has(key))throw new Error('Повторяющееся поле JSON.');seen.add(key);
        ws();if(text[i++]!==':')throw new Error('Ожидается двоеточие.');
        result[key]=parse(depth+1);ws();const end=text[i++];
        if(end==='}')return result;if(end!==',')throw new Error('Ожидается запятая.');
      }
    }
    if(c==='[') {
      i++;ws();const result:unknown[]=[];if(text[i]===']'){i++;return result;}
      for(;;){result.push(parse(depth+1));ws();const end=text[i++];if(end===']')return result;if(end!==',')throw new Error('Неверный массив.');}
    }
    const match=/^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
    if(!match)throw new Error('Неверное значение JSON.');i+=match[0].length;return JSON.parse(match[0]) as unknown;
  };
  const result=parse(0);ws();if(i!==text.length)throw new Error('Лишний текст после JSON.');return result;
}
export function keyId(publicKey:string|KeyObject):string {
  const key=typeof publicKey==='string'?createPublicKey(publicKey):publicKey;
  if(key.asymmetricKeyType!=='ed25519')throw new Error('Разрешён только Ed25519.');
  return createHash('sha256').update(key.export({format:'der',type:'spki'})).digest('hex').slice(0,16);
}
export function installationHash(id:string):string {return createHash('sha256').update('FireCNC-Installation-v1\0'+id).digest('hex');}
export function verifyLicense(token:string,trust:TrustStore,context:{now:number;installationHash?:string}):Verification {
  const bad=(code:string,message:string):Verification=>({ok:false,code,message});
  if(Buffer.byteLength(token,'utf8')>MAX_TOKEN_BYTES)return bad('SIZE','Файл лицензии слишком велик.');
  try {
    const parts=token.split('.');
    if(parts.length!==3||parts[0]!=='FCNC1')return bad('FORMAT','Ожидается лицензия формата FCNC1.');
    const payload64=parts[1]!,signature64=parts[2]!;
    for(const segment of [payload64,signature64]) if(!/^[A-Za-z0-9_-]+$/.test(segment)||Buffer.from(segment,'base64url').toString('base64url')!==segment) return bad('ENCODING','Некорректное кодирование лицензии.');
    const bytes=Buffer.from(payload64,'base64url');
    const data=strictJSON(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!data||typeof data!=='object'||Array.isArray(data))return bad('SCHEMA','Неверная структура лицензии.');
    const untrustedId=(data as Record<string,unknown>).keyId;
    if(typeof untrustedId!=='string'||!Object.hasOwn(trust,untrustedId))return bad('KEY','Ключ подписи не известен этой сборке. Обратитесь к владельцу приложения.');
    const publicKey=createPublicKey(trust[untrustedId]!);
    if(publicKey.asymmetricKeyType!=='ed25519'||keyId(publicKey)!==untrustedId)return bad('KEY','Неверный доверенный ключ.');
    const signature=Buffer.from(signature64,'base64url');
    if(signature.length!==64||!verify(null,Buffer.concat([DOMAIN,Buffer.from(payload64,'ascii')]),publicKey,signature))return bad('SIGNATURE','Подпись не совпадает: лицензия повреждена или изменена.');
    const parsed=payloadSchema.safeParse(data);
    if(!parsed.success)return bad('SCHEMA','Подписанные данные не соответствуют формату FireCNC v1.');
    const p=parsed.data;
    if(context.now<p.notBefore)return {...bad('NOT_YET','Срок действия лицензии ещё не начался. Проверьте дату компьютера.'),payload:p};
    if(p.expiresAt!==null&&context.now>=p.expiresAt)return {...bad('EXPIRED','Лицензия истекла. Ваши данные и экспорт результатов доступны.'),payload:p};
    if(p.binding&&p.binding.installationHash!==context.installationHash)return bad('BINDING','Лицензия выдана для другой установки. Экспортируйте запрос и запросите перевыпуск.');
    return {ok:true,payload:p};
  } catch {return bad('FORMAT','Не удалось прочитать лицензию. Проверьте файл или вставленную строку.');}
}
