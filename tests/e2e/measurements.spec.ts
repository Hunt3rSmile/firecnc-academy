import {test,expect,_electron,type ElectronApplication} from '@playwright/test';
import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
let app:ElectronApplication;
test('Измерения: показ шкалы, серия без подсказок и восстановление ответа',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'FireCNC-measurements-'));
  const env=Object.fromEntries(Object.entries({...process.env,FCNC_DATA_DIR:directory}).filter(([k,v])=>v!==undefined&&k!=='ELECTRON_RUN_AS_NODE')) as Record<string,string>;
  const launch=async()=>{app=await _electron.launch({args:['.',...(process.platform==='linux'?['--ozone-platform=x11']:[])],env,chromiumSandbox:true});const p=await app.firstWindow();await p.setViewportSize({width:1366,height:768});await expect(p.getByRole('heading',{name:'От понимания — к обработке'})).toBeVisible();await p.getByRole('button',{name:'Измерительный инструмент',exact:true}).click();return p;};
  let page=await launch();await expect(page.getByText('12.35 мм.',{exact:false})).toBeVisible();await page.screenshot({path:'test-results/caliper-explanation.png',fullPage:true});
  const blocked=await page.evaluate(()=>window.academy.measurementStart({kind:'caliper',mode:'series'}));expect(blocked.ok).toBe(false);
  await page.getByLabel('Измерительный прибор').selectOption('micrometer');await page.getByRole('button',{name:'Новое измерение'}).click();
  await expect(page.getByText('5.74 мм.',{exact:false})).toBeVisible();await page.getByRole('slider',{name:'Положение измерительного прибора'}).focus();await page.keyboard.press('End');
  await expect(page.getByText('25.00 мм.',{exact:false})).toBeVisible();await page.screenshot({path:'test-results/micrometer-explanation.png',fullPage:true});
  const token=(await readFile('.local/development.fcnclic','utf8')).trim();expect((await page.evaluate(t=>window.academy.licenseImport(t),token)).ok).toBe(true);
  await page.reload();await page.getByRole('button',{name:'Измерительный инструмент',exact:true}).click();
  await page.getByLabel('Режим измерения').selectOption('series');await page.getByRole('button',{name:'Новое измерение'}).click();
  const current=await page.evaluate(()=>window.academy.measurementCurrent());if(!current.ok||!current.value)throw new Error('Missing series');const original=current.value;
  await page.getByLabel('Ответ измерения').fill((original.ticks[0]!/100).toFixed(2).replace('.',','));await page.getByRole('button',{name:'Проверить',exact:true}).click();
  await expect(page.getByText('Ответ сохранён. Разбор откроется после всей серии.',{exact:true})).toBeVisible();await app.close();
  page=await launch();await expect(page.getByRole('button',{name:'Следующее измерение →'})).toBeVisible();
  const restored=await page.evaluate(()=>window.academy.measurementCurrent());expect(restored.ok&&restored.value?.ticks).toEqual(original.ticks);
  for(let i=1;i<5;i++){await page.getByRole('button',{name:'Следующее измерение →'}).click();const value=original.ticks[i]!/100;await page.getByLabel('Ответ измерения').fill((i===2?(value===0?1:0):value).toFixed(2).replace('.',','));await page.getByRole('button',{name:'Проверить',exact:true}).click();}
  await expect(page.getByRole('heading',{name:'Результат: 4 из 5'})).toBeVisible();await expect(page.getByRole('heading',{name:'Разбор измерений'})).toBeVisible();
  await page.screenshot({path:'test-results/measurement-series-review.png',fullPage:true});await app.close();
});
test.afterEach(async({},info)=>{if(info.status!=='passed')app?.process().kill();else await app?.close().catch(()=>{});});
