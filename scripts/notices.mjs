import {readFile,writeFile,mkdir} from 'node:fs/promises';
const runtime=['electron','react','react-dom','scheduler','three','monaco-editor','marked','dompurify','better-sqlite3','node-addon-api','zod','semver'];
const development=['typescript','vite','@vitejs/plugin-react','esbuild','vitest','@playwright/test','@electron/rebuild','electron-builder','tsx'];
let result='FireCNC Academy — third-party notices\n\n';
for(const name of [...runtime,...development]) {
  const root=`node_modules/${name}/`,p=JSON.parse(await readFile(root+'package.json','utf8'));
  result+=`\n${name} ${p.version} — ${p.license??'see upstream'} (${runtime.includes(name)?'runtime/bundled':'development only'})\n`;
  let license='';
  for(const file of ['LICENSE','LICENSE.txt','LICENSE.md','LICENCE','license','LICENSE-MIT','License.txt'])try{license=await readFile(root+file,'utf8');break;}catch{}
  if(!license)throw new Error('Не найдено уведомление о лицензии: '+name);
  result+=license+'\n';
  for(const file of ['NOTICE','NOTICE.txt','ThirdPartyNotices.txt'])try{result+='\n'+name+' / '+file+'\n'+await readFile(root+file,'utf8')+'\n';}catch{}
}
result+='\nNoto Sans Regular 2.015 — SIL OFL 1.1\n'+await readFile('third-party/NotoSans-LICENSE.txt','utf8');
result+='\nSQLite is in the public domain. See https://sqlite.org/copyright.html. Electron distributions include Chromium LICENSES.chromium.html.\n';
await mkdir('dist',{recursive:true});await writeFile('dist/THIRD_PARTY_NOTICES.txt',result);
