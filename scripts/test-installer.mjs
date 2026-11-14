import {_electron,expect} from '@playwright/test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,stat,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
if(process.platform!=='win32'||process.env.CI!=='true')throw new Error('Installer acceptance runs only in a disposable Windows CI runner.');
const run=promisify(execFile),{version}=JSON.parse(await readFile('package.json','utf8'));
const installer=path.resolve(`release/FireCNC-Academy-${version}-setup-x64.exe`);
const directory=await mkdtemp(path.join(os.tmpdir(),'FireCNC-проверка-'));
const executable=path.join(directory,'FireCNC Academy.exe'),uninstaller=path.join(directory,'Uninstall FireCNC Academy.exe');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.FCNC_DATA_DIR;
let application;
async function install(){await run(installer,['/S',`/D=${directory}`],{timeout:180000,env});await stat(executable);}
async function launch(){application=await _electron.launch({executablePath:executable,env,chromiumSandbox:true});const page=await application.firstWindow();await expect(page.getByRole('heading',{name:'От понимания — к обработке'})).toBeVisible();return page;}
try {
  await install();let page=await launch();
  const dataDirectory=await application.evaluate(({app})=>app.getPath('userData'));
  const profile=await page.evaluate(()=>window.academy.profile('Проверка установки Windows'));
  if(!profile.ok)throw new Error('Profile was not saved.');
  const completed=await page.evaluate(()=>window.academy.lessonComplete('turning-axes'));if(!completed.ok)throw new Error('Progress was not saved.');
  await application.close();application=null;
  await install();page=await launch();
  const restored=await page.evaluate(()=>window.academy.state());
  if(!restored.ok||restored.value.profile.id!==profile.value.profile.id||!restored.value.completed.includes('turning-axes'))throw new Error('Installer update lost profile or progress.');
  await application.close();application=null;
  await run(uninstaller,['/S'],{timeout:180000,env});
  await stat(path.join(dataDirectory,'academy.sqlite'));
  await mkdir('test-results',{recursive:true});
  await writeFile('test-results/installer-windows.json',JSON.stringify({version,install:true,reinstallPreservedData:true,uninstallPreservedData:true,cyrillicInstallPath:true},null,2)+'\n');
  console.log('Windows installer, reinstall, and uninstall data preservation passed.');
} finally {await application?.close().catch(()=>{});}
