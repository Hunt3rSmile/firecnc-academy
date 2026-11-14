import {createPrivateKey,createPublicKey,generateKeyPairSync,sign,randomUUID,type KeyObject} from 'node:crypto';
import {DOMAIN,keyId,payloadSchema,type LicensePayload} from '@firecnc/licensing';
import {EDITIONS,type Edition,type LicenseModule} from '@firecnc/contracts';
export function newKeys(passphrase?:string):{privatePem:string;publicPem:string;keyId:string} {
  const pair=generateKeyPairSync('ed25519');
  const privatePem=pair.privateKey.export({format:'pem',type:'pkcs8',...(passphrase?{cipher:'aes-256-cbc',passphrase}:{})}).toString();
  const publicPem=pair.publicKey.export({format:'pem',type:'spki'}).toString();
  return {privatePem,publicPem,keyId:keyId(pair.publicKey)};
}
export function issueLicense(privatePem:string,options:{edition:Edition;modules?:LicenseModule[];customer:string;days?:number;binding?:string;now?:number;passphrase?:string}):{token:string;payload:LicensePayload} {
  if(options.edition==='lab')throw new Error('Выпуск Lab пока недоступен: учёт мест относится к этапу E. Офлайн используйте Student или Teacher.');
  const privateKey:KeyObject=createPrivateKey({key:privatePem,format:'pem',passphrase:options.passphrase});
  if(privateKey.asymmetricKeyType!=='ed25519')throw new Error('Нужен закрытый ключ Ed25519 в PKCS#8.');
  const now=options.now??Math.floor(Date.now()/1000);
  const payload=payloadSchema.parse({version:1,productId:'firecnc-academy',kind:'offline',licenseId:randomUUID(),keyId:keyId(createPublicKey(privateKey)),licensedTo:options.customer,
    edition:options.edition,modules:options.modules??EDITIONS[options.edition],issuedAt:now,notBefore:now,expiresAt:options.days===undefined?null:now+options.days*86400,binding:options.binding?{installationHash:options.binding}:null});
  const encoded=Buffer.from(JSON.stringify(payload),'utf8').toString('base64url');
  const signature=sign(null,Buffer.concat([DOMAIN,Buffer.from(encoded,'ascii')]),privateKey).toString('base64url');
  return {token:`FCNC1.${encoded}.${signature}`,payload};
}
