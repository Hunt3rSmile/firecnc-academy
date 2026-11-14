import {test,expect,_electron,type ElectronApplication} from '@playwright/test';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
let app:ElectronApplication;
test('G90/G91: ответ, восстановление точки после перезапуска и итоговый разбор',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'FireCNC-coordinates-'));
  const env=Object.fromEntries(Object.entries({...process.env,FCNC_DATA_DIR:directory}).filter(([k,v])=>v!==undefined&&k!=='ELECTRON_RUN_AS_NODE')) as Record<string,string>;
  const launch=async()=>{app=await _electron.launch({args:['.',...(process.platform==='linux'?['--ozone-platform=x11']:[])],env,chromiumSandbox:true});const p=await app.firstWindow();await p.setViewportSize({width:1366,height:768});await expect(p.getByRole('heading',{name:'От понимания — к обработке'})).toBeVisible();await p.getByRole('button',{name:'Тренировка координат',exact:true}).click();return p;};
  let page=await launch();await page.getByRole('button',{name:'Начать с токарной детали'}).click();
  let current=await page.evaluate(()=>window.academy.coordinateCurrent());if(!current.ok||!current.value)throw new Error('Missing coordinate attempt');const original=current.value;
  const enter=async(index:number,wrong=false)=>{
    const target=original.points[index]!,previous=index===0?original.start:original.points[index-1]!;
    for(const axis of ['x','z'] as const){const value=original.modes[index]==='G90'?target[axis]:target[axis]-previous[axis];await page.getByLabel(`Координата ${axis.toUpperCase()}`,{exact:true}).fill(String(wrong&&axis==='x'?value+1:value).replace('.',','));}
    await page.getByRole('button',{name:'Проверить →',exact:true}).click();
  };
  await enter(0);await expect(page.getByText('✓ Верно',{exact:true})).toBeVisible();await app.close();
  page=await launch();await expect(page.getByRole('button',{name:'Следующая точка →'})).toBeVisible();
  current=await page.evaluate(()=>window.academy.coordinateCurrent());expect(current.ok&&current.value?.modes).toEqual(original.modes);expect(current.ok&&current.value?.answers).toHaveLength(1);
  for(let i=1;i<original.points.length;i++){
    await page.getByRole('button',{name:'Следующая точка →'}).click();
    await enter(i,i===1);if(i===1)await expect(page.getByText('Нужно исправить расчёт',{exact:true})).toBeVisible();
  }
  await expect(page.getByRole('heading',{name:'Результат: 5 из 6'})).toBeVisible();await expect(page.getByRole('heading',{name:'Разбор по точкам'})).toBeVisible();
  await page.screenshot({path:'test-results/coordinate-review.png',fullPage:true});
  const forbidden=await page.evaluate(()=>window.academy.coordinateStart({kind:'milling'}));expect(forbidden.ok).toBe(false);
  await app.close();
});
test('Шпиндель вращается при воспроизведении и замирает при паузе',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'FireCNC-rotation-'));
  const env=Object.fromEntries(Object.entries({...process.env,FCNC_DATA_DIR:directory}).filter(([k,v])=>v!==undefined&&k!=='ELECTRON_RUN_AS_NODE')) as Record<string,string>;
  app=await _electron.launch({args:['.',...(process.platform==='linux'?['--ozone-platform=x11']:[])],env,chromiumSandbox:true});const page=await app.firstWindow();await page.setViewportSize({width:1366,height:768});
  await expect(page.getByRole('heading',{name:'От понимания — к обработке'})).toBeVisible();await page.getByRole('button',{name:'Редактор и симулятор',exact:true}).click();
  await page.getByRole('button',{name:'▶ Запустить',exact:true}).click();
  const scene=page.locator('.scene');await expect(scene).toHaveAttribute('data-spindle','cw');
  const angle=await scene.getAttribute('data-rotation-angle');await expect.poll(()=>scene.getAttribute('data-rotation-angle')).not.toBe(angle);
  await page.getByRole('button',{name:'Ⅱ Пауза',exact:true}).click();await page.waitForTimeout(100);
  const paused=await scene.getAttribute('data-rotation-angle');await page.waitForTimeout(250);expect(await scene.getAttribute('data-rotation-angle')).toBe(paused);
  await page.screenshot({path:'test-results/focused-workspace.png',fullPage:true});
  await page.getByRole('button',{name:'▶ Запустить',exact:true}).click();await expect(scene).toHaveAttribute('data-spindle','off');
  await expect(page.getByText('Программа выполнена.',{exact:false})).toBeVisible();await app.close();
});
test.afterEach(async({},info)=>{if(info.status!=='passed')app?.process().kill();else await app?.close().catch(()=>{});});
