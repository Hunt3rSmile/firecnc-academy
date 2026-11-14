import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
const alphabet='0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newActivationKey():string {
  const bytes=randomBytes(20);let value=0,bits=0,out='';
  for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){bits-=5;out+=alphabet[(value>>>bits)&31];}}
  return 'FCNC-'+out.match(/.{8}/g)!.join('-');
}
export function normalizeActivationKey(value:string):string {
  const compact=value.trim().toUpperCase().replace(/[\s-]/g,'');
  if(!/^FCNC[0-9A-HJKMNP-TV-Z]{32}$/.test(compact))throw new Error('Короткий ключ содержит префикс FCNC и 32 символа Crockford Base32.');
  return compact;
}
export function secretHash(purpose:'activation-key'|'installation-secret'|'admin',value:string):string {return createHash('sha256').update(`FireCNC-${purpose}-v1\0`,'ascii').update(value,'utf8').digest('hex');}
export function sameSecretHash(a:string,b:string):boolean {const aa=Buffer.from(a,'hex'),bb=Buffer.from(b,'hex');return aa.length===32&&bb.length===32&&timingSafeEqual(aa,bb);}
