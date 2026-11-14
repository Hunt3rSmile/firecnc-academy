import {test,expect,_electron,type ElectronApplication} from '@playwright/test';
import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {createPrivateKey,randomBytes} from 'node:crypto';
import {createActivationServer} from '../../services/activation-server/src/server';
let app:ElectronApplication;
test('Онлайн: короткий ключ Lab, перезапуск без сервера и экспорт после срока',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'FireCNC-online-')),db=new Database(':memory:'),admin=randomBytes(32).toString('base64url'),server=await createActivationServer({db,privateKey:createPrivateKey(await readFile('.local/issuer-private.pem','utf8')),adminToken:admin});
  const address=await server.listen({host:'127.0.0.1',port:0}),response=await server.inject({method:'POST',url:'/admin/licenses',headers:{authorization:'Bearer '+admin},payload:{licensedTo:'Учебная лаборатория',edition:'lab',modules:['turning'],maxInstallations:1,expiresAt:Math.floor(Date.now()/1000)+20*86400}}),key=response.json().key as string;
  const env=Object.fromEntries(Object.entries({...process.env,FCNC_DATA_DIR:directory}).filter(([k,v])=>v!==undefined&&k!=='ELECTRON_RUN_AS_NODE')) as Record<string,string>;
  const launch=async()=>{app=await _electron.launch({args:['.',...(process.platform==='linux'?['--ozone-platform=x11']:[])],env,chromiumSandbox:true});const p=await app.firstWindow();await expect(p.getByRole('heading',{name:'От понимания — к обработке'})).toBeVisible();return p;};
  try{
    let page=await launch();await page.getByRole('button',{name:'Настройки и лицензия',exact:true}).click();await page.getByText('Активация коротким ключом через сервер',{exact:true}).click();await page.getByLabel('Сервер активации',{exact:true}).fill(address);await page.getByLabel('Короткий ключ',{exact:true}).fill(key);await page.getByRole('button',{name:'Активировать ключ',exact:true}).click();await expect(page.getByText('Подписанное разрешение получено. Автономная работа доступна до указанного срока.',{exact:true})).toBeVisible();
    const state=await page.evaluate(()=>window.academy.state());if(!state.ok||!state.value.license.expiresAt)throw new Error('Missing lease');expect(state.value.license).toMatchObject({status:'active',edition:'lab',modules:['turning'],bound:true});
    expect((await page.evaluate(()=>window.academy.teacherConfigure('Проверочный-пароль-2026'))).ok).toBe(false);
    await app.close();await server.close();page=await launch();const restored=await page.evaluate(()=>window.academy.state());expect(restored.ok&&restored.value.installationHash).toBe(state.value.installationHash);expect(restored.ok&&restored.value.license.status).toBe('active');
    await page.context().setOffline(true);await page.getByRole('button',{name:'Редактор и симулятор',exact:true}).click();await page.locator('.sim-more>summary').click();await page.getByRole('button',{name:'▷ Рассчитать',exact:true}).click();await page.locator('.sim-more>summary').click();await page.getByRole('button',{name:'Измерить',exact:true}).click();await expect(page.getByText('Ø на Z−15: 30.00 мм',{exact:false})).toBeVisible();
    expect((await page.evaluate(()=>window.academy.onlineRenew())).ok).toBe(false);const remaining=await page.evaluate(()=>window.academy.state());expect(remaining.ok&&remaining.value.license.status).toBe('active');
    await app.evaluate((_,expires)=>{Date.now=()=>expires*1000+1;},state.value.license.expiresAt);const expired=await page.evaluate(()=>window.academy.state());expect(expired.ok&&expired.value.license.status).toBe('expired');
    const file=path.join(directory,'результаты.json');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);expect((await page.evaluate(()=>window.academy.exportResults())).ok).toBe(true);expect(JSON.parse(await readFile(file,'utf8')).profile).toBeDefined();
    await app.close();
  }finally{await server.close();db.close();}
});
test.afterEach(async({},info)=>{if(info.status!=='passed')app?.process().kill();else await app?.close().catch(()=>{});});
