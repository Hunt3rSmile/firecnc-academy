import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {newKeys,issueLicense} from '../tools/license-issuer/src/issuer';
import {MODULES} from '@firecnc/contracts';
await mkdir('.local',{recursive:true,mode:0o700});
let privatePem:string;
try {privatePem=await readFile('.local/issuer-private.pem','utf8');}
catch {
  const pair=newKeys();privatePem=pair.privatePem;
  await writeFile('.local/issuer-private.pem',pair.privatePem,{flag:'wx',mode:0o600});
  await writeFile('.local/issuer-public.pem',pair.publicPem,{flag:'wx'});
  await writeFile('.local/trusted-keys.json',JSON.stringify({[pair.keyId]:pair.publicPem},null,2),{flag:'wx'});
}
const {token}=issueLicense(privatePem,{edition:'teacher',modules:[...MODULES],customer:'Локальное учебное тестирование',days:30});
await writeFile('.local/development.fcnclic',token+'\n',{mode:0o600});
console.log('Временная лицензия: .local/development.fcnclic. Запустите npm run dev и импортируйте этот файл в Настройках. Публичный ключ включается только в явно отмеченную development-сборку.');
