import {test,expect,_electron,type ElectronApplication} from '@playwright/test';
import {mkdtemp,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
let app:ElectronApplication;
test('Восстановление через UI: ошибка без потери, защитная копия и перезапуск',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'FireCNC-restore-ui-')),directory=path.join(root,'data'),env=Object.fromEntries(Object.entries({...process.env,FCNC_DATA_DIR:directory}).filter(([k,v])=>v!==undefined&&k!=='ELECTRON_RUN_AS_NODE')) as Record<string,string>;
  const launch=async()=>{app=await _electron.launch({args:['.',...(process.platform==='linux'?['--ozone-platform=x11']:[])],env,chromiumSandbox:true});const page=await app.firstWindow();await expect(page.getByRole('heading',{name:'От понимания — к обработке'})).toBeVisible();return page;};
  let page=await launch();await page.evaluate(()=>window.academy.profile('До восстановления'));await page.evaluate(()=>window.academy.lessonComplete('turning-axes'));const before=await page.evaluate(()=>window.academy.state());
  const file=path.join(root,'учебная-копия.sqlite');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);expect((await page.evaluate(()=>window.academy.backup())).ok).toBe(true);await page.evaluate(()=>window.academy.profile('Более новые данные'));
  const invalid=path.join(root,'поврежденная.sqlite');await writeFile(invalid,'broken');await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});},invalid);const rejected=await page.evaluate(()=>window.academy.restoreBackup());expect(rejected.ok).toBe(false);const unchanged=await page.evaluate(()=>window.academy.state());expect(unchanged.ok&&unchanged.value.profile.name).toBe('Более новые данные');
  await app.evaluate(({dialog,app},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});app.relaunch=()=>{};},file);await page.getByRole('button',{name:'Настройки и лицензия',exact:true}).click();const closed=app.waitForEvent('close');await page.getByRole('button',{name:'Восстановить резервную копию…',exact:true}).click();await closed;
  page=await launch();const restored=await page.evaluate(()=>window.academy.state());expect(restored.ok&&restored.value.profile.name).toBe('До восстановления');expect(restored.ok&&restored.value.completed).toContain('turning-axes');expect(restored.ok&&restored.value.installationHash).toBe(before.ok&&before.value.installationHash);
  const previous=(await readdir(directory)).find(f=>f.startsWith('before-restore-'));expect(previous).toBeDefined();const db=new Database(path.join(directory,previous!),{readonly:true});expect((db.prepare('SELECT name FROM profiles').get() as {name:string}).name).toBe('Более новые данные');expect(db.pragma('quick_check',{simple:true})).toBe('ok');db.close();await app.close();
});
test.afterEach(async({},info)=>{if(info.status!=='passed')app?.process().kill();else await app?.close().catch(()=>{});});
