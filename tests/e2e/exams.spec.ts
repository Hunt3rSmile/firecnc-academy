import {test,expect,_electron,type ElectronApplication,type Page} from '@playwright/test';
import {mkdtemp,readFile,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {examBank,lessons,MACHINE_NODES,type ExamQuestionView} from '@firecnc/learning';
let app:ElectronApplication;
test('Экзамен: восемь типов, автосохранение, перезапуск, полный разбор',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'FireCNC-exam-'));
  const env=Object.fromEntries(Object.entries({...process.env,FCNC_DATA_DIR:directory}).filter(([k,v])=>v!==undefined&&k!=='ELECTRON_RUN_AS_NODE')) as Record<string,string>;
  const launch=async()=>{app=await _electron.launch({args:['.',...(process.platform==='linux'?['--ozone-platform=x11']:[])],env,chromiumSandbox:true});const p=await app.firstWindow();await p.setViewportSize({width:1366,height:768});await expect(p.getByRole('heading',{name:'От понимания — к обработке'})).toBeVisible();return p;};
  let page=await launch();const denied=await page.evaluate(()=>window.academy.examStart({definitionId:'turning-intro'}));expect(denied.ok).toBe(false);
  const token=(await readFile('.local/development.fcnclic','utf8')).trim();expect((await page.evaluate(t=>window.academy.licenseImport(t),token)).ok).toBe(true);
  await page.reload();await page.getByRole('button',{name:'Экзамены',exact:true}).click();
  await page.getByText('Настроить учебную попытку',{exact:true}).click();await page.getByLabel('Количество вопросов').fill('15');await page.getByLabel('Время экзамена').fill('10');await page.getByLabel('Seed экзамена').fill('2026');await page.getByLabel('Разрешить подсказки',{exact:true}).uncheck();
  for(const lesson of lessons.filter(l=>l.course==='turning')){const checkbox=page.locator('.exam-topics').getByRole('checkbox',{name:lesson.title,exact:true});if(['turning-axes','turning-feed','turning-setup'].includes(lesson.id))await checkbox.check();else await checkbox.uncheck();}
  await page.getByRole('button',{name:'Начать тест',exact:true}).click();await expect(page.getByRole('heading',{name:'Вопрос 1 из 15'})).toBeVisible();
  const start=await page.evaluate(()=>window.academy.examCurrent());if(!start.ok||!start.value)throw new Error('Missing attempt');const original=start.value;
  for(const q of original.questions)expect('expected' in q||'correct' in q).toBe(false);
  const enter=async(p:Page,q:ExamQuestionView)=>{
    const key=examBank.find(b=>b.id===q.id)!;
    if(key.type==='single'||key.type==='multiple')for(const id of key.correct){const text=key.options.find(o=>o.id===id)!.text;await p.getByRole(key.type==='single'?'radio':'checkbox',{name:text,exact:true}).check();}
    else if(key.type==='order'){
      for(let i=0;i<key.correct.length;i++){
        const text=key.options.find(o=>o.id===key.correct[i])!.text;let current=(await p.locator('.exam-order li>span').allTextContents()).indexOf(text);
        while(current>i){await p.getByRole('button',{name:`Поднять шаг ${current+1}`,exact:true}).click();current--;}
      }
      await p.getByRole('button',{name:'Подтвердить порядок',exact:true}).click();
    }else if(key.type==='node')await p.locator('.machine-scheme').getByRole('button',{name:MACHINE_NODES[key.diagram].find(n=>n.id===key.expected)!.text,exact:true}).click();
    else await p.getByLabel('Ответ на вопрос',{exact:true}).fill(String(key.type==='measurement'?key.ticks/(key.instrument==='micrometer'?100:20):key.expected).replace('.',','));
    await expect(p.getByRole('status').filter({hasText:'Сохранено'})).toBeVisible();
  };
  await enter(page,original.questions[0]!);await app.close();page=await launch();await page.getByRole('button',{name:'Экзамены',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Вопрос 1 из 15'})).toBeVisible();const restored=await page.evaluate(()=>window.academy.examCurrent());
  expect(restored.ok&&restored.value?.questions).toEqual(original.questions);expect(restored.ok&&restored.value?.deadline).toBe(original.deadline);expect(restored.ok&&Object.keys(restored.value!.answers)).toHaveLength(1);
  const duplicate=await page.evaluate(()=>window.academy.examStart({definitionId:'milling-intro'}));expect(duplicate.ok).toBe(false);
  for(let i=1;i<original.questions.length;i++){await page.getByRole('button',{name:'Следующий вопрос →',exact:true}).click();await enter(page,original.questions[i]!);}
  await page.screenshot({path:'test-results/exam-active.png',fullPage:true});
  page.on('dialog',d=>void d.accept().catch(()=>{}));await page.getByRole('button',{name:'Завершить попытку',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Результат: 15 из 15'})).toBeVisible();await page.locator('.exam-review-row>summary').first().click();await expect(page.locator('.exam-review-row').first().getByText('Правильный:',{exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/exam-review.png',fullPage:true});
  const state=await page.evaluate(()=>window.academy.state());if(!state.ok||!state.value.license.expiresAt)throw new Error('Missing timed license');
  await app.evaluate((_,expires)=>{Date.now=()=>expires*1000+1000;},state.value.license.expiresAt);
  const expired=await page.evaluate(()=>window.academy.state());expect(expired.ok&&expired.value.license.status).toBe('expired');
  const pdfFile=path.resolve('test-results/exam-report.pdf');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},pdfFile);
  await page.getByRole('button',{name:'Экспорт отчёта PDF…',exact:true}).click();await expect(page.getByText('PDF сохранён.',{exact:true})).toBeVisible();
  expect((await stat(pdfFile)).size).toBeGreaterThan(10000);expect((await readFile(pdfFile)).subarray(0,5).toString()).toBe('%PDF-');
  await app.close();
});
test('Истёкший таймер сохраняет ответы, запрещает продолжение и открывает разбор',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'FireCNC-deadline-'));
  const env=Object.fromEntries(Object.entries({...process.env,FCNC_DATA_DIR:directory}).filter(([k,v])=>v!==undefined&&k!=='ELECTRON_RUN_AS_NODE')) as Record<string,string>;
  app=await _electron.launch({args:['.',...(process.platform==='linux'?['--ozone-platform=x11']:[])],env,chromiumSandbox:true});const page=await app.firstWindow();await expect(page.getByRole('heading',{name:'От понимания — к обработке'})).toBeVisible();
  const token=(await readFile('.local/development.fcnclic','utf8')).trim();expect((await page.evaluate(t=>window.academy.licenseImport(t),token)).ok).toBe(true);
  const started=await page.evaluate(()=>window.academy.examStart({definitionId:'turning-intro',count:1,durationSeconds:60,seed:42}));if(!started.ok)throw new Error(started.error);
  await app.evaluate(()=>{const original=Date.now;Date.now=()=>original()+61000;});
  const current=await page.evaluate(()=>window.academy.examCurrent());expect(current.ok&&current.value?.status).toBe('expired');expect(current.ok&&current.value?.review?.score).toBe(0);
  const rejected=await page.evaluate(value=>window.academy.examAnswer({id:value.id,questionId:value.questions[0]!.id,answer:'0'}),started.value);expect(rejected.ok).toBe(false);
  await page.getByRole('button',{name:'Экзамены',exact:true}).click();await page.getByRole('button',{name:'Разбор',exact:true}).click();await expect(page.getByText('ВРЕМЯ ИСТЕКЛО',{exact:true})).toBeVisible();await app.close();
});
test.afterEach(async({},info)=>{if(info.status!=='passed')app?.process().kill();else await app?.close().catch(()=>{});});
