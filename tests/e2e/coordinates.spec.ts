import {test,expect,_electron,type ElectronApplication} from '@playwright/test';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
let app:ElectronApplication;
test('Размерный чертёж: фаски 45°, ввод по Enter, исправление, перезапуск и разные детали',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'FireCNC-coordinates-'));
  const env=Object.fromEntries(Object.entries({...process.env,FCNC_DATA_DIR:directory}).filter(([k,v])=>v!==undefined&&k!=='ELECTRON_RUN_AS_NODE')) as Record<string,string>;
  const launch=async()=>{app=await _electron.launch({args:['.',...(process.platform==='linux'?['--ozone-platform=x11']:[])],env,chromiumSandbox:true});const p=await app.firstWindow();await p.setViewportSize({width:1366,height:768});await expect(p.getByRole('heading',{name:'От понимания — к обработке'})).toBeVisible();await p.getByRole('button',{name:'Тренировка координат',exact:true}).click();await expect(p.getByLabel('Координата X',{exact:true})).toBeVisible();return p;};
  let page=await launch();
  let current=await page.evaluate(()=>window.academy.coordinateCurrent());if(!current.ok||!current.value)throw new Error('Missing coordinate attempt');const original=current.value;
  expect(original.drawing).toBeDefined();expect(new Set(original.modes)).toEqual(new Set(['G90']));
  await expect(page.getByRole('table')).toHaveCount(0);expect(await page.locator('[data-feature="chamfer-45"]').count()).toBeGreaterThanOrEqual(2);
  const readable=await page.locator('.blueprint-diameter text').first().evaluate(e=>{const svg=e.closest('svg')!,r=svg.getBoundingClientRect(),v=svg.viewBox.baseVal;return parseFloat(getComputedStyle(e).fontSize)*Math.min(r.width/v.width,r.height/v.height);});expect(readable).toBeGreaterThanOrEqual(20);
  const bounds=await page.locator('.coordinate-sheet').boundingBox();expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(780);
  await page.screenshot({path:'test-results/coordinate-dimensioned.png',fullPage:true});
  const enter=async(index:number,wrong=false)=>{
    const target=original.points[index]!,previous=index===0?original.start:original.points[index-1]!;
    const x=original.modes[index]==='G90'?target.x:target.x-previous.x,z=original.modes[index]==='G90'?target.z:target.z-previous.z;
    await page.getByLabel('Координата X',{exact:true}).fill(String(wrong?x+1:x).replace('.',','));await page.getByLabel('Координата X',{exact:true}).press('Enter');await expect(page.getByLabel('Координата Z',{exact:true})).toBeFocused();
    await page.getByLabel('Координата Z',{exact:true}).fill(String(z).replace('.',','));await page.getByLabel('Координата Z',{exact:true}).press('Enter');
  };
  await enter(0);await expect(page.getByText('✓ Верно',{exact:true})).toBeVisible();await app.close();page=await launch();
  await expect(page.getByRole('button',{name:'Следующая точка ↵',exact:true})).toBeVisible();current=await page.evaluate(()=>window.academy.coordinateCurrent());expect(current.ok&&current.value?.drawing).toEqual(original.drawing);expect(current.ok&&current.value?.answers).toHaveLength(1);
  for(let i=1;i<original.points.length;i++){
    await page.getByRole('button',{name:'Следующая точка ↵',exact:true}).press('Enter');
    if(i===1){await enter(i,true);await expect(page.getByText('Пока неверно — попробуйте ещё раз',{exact:true})).toBeVisible();await expect(page.getByLabel('Координата X',{exact:true})).toBeEnabled();}
    await enter(i);if(i<original.points.length-1)await expect(page.getByText('✓ Верно',{exact:true})).toBeVisible();
  }
  await expect(page.getByRole('heading',{name:'Деталь пройдена',exact:true})).toBeVisible();await expect(page.getByText(`${original.points.length-1} из ${original.points.length}`,{exact:true})).toBeVisible();
  await page.getByText('Разобрать ответы',{exact:true}).click();await page.screenshot({path:'test-results/coordinate-review.png',fullPage:true});
  const signatures=new Set([JSON.stringify(original.points)]);let last=original.id;
  for(let i=0;i<6;i++){
    await page.getByRole('button',{name:'Другая деталь',exact:true}).click();await expect.poll(async()=>{const r=await page.evaluate(()=>window.academy.coordinateCurrent());return r.ok?r.value?.id:null;}).not.toBe(last);
    const r=await page.evaluate(()=>window.academy.coordinateCurrent());if(!r.ok||!r.value)throw new Error('Missing next drawing');last=r.value.id;signatures.add(JSON.stringify(r.value.points));
  }
  expect(signatures.size).toBe(7);
  await page.setViewportSize({width:800,height:720});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);
  await expect.poll(async()=>{const p=await page.locator('.blueprint-target').boundingBox(),v=await page.locator('.coordinate-drawing-scroll').boundingBox();return p!.x>=v!.x&&p!.x+p!.width<=v!.x+v!.width;}).toBe(true);
  await page.screenshot({path:'test-results/coordinate-narrow.png',fullPage:true});
  const forbidden=await page.evaluate(()=>window.academy.coordinateStart({kind:'milling'}));expect(forbidden.ok).toBe(false);await app.close();
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
