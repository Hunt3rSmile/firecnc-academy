import {randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
export const PASSWORD_KDF={N:32768,r:8,p:1,keylen:64,maxmem:64*1024*1024} as const;
const recordSchema=z.strictObject({version:z.literal(1),algorithm:z.literal('scrypt'),N:z.literal(32768),r:z.literal(8),p:z.literal(1),salt:z.string().regex(/^[a-f0-9]{64}$/),hash:z.string().regex(/^[a-f0-9]{128}$/)});
export type PasswordRecord=z.infer<typeof recordSchema>;
export function passwordKey(password:string,salt:Buffer):Promise<Buffer> {return new Promise((resolve,reject)=>scrypt(password,salt,PASSWORD_KDF.keylen,PASSWORD_KDF,(error,key)=>error?reject(error):resolve(key)));}
export async function hashPassword(password:string):Promise<PasswordRecord> {
  if(password.length<12||password.length>128)throw new Error('Пароль преподавателя должен содержать от 12 до 128 символов.');
  const salt=randomBytes(32),hash=await passwordKey(password,salt);return {version:1,algorithm:'scrypt',N:32768,r:8,p:1,salt:salt.toString('hex'),hash:hash.toString('hex')};
}
export async function checkPassword(password:string,value:unknown):Promise<boolean> {
  const parsed=recordSchema.safeParse(value);if(!parsed.success||password.length>128)return false;
  const key=await passwordKey(password,Buffer.from(parsed.data.salt,'hex'));return timingSafeEqual(key,Buffer.from(parsed.data.hash,'hex'));
}
