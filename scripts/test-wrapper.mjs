import {chromium,expect} from '@playwright/test';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {mkdtemp,readFile,copyFile,chmod,mkdir,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
if(!['win32','linux'].includes(process.platform))throw new Error('Wrapper acceptance supports Windows and Linux x64.');
const {version}=JSON.parse(await readFile('package.json','utf8')),windows=process.platform==='win32';
const original=path.resolve(`release/FireCNC-Academy-${version}-${windows?'portable-x64.exe':'linux-x64.AppImage'}`);await stat(original);
const root=await mkdtemp(path.join(os.tmpdir(),'FireCNC-обёртка-')),executable=path.join(root,windows?'Учебный тренажёр.exe':'Учебный тренажёр.AppImage'),data=path.join(root,'данные');
await copyFile(original,executable);if(!windows)await chmod(executable,0o755);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.FCNC_DATA_DIR;if(!windows)env.APPIMAGE_EXTRACT_AND_RUN='1';
const port=async()=>await new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const address=server.address();server.close(()=>resolve(address.port));});});
let child,browser,closed;
async function launch(){
  const debug=await port();let error='';child=spawn(executable,[`--user-data-dir=${data}`,`--remote-debugging-port=${debug}`,'--remote-debugging-address=127.0.0.1',...(!windows?['--ozone-platform=x11']:[])],{env,stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',bytes=>{error=(error+bytes.toString()).slice(-4000);});closed=new Promise(resolve=>child.once('exit',resolve));let failed;child.once('error',e=>{failed=e;});
  const deadline=Date.now()+90000;let connected=false;
  while(Date.now()<deadline){if(failed)throw failed;if(child.exitCode!==null)throw new Error('Portable/AppImage exited: '+error);try{const r=await fetch(`http://127.0.0.1:${debug}/json/version`,{signal:AbortSignal.timeout(1000)});if(r.ok){connected=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,500));}
  if(!connected)throw new Error('Portable/AppImage did not open CDP: '+error);
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${debug}`);const context=browser.contexts()[0];let page=context.pages()[0];if(!page)page=await context.waitForEvent('page');
  await expect(page.getByRole('heading',{name:'От понимания — к обработке'})).toBeVisible({timeout:30000});return page;
}
async function stop(){if(browser){const cdp=await browser.newBrowserCDPSession();await cdp.send('Browser.close').catch(()=>{});browser=null;}if(child){let timeout;try{await Promise.race([closed,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Wrapper did not exit cleanly.')),30000);})]);}finally{clearTimeout(timeout);}}child=null;}
try{
  let page=await launch();const first=await page.evaluate(()=>window.academy.state());if(!first.ok||first.value.version!==version||first.value.license.status!=='demo')throw new Error('Wrapper opened wrong version/profile.');
  const security=await page.evaluate(()=>window.academy.security);if(!security.sandbox||!security.contextIsolation)throw new Error('Wrapper renderer is not isolated.');
  const renamed=await page.evaluate(()=>window.academy.profile('Проверка portable/AppImage'));if(!renamed.ok)throw new Error(renamed.error);const progress=await page.evaluate(()=>window.academy.lessonComplete('turning-axes'));if(!progress.ok)throw new Error(progress.error);
  await page.context().setOffline(true);await page.reload();await expect(page.getByRole('heading',{name:'От понимания — к обработке'})).toBeVisible();await page.getByRole('button',{name:'Редактор и симулятор',exact:true}).click();await page.locator('.sim-more>summary').click();await page.getByRole('button',{name:'▷ Рассчитать',exact:true}).click();await page.locator('.sim-more>summary').click();await page.getByRole('button',{name:'Измерить',exact:true}).click();await expect(page.getByText('Ø на Z−15: 30.00 мм',{exact:false})).toBeVisible();
  await stop();await stat(path.join(data,'academy.sqlite'));
  page=await launch();const second=await page.evaluate(()=>window.academy.state());if(!second.ok||second.value.installationHash!==first.value.installationHash||second.value.profile.name!=='Проверка portable/AppImage'||!second.value.completed.includes('turning-axes'))throw new Error('Wrapper restart lost data.');
  await stop();await mkdir('test-results',{recursive:true});await writeFile(`test-results/wrapper-${process.platform}.json`,JSON.stringify({version,platform:process.platform,kind:windows?'NSIS portable':'AppImage',cyrillicExecutablePath:true,cyrillicDataPath:true,appImageExtractAndRun:!windows,offlineProcessing:true,diameter:30,restartPreservedData:true,security},null,2)+'\n');console.log('Portable/AppImage wrapper, offline processing and restart passed.');
}finally{
  if(browser)await stop().catch(()=>{});
  if(child&&child.exitCode===null){if(windows)await promisify(execFile)('taskkill',['/PID',String(child.pid),'/T','/F']).catch(()=>{});else child.kill('SIGTERM');}
}
