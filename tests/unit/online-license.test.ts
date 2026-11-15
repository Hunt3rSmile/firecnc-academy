import {it,expect} from 'vitest';
import Database from 'better-sqlite3';
import {createPrivateKey,randomBytes,randomUUID} from 'node:crypto';
import {OnlineLicensing,activationEndpoint} from '../../apps/desktop/src/online-license';
import {createActivationServer} from '../../services/activation-server/src/server';
import {newKeys} from '../../tools/license-issuer/src/issuer';
import {verifyLicense,installationHash} from '@firecnc/licensing';
it('проверяет адрес сервера, запрещает удалённый HTTP, учётные данные и перенаправляющие параметры',()=>{
  expect(activationEndpoint('https://activation.example.org')).toBe('https://activation.example.org');expect(activationEndpoint('http://127.0.0.1:3679')).toBe('http://127.0.0.1:3679');
  for(const url of ['http://activation.example.org','file:///etc/passwd','https://user:pass@example.org','https://example.org/?secret=1','https://example.org/other'])expect(()=>activationEndpoint(url)).toThrow();
});
it('потерянный ответ не тратит второе место; выключенный сервер не портит действующий lease',async()=>{
  let time=Math.floor(Date.now()/1000);const pair=newKeys(),db=new Database(':memory:'),admin=randomBytes(32).toString('base64url'),server=await createActivationServer({db,privateKey:createPrivateKey(pair.privatePem),adminToken:admin,leaseSeconds:600,clock:()=>time}),values=new Map<string,string>(),installationId=randomUUID(),trust={[pair.keyId]:pair.publicPem};let lost=true,offline=false,tampered=false;
  const created=await server.inject({method:'POST',url:'/admin/licenses',headers:{authorization:'Bearer '+admin},payload:{licensedTo:'Проверка клиента',edition:'lab',modules:['turning'],expiresAt:null,maxInstallations:1}}),key=created.json().key as string;
  const request:typeof fetch=async(url,options)=>{if(offline)throw new TypeError('offline');const route=new URL(String(url)).pathname,response=await server.inject({method:'POST',url:route,headers:{'content-type':'application/json'},payload:String(options?.body)});if(lost&&route==='/v1/activate'){lost=false;throw new TypeError('lost response');}return new Response(tampered?response.body.replace('FCNC1.','FCNC2.'):response.body,{status:response.statusCode,headers:{'content-type':'application/json'}});};
  const make=()=>new OnlineLicensing({get:key=>values.get(key),set:(key,value)=>{values.set(key,value);},installationId,trust,request,clock:()=>time,importToken:token=>{const v=verifyLicense(token,trust,{now:time,installationHash:installationHash(installationId)});if(!v.ok)throw new Error(v.message);values.set('license',token);},protect:{available:()=>false,encrypt:()=>{throw new Error();},decrypt:()=>{throw new Error();}}});
  try{
    let client=make();await expect(client.activate('http://localhost:3679',key)).rejects.toThrow('недоступен');expect(values.has('onlineState')).toBe(true);expect(values.has('license')).toBe(false);
    client=make();await client.activate('http://localhost:3679',key);expect(client.view().activated).toBe(true);expect((db.prepare('SELECT COUNT(*) n FROM activations').get() as {n:number}).n).toBe(1);
    const original=values.get('license');tampered=true;await expect(client.renew()).rejects.toThrow();expect(values.get('license')).toBe(original);tampered=false;
    offline=true;await expect(client.renew()).rejects.toThrow('недоступен');expect(values.get('license')).toBe(original);expect(verifyLicense(original!,trust,{now:Math.floor(Date.now()/1000),installationHash:installationHash(installationId)}).ok).toBe(true);offline=false;
    await client.deactivate();expect(client.view().activated).toBe(false);expect(values.get('license')).toBe('');await client.activate('http://localhost:3679',key);expect(client.view().activated).toBe(true);
    const replacement=(await server.inject({method:'POST',url:'/admin/licenses',headers:{authorization:'Bearer '+admin},payload:{licensedTo:'Перевыпуск',edition:'student',modules:['milling'],expiresAt:null,maxInstallations:1}})).json().key as string;
    await expect(client.activate('http://localhost:3679',replacement)).rejects.toThrow('ещё действует');time+=601;await client.activate('http://localhost:3679',replacement);expect(verifyLicense(values.get('license')!,trust,{now:time,installationHash:installationHash(installationId)})).toMatchObject({ok:true,payload:{modules:['milling']}});
  }finally{await server.close();db.close();}
});
