import {_electron,expect} from '@playwright/test';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{packaged:{type:'boolean'},cycles:{type:'string'},warmup:{type:'string'}}});
const cycles=Number(values.cycles??20),warmup=Number(values.warmup??4);if(!Number.isInteger(cycles)||!Number.isInteger(warmup)||cycles<2||cycles>100||warmup<0||warmup>=cycles)throw new Error('Invalid benchmark cycle count.');
const directory=await mkdtemp(path.join(os.tmpdir(),'FireCNC-memory-')),env={...process.env,FCNC_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
const executablePath=values.packaged?path.resolve(process.platform==='win32'?'release/win-unpacked/FireCNC Academy.exe':'release/linux-unpacked/firecnc-academy'):undefined;
const app=await _electron.launch({...(executablePath?{executablePath}:{}),args:[...(executablePath?[`--user-data-dir=${directory}`]:['.']),...(process.platform==='linux'?['--ozone-platform=x11']:[])],env,chromiumSandbox:true});
try{
  const page=await app.firstWindow();await page.setViewportSize({width:1366,height:768});await expect(page.getByRole('heading',{name:'От понимания — к обработке'})).toBeVisible();
  await page.evaluate(()=>window.academy.updateAutomatic(false));const appState=await page.evaluate(()=>window.academy.state());
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
  const snapshots=[];
  for(let i=0;i<cycles;i++){
    await page.getByRole('button',{name:'Редактор и симулятор',exact:true}).click();if(i%2)await page.getByRole('button',{name:'Фрезерование',exact:true}).click();
    const started=performance.now();await page.locator('.sim-more>summary').click();await page.getByRole('button',{name:'▷ Рассчитать',exact:true}).click();await page.locator('.sim-more>summary').click();await expect(page.getByText('Программа выполнена.',{exact:false})).toBeVisible();const calculationMilliseconds=performance.now()-started;
    await page.getByRole('button',{name:'Главная',exact:true}).click();await expect(page.locator('.scene canvas')).toHaveCount(0);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await cdp.send('HeapProfiler.collectGarbage');
    const metrics=await cdp.send('Performance.getMetrics'),heap=metrics.metrics.find(m=>m.name==='JSHeapUsedSize')?.value;
    if(!Number.isFinite(heap))throw new Error('No renderer heap measurement.');
    const memory=await app.evaluate(({app})=>app.getAppMetrics().map(p=>({type:p.type,workingSetKiB:p.memory.workingSetSize,privateKiB:p.memory.privateBytes??null})));
    snapshots.push({cycle:i+1,warmup:i<warmup,kind:i%2?'milling':'turning',calculationMilliseconds,rendererHeapBytes:heap,sumWorkingSetKiB:memory.reduce((sum,p)=>sum+p.workingSetKiB,0),processes:memory});
  }
  const gpu=await app.evaluate(async({app})=>({features:app.getGPUFeatureStatus(),info:await app.getGPUInfo('basic')}));
  const measured=snapshots.filter(s=>!s.warmup),report={date:new Date().toISOString(),platform:process.platform,host:{cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem(),os:os.release()},runtime:await app.evaluate(()=>({electron:process.versions.electron,node:process.versions.node})),viewport:{width:1366,height:768},display:process.platform==='linux'?'X11':'native',forcedGarbageCollection:true,warmupCycles:warmup,measuredCycles:cycles-warmup,packaged:!!values.packaged,developmentTrust:appState.ok?appState.value.license.development:null,heapGrowthBytes:measured.at(-1).rendererHeapBytes-measured[0].rendererHeapBytes,snapshots,gpu,note:'Short repeated-project check; working sets include shared pages and are not PSS. No universal FPS or long-duration leak guarantee.'};
  await mkdir('docs/benchmarks',{recursive:true});await writeFile(`docs/benchmarks/desktop-${process.platform}-x64.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cycles,heapGrowthBytes:report.heapGrowthBytes,rendererHeapMiB:measured.map(s=>Number((s.rendererHeapBytes/1024/1024).toFixed(2)))},null,2));
}finally{await app.close();}
