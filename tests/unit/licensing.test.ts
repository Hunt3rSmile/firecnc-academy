import {describe,it,expect} from 'vitest';
import {createPrivateKey,sign} from 'node:crypto';
import {newKeys,issueLicense} from '../../tools/license-issuer/src/issuer';
import {verifyLicense,DOMAIN,strictJSON} from '@firecnc/licensing';
import vector from '../fixtures/public-license-vector.json';
const pair=newKeys(),trust={[pair.keyId]:pair.publicPem},now=1800000000;
const make=()=>issueLicense(pair.privatePem,{edition:'teacher',customer:'Тест',days:1,now});
const signed=(data:unknown)=>{const p=Buffer.from(typeof data==='string'?data:JSON.stringify(data)).toString('base64url');return `FCNC1.${p}.${sign(null,Buffer.concat([DOMAIN,Buffer.from(p)]),createPrivateKey(pair.privatePem)).toString('base64url')}`;};
describe('Ed25519 / FCNC1',()=>{
  it('офлайн CLI не выдаёт Lab; подписанный Lab требует серверный lease',()=>{
    expect(()=>issueLicense(pair.privatePem,{edition:'lab',customer:'Лаборатория',now})).toThrow('учёт мест');
    expect(verifyLicense(signed({...make().payload,edition:'lab'}),trust,{now})).toMatchObject({ok:false,code:'SCHEMA'});
  });
  it('соответствует опубликованному вектору и не принимает его без явного доверия',()=>{
    expect(verifyLicense(vector.token,{[vector.keyId]:vector.publicKey},{now:vector.now})).toEqual({ok:true,payload:vector.payload});
    expect(verifyLicense(vector.token,{}, {now:vector.now})).toMatchObject({ok:false,code:'KEY'});
  });
  it('принимает подписанный исходный сегмент, а не повторную сериализацию',()=>{
    const p=make().payload;expect(verifyLicense(signed(JSON.stringify(p,null,2)),trust,{now}).ok).toBe(true);
  });
  it('отклоняет замену байта payload и подписи',()=>{
    const {token,payload}=make();const changed=Buffer.from(JSON.stringify({...payload,licensedTo:'Другое имя'})).toString('base64url');
    expect(verifyLicense(`FCNC1.${changed}.${token.split('.')[2]}`,trust,{now}).ok).toBe(false);
    const sig=Buffer.from(token.split('.')[2]!,'base64url');sig[20]=sig[20]!^1;
    expect(verifyLicense(`${token.split('.').slice(0,2).join('.')}.${sig.toString('base64url')}`,trust,{now}).ok).toBe(false);
  });
  it.each([{productId:'other'},{version:2},{kind:'trial'},{keyId:'0000000000000000'},{modules:['teacher','root']},{modules:['theory','theory']},{extra:true}])('отклоняет неверную схему %j',change=>{
    expect(verifyLicense(signed({...make().payload,...change}),trust,{now}).ok).toBe(false);
  });
  it('проверяет границы срока и привязку',()=>{
    const {token}=make();expect(verifyLicense(token,trust,{now:now-1})).toMatchObject({ok:false,code:'NOT_YET'});
    expect(verifyLicense(token,trust,{now:now+86400})).toMatchObject({ok:false,code:'EXPIRED'});
    const bound=issueLicense(pair.privatePem,{edition:'student',customer:'Тест',binding:'a'.repeat(64),now}).token;
    expect(verifyLicense(bound,trust,{now})).toMatchObject({ok:false,code:'BINDING'});
    expect(verifyLicense(bound,trust,{now,installationHash:'a'.repeat(64)}).ok).toBe(true);
  });
  it('отклоняет повторные ключи, в том числе экранированные',()=>{
    expect(()=>strictJSON('{"a":1,"\\u0061":2}')).toThrow();
    const raw=JSON.stringify(make().payload).replace('"version":1','"version":2,"version":1');
    expect(verifyLicense(signed(raw),trust,{now}).ok).toBe(false);
  });
  it('ограничивает размер, глубину, неполные и повреждённые данные',()=>{
    for(const s of ['', 'FCNC1.a.b', 'X'.repeat(13000),signed('{bad}'),signed('['.repeat(20)+'0'+']'.repeat(20))])expect(verifyLicense(s,trust,{now}).ok).toBe(false);
  });
  it('поддерживает защищённый PKCS#8 без другого алгоритма',()=>{
    const encrypted=newKeys('длинный тестовый пароль');
    expect(()=>issueLicense(encrypted.privatePem,{edition:'student',customer:'Тест',now})).toThrow();
    const issued=issueLicense(encrypted.privatePem,{edition:'student',customer:'Тест',now,passphrase:'длинный тестовый пароль'});
    expect(verifyLicense(issued.token,{[encrypted.keyId]:encrypted.publicPem},{now}).ok).toBe(true);
  });
});
