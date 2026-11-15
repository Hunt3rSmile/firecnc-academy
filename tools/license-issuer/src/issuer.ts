import {createPrivateKey,createPublicKey,generateKeyPairSync,sign,randomUUID,type KeyObject} from 'node:crypto';
import {signLicense,keyId,payloadSchema,type LicensePayload} from '@firecnc/licensing';
import {EDITIONS,type Edition,type LicenseModule} from '@firecnc/contracts';
export function newKeys(passphrase?:string):{privatePem:string;publicPem:string;keyId:string} {
  const pair=generateKeyPairSync('ed25519');
  const privatePem=pair.privateKey.export({format:'pem',type:'pkcs8',...(passphrase?{cipher:'aes-256-cbc',passphrase}:{})}).toString();
  const publicPem=pair.publicKey.export({format:'pem',type:'spki'}).toString();
  return {privatePem,publicPem,keyId:keyId(pair.publicKey)};
}
export function issueLicense(privatePem:string,options:{edition:Edition;modules?:LicenseModule[];customer:string;days?:number;binding?:string;now?:number;passphrase?:string}):{token:string;payload:LicensePayload} {
  if(options.edition==='lab')throw new Error('Офлайн Lab не выпускается: учёт мест выполняет сервер активации. Для Lab используйте короткий ключ сервера; офлайн доступны Student и Teacher.');
  const privateKey:KeyObject=createPrivateKey({key:privatePem,format:'pem',passphrase:options.passphrase});
  if(privateKey.asymmetricKeyType!=='ed25519')throw new Error('Нужен закрытый ключ Ed25519 в PKCS#8.');
  const now=options.now??Math.floor(Date.now()/1000);
  const payload=payloadSchema.parse({version:1,productId:'firecnc-academy',kind:'offline',licenseId:randomUUID(),keyId:keyId(createPublicKey(privateKey)),licensedTo:options.customer,
    edition:options.edition,modules:options.modules??EDITIONS[options.edition],issuedAt:now,notBefore:now,expiresAt:options.days===undefined?null:now+options.days*86400,binding:options.binding?{installationHash:options.binding}:null});
  return {token:signLicense(payload,privateKey),payload};
}
