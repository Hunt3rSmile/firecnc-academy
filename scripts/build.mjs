import {build} from 'esbuild';
import {build as viteBuild} from 'vite';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import './notices.mjs';
import {createPublicKey,createHash} from 'node:crypto';
const args=process.argv.slice(2),trustIndex=args.indexOf('--trust');
const trustPath=trustIndex>=0?args[trustIndex+1]:(process.env.FCNC_TRUST_FILE??'config/trusted-keys.json');
const trusted=trustPath?JSON.parse(await readFile(trustPath,'utf8')):{};
if(!trusted||typeof trusted!=='object'||Array.isArray(trusted))throw new Error('Нужен объект доверенных открытых ключей.');
if(Object.keys(trusted).length>8)throw new Error('Не более 8 доверенных ключей.');
const development=args.includes('--development');
const blocked=[];
if(!development) {
  blocked.push(JSON.parse(await readFile('tests/fixtures/public-license-vector.json','utf8')).keyId);
  try{blocked.push(...Object.keys(JSON.parse(await readFile('.local/trusted-keys.json','utf8'))));}catch{}
}
for(const [id,pem] of Object.entries(trusted)) {
  if(typeof pem!=='string'||!pem.includes('-----BEGIN PUBLIC KEY-----')||pem.includes('PRIVATE KEY')||blocked.includes(id))throw new Error('В release допускаются только публичные ключи владельца, без тестовых ключей.');
  const key=createPublicKey(pem),expected=createHash('sha256').update(key.export({format:'der',type:'spki'})).digest('hex').slice(0,16);
  if(key.asymmetricKeyType!=='ed25519'||id!==expected)throw new Error('Неверный keyId или алгоритм доверенного ключа.');
}
await mkdir('dist/desktop',{recursive:true});
await build({entryPoints:['apps/desktop/src/main.ts'],outfile:'dist/desktop/main.cjs',bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron','better-sqlite3'],define:{__TRUSTED_KEYS__:JSON.stringify(trusted),__DEVELOPMENT_TRUST__:JSON.stringify(development)}});
await build({entryPoints:['apps/desktop/src/preload.ts'],outfile:'dist/desktop/preload.cjs',bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
await viteBuild();
await writeFile('dist/build-info.json',JSON.stringify({development,trustKeyIds:Object.keys(trusted)},null,2));
console.log(`Сборка: ${development?'development':'release'}, доверенных ключей: ${Object.keys(trusted).length}.`);
