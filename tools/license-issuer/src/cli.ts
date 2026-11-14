import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {newKeys,issueLicense} from './issuer';
import {verifyLicense,keyId,strictJSON} from '@firecnc/licensing';
import {EDITIONS,MODULES,type Edition,type LicenseModule} from '@firecnc/contracts';
async function secret(prompt:string):Promise<string> {
  if(!process.stdin.isTTY)throw new Error('Для пароля нужен интерактивный терминал. Пароль в аргументах не принимается.');
  process.stdout.write(prompt);process.stdin.setRawMode(true);process.stdin.resume();
  return new Promise((resolve,reject)=>{
    let value='';
    const finish=(error?:Error)=>{process.stdin.off('data',handler);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');if(error)reject(error);else resolve(value);};
    const handler=(chunk:Buffer)=>{for(const char of chunk.toString('utf8')){if(char==='\r'||char==='\n'){finish();return;}if(char==='\u0003'){finish(new Error('Отменено.'));return;}if(char==='\u007f'||char==='\b')value=value.slice(0,-1);else if(char>=' ')value+=char;}};
    process.stdin.on('data',handler);
  });
}
try {
  const command=process.argv[2];
  const {values:v}=parseArgs({args:process.argv.slice(3),options:{out:{type:'string'},encrypt:{type:'boolean'},'private-key':{type:'string'},'public-key':{type:'string'},edition:{type:'string'},modules:{type:'string'},days:{type:'string'},customer:{type:'string'},output:{type:'string'},license:{type:'string'},request:{type:'string'},ledger:{type:'string'},'installation-hash':{type:'string'}}});
  const required=(name:keyof typeof v):string=>{const value=v[name];if(typeof value!=='string'||!value)throw new Error(`Требуется --${name}.`);return value;};
  if(command==='keygen'||command==='rotate') {
    const dir=required('out');let password:string|undefined;
    if(v.encrypt){password=await secret('Пароль нового PKCS#8 (без эха): ');if(password.length<12)throw new Error('Используйте пароль не короче 12 символов.');if(password!==await secret('Повторите пароль: '))throw new Error('Пароли не совпадают.');}
    await mkdir(dir,{recursive:true,mode:0o700});
    const pair=newKeys(password);
    await writeFile(path.join(dir,'issuer-private.pem'),pair.privatePem,{flag:'wx',mode:0o600});
    await writeFile(path.join(dir,'issuer-public.pem'),pair.publicPem,{flag:'wx',mode:0o644});
    await writeFile(path.join(dir,'trusted-keys.json'),JSON.stringify({[pair.keyId]:pair.publicPem},null,2),{flag:'wx'});
    console.log(`Создан Ed25519 keyId=${pair.keyId}. Закрытый ключ сохранён в ${dir}; он не входит в клиентскую сборку.`);
  } else if(command==='issue') {
    const edition=required('edition').toLowerCase();if(!Object.hasOwn(EDITIONS,edition))throw new Error('Редакция: student, teacher или lab.');
    const modules=v.modules?.split(',').map(s=>s.trim()) as LicenseModule[]|undefined;
    if(modules?.some(m=>!MODULES.includes(m)))throw new Error('Неизвестный модуль.');
    const days=v.days===undefined?undefined:Number(v.days);if(days!==undefined&&(!Number.isInteger(days)||days<1||days>36500))throw new Error('--days: целое число 1–36500. Без параметра — бессрочно.');
    const pem=await readFile(required('private-key'),'utf8');const passphrase=pem.includes('ENCRYPTED PRIVATE KEY')?await secret('Пароль закрытого ключа: '):undefined;
    let binding=v['installation-hash'];
    if(v.request) {
      const text=await readFile(v.request,'utf8');if(text.length>4096)throw new Error('Запрос слишком велик.');
      const req=strictJSON(text) as Record<string,unknown>;
      if(req.version!==1||req.productId!=='firecnc-academy'||typeof req.installationHash!=='string')throw new Error('Неверный запрос активации.');
      binding=req.installationHash;
    }
    const result=issueLicense(pem,{edition:edition as Edition,modules,days,customer:required('customer'),binding,passphrase});
    const output=required('output');await mkdir(path.dirname(output),{recursive:true});
    await writeFile(output,result.token+'\n',{flag:'wx',mode:0o600});
    const {payload:p}=result;
    await appendFile(v.ledger??path.join(path.dirname(output),'ledger.jsonl'),JSON.stringify({licenseId:p.licenseId,keyId:p.keyId,edition:p.edition,modules:p.modules,licensedTo:p.licensedTo,issuedAt:p.issuedAt,expiresAt:p.expiresAt,bound:!!p.binding,file:path.basename(output)})+'\n',{mode:0o600});
    console.log(`Лицензия ${p.licenseId} выпущена: ${output}.`);
  } else if(command==='verify') {
    const pem=await readFile(required('public-key'),'utf8');const token=(await readFile(required('license'),'utf8')).trim();
    const result=verifyLicense(token,{[keyId(pem)]:pem},{now:Math.floor(Date.now()/1000),installationHash:v['installation-hash']});
    if(!result.ok)throw new Error(result.message);
    const p=result.payload;console.log(JSON.stringify({status:'active',licenseId:p.licenseId,licensedTo:p.licensedTo,edition:p.edition,modules:p.modules,expiresAt:p.expiresAt,bound:!!p.binding},null,2));
  } else if(command==='list') {
    console.log(await readFile(v.ledger??'./issued/ledger.jsonl','utf8'));
  } else throw new Error('Команды: keygen, rotate, issue, verify, list. Примеры — LICENSING_ADMIN_RU.md.');
} catch(e) {console.error(e instanceof Error?e.message:'Ошибка CLI.');process.exitCode=1;}
