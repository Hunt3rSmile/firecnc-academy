import {describe,it,expect} from 'vitest';
import Database from 'better-sqlite3';
import {createPrivateKey,randomBytes,randomUUID} from 'node:crypto';
import {createActivationServer} from '../../services/activation-server/src/server';
import {newKeys} from '../../tools/license-issuer/src/issuer';
import {verifyLicense,installationHash} from '@firecnc/licensing';
import {newActivationKey,normalizeActivationKey} from '../../packages/licensing/src/activation';
const secret=()=>randomBytes(32).toString('base64url');
async function fixture(leaseSeconds=600,rateMax=1000){let time=1800000000;const keys=newKeys(),db=new Database(':memory:'),admin=secret(),app=await createActivationServer({db,privateKey:createPrivateKey(keys.privatePem),adminToken:admin,leaseSeconds,clock:()=>time,rateMax});const headers={authorization:'Bearer '+admin};return {app,db,headers,trust:{[keys.keyId]:keys.publicPem},now:()=>time,advance:(seconds:number)=>{time+=seconds;},close:async()=>{await app.close();db.close();}};}
const create=async(f:Awaited<ReturnType<typeof fixture>>,options={})=>{const r=await f.app.inject({method:'POST',url:'/admin/licenses',headers:f.headers,payload:{licensedTo:'Учебная лаборатория',edition:'lab',maxInstallations:1,expiresAt:f.now()+3600,...options}});expect(r.statusCode).toBe(200);return r.json() as {id:string;key:string};};
describe('Короткие ключи и автономные разрешения',()=>{
  it('160 случайных бит, общая строгая нормализация',()=>{
    const keys=Array.from({length:100},newActivationKey);expect(new Set(keys).size).toBe(100);
    const key=keys[0]!;expect(normalizeActivationKey(' '+key.toLowerCase().replaceAll('-',' ')+' ')).toBe(key.replaceAll('-',''));
    for(const wrong of ['FCNC-0'.repeat(8),'FCNC-'+'O'.repeat(32),key+'0'])expect(()=>normalizeActivationKey(wrong)).toThrow();
  });
  it('параллельные HTTP-запросы не занимают два места при одном свободном',async()=>{
    const f=await fixture();try{
      const license=await create(f);const address=await f.app.listen({host:'127.0.0.1',port:0});
      const values=Array.from({length:6},()=>({key:license.key,installationId:randomUUID(),secret:secret()}));
      const replies=await Promise.all(values.map(value=>fetch(address+'/v1/activate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)})));
      expect(replies.filter(r=>r.status===200)).toHaveLength(1);expect(replies.filter(r=>r.status===403)).toHaveLength(5);
      expect((f.db.prepare('SELECT COUNT(*) n FROM activations').get() as {n:number}).n).toBe(1);
      const index=replies.findIndex(r=>r.status===200),accepted=await replies[index]!.json() as {token:string;activationId:string},retry=await f.app.inject({method:'POST',url:'/v1/activate',payload:values[index]});expect(retry.statusCode).toBe(200);expect(retry.json().activationId).toBe(accepted.activationId);
      expect(verifyLicense(accepted.token,f.trust,{now:f.now(),installationHash:installationHash(values[index]!.installationId)}).ok).toBe(true);
      expect(verifyLicense(accepted.token,f.trust,{now:f.now(),installationHash:installationHash(randomUUID())}).ok).toBe(false);
      const stored=JSON.stringify(f.db.prepare('SELECT * FROM licenses').all())+JSON.stringify(f.db.prepare('SELECT * FROM activations').all());expect(stored).not.toContain(license.key);expect(stored).not.toContain(values[index]!.secret);
    }finally{await f.close();}
  });
  it('продление требует отдельного секрета, отзыв сохраняет старый lease до срока',async()=>{
    const f=await fixture();try{
      const l=await create(f,{expiresAt:f.now()+500}),input={key:l.key,installationId:randomUUID(),secret:secret()},response=await f.app.inject({method:'POST',url:'/v1/activate',payload:input}),lease=response.json() as {token:string;activationId:string;expiresAt:number};expect(lease.expiresAt).toBe(f.now()+500);
      const own={activationId:lease.activationId,installationId:input.installationId,secret:input.secret};
      expect((await f.app.inject({method:'POST',url:'/v1/deactivate',payload:{...own,secret:secret()}})).statusCode).toBe(403);
      f.advance(100);const renewed=await f.app.inject({method:'POST',url:'/v1/renew',payload:own});expect(renewed.statusCode).toBe(200);expect(renewed.json().expiresAt).toBe(lease.expiresAt);
      expect((await f.app.inject({method:'PATCH',url:'/admin/licenses/'+l.id,headers:f.headers,payload:{status:'revoked'}})).statusCode).toBe(200);
      expect((await f.app.inject({method:'POST',url:'/v1/renew',payload:own})).statusCode).toBe(403);
      await f.app.close();expect(verifyLicense(lease.token,f.trust,{now:f.now(),installationHash:installationHash(input.installationId)}).ok).toBe(true);
      f.advance(400);const expired=verifyLicense(lease.token,f.trust,{now:f.now(),installationHash:installationHash(input.installationId)});expect(!expired.ok&&expired.code).toBe('EXPIRED');
    }finally{await f.close();}
  });
  it('деактивация и сброс удерживают место до конца ранее выданного lease',async()=>{
    const f=await fixture();try{
      const l=await create(f),input={key:l.key,installationId:randomUUID(),secret:secret()},a=(await f.app.inject({method:'POST',url:'/v1/activate',payload:input})).json() as {activationId:string;expiresAt:number};
      const own={activationId:a.activationId,installationId:input.installationId,secret:input.secret};
      const deactivated=await f.app.inject({method:'POST',url:'/v1/deactivate',payload:own});expect(deactivated.json().reservedUntil).toBe(a.expiresAt);
      const another={key:l.key,installationId:randomUUID(),secret:secret()};expect((await f.app.inject({method:'POST',url:'/v1/activate',payload:another})).statusCode).toBe(403);
      expect((await f.app.inject({method:'POST',url:'/admin/activations/'+a.activationId+'/reset',headers:f.headers})).statusCode).toBe(200);expect((await f.app.inject({method:'POST',url:'/v1/renew',payload:own})).statusCode).toBe(403);
      f.advance(601);expect((await f.app.inject({method:'POST',url:'/v1/activate',payload:another})).statusCode).toBe(200);
    }finally{await f.close();}
  });
  it('административный API защищён, тело строгое, ошибки безопасны',async()=>{
    const f=await fixture();try{
      expect((await f.app.inject({url:'/health'})).json()).toEqual({ok:true,service:'firecnc-activation',version:1});expect((await f.app.inject({url:'/admin/licenses'})).statusCode).toBe(401);
      const l=await create(f);expect((await f.app.inject({method:'POST',url:'/v1/activate',payload:{key:l.key,installationId:randomUUID(),secret:secret(),modules:['teacher']}})).statusCode).toBe(400);
      const duplicate=await f.app.inject({method:'POST',url:'/v1/activate',headers:{'content-type':'application/json'},payload:'{"key":"a","key":"b"}'});expect(duplicate.statusCode).toBe(400);
      const invalid=await f.app.inject({method:'POST',url:'/v1/activate',payload:{key:newActivationKey(),installationId:randomUUID(),secret:secret()}});expect(invalid.statusCode).toBe(403);expect(invalid.body).not.toContain('SQLite');
    }finally{await f.close();}
  });
  it('ограничивает частоту запросов',async()=>{const f=await fixture(600,2);try{await f.app.inject({url:'/health'});await f.app.inject({url:'/health'});expect((await f.app.inject({url:'/health'})).statusCode).toBe(429);}finally{await f.close();}});
});
