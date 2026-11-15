import {it,expect} from 'vitest';
import {mkdtemp,rm,writeFile,copyFile,readdir,open} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import {Store} from '../../apps/desktop/src/store';
import {inspectBackup,prepareRestore} from '../../apps/desktop/src/restore';
import {createCoordinateAttempt,createMeasurementAttempt,createExam,finishExam,examDefinitions,exercises,assess,teachingPackageSchema,examBank,createWorkshop} from '@firecnc/learning';
import {projectSchema,DEMO_SOURCES} from '@firecnc/contracts';
import {compile} from '@firecnc/core';
import {simulate} from '@firecnc/simulation';
import {defaultCAM,generateCAM,verifyGeneratedCAM} from '@firecnc/cam';
it('восстановление готовит согласованный снимок, не меняя живую БД',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'FireCNC-restore-unit-')),store=await Store.open(path.join(root,'live'));
  try{
    store.rename('До копии');store.complete('turning-axes');const id=store.get('installationId'),file=path.join(root,'backup.sqlite'),now=Date.now();
    const project=projectSchema.parse({version:1,name:'Копия учебного проекта',kind:'turning',source:DEMO_SOURCES.turning,offset:{x:0,y:0,z:0},resolution:.25});store.saveProject(project);store.submit({});
    store.saveCoordinate(createCoordinateAttempt({id:crypto.randomUUID(),kind:'turning',seed:1,now,demo:false}));store.saveMeasurement(createMeasurementAttempt({id:crypto.randomUUID(),kind:'caliper',mode:'series',seed:1,now}));store.saveExam(finishExam(createExam({id:crypto.randomUUID(),definition:examDefinitions[0]!,seed:1,now}),now+1000));
    const e=exercises[0]!,p=compile(project.source,{kind:'turning'}),r=simulate(p,{kind:'turning'});store.savePractice({id:crypto.randomUUID(),createdAt:now,project,exercise:{id:e.id,version:e.version,title:e.title,lesson:e.lesson,target:e.target},grade:assess(e,r),diagnostic:null,statistics:{removedVolume:r.removedVolume,seconds:p.seconds,completed:r.completed,frames:p.events.length,uncertainty:r.uncertainty}});
    store.importTeaching(teachingPackageSchema.parse({format:'firecnc-teaching',version:1,title:'Материалы в резервной копии',questions:[{...examBank[0],id:'custom-backup-question'}],exams:[],exercises:[]}));
    store.set(`workshop:${store.profileId}:turning`,JSON.stringify(createWorkshop('turning',crypto.randomUUID())));
    const document=defaultCAM('turn-profile'),generated=generateCAM(document);store.set(`cam:${store.profileId}`,JSON.stringify({document,result:{project:{...project,source:generated.source},target:generated.target,note:generated.note,validation:verifyGeneratedCAM(generated)}}));
    await store.backup(file);store.rename('После копии');
    const candidate=await prepareRestore(file,path.join(root,'live'));await inspectBackup(candidate);const db=new Database(candidate,{readonly:true});expect((db.prepare('SELECT name FROM profiles').get() as {name:string}).name).toBe('До копии');expect((db.prepare("SELECT value FROM settings WHERE key='installationId'").get() as {value:string}).value).toBe(id);db.close();expect(store.profile().name).toBe('После копии');
  }finally{store.close();await rm(root,{recursive:true,force:true});}
});
it('повреждённая, чужая или новая копия не создаёт замену и не меняет данные',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'FireCNC-restore-bad-')),store=await Store.open(path.join(root,'live'));
  try{
    const file=path.join(root,'invalid.sqlite');await writeFile(file,'Это не SQLite.');await expect(prepareRestore(file,path.join(root,'live'))).rejects.toThrow('резервной копии');
    const valid=path.join(root,'valid.sqlite');await store.backup(valid);await copyFile(valid,file);let bad=new Database(file);bad.pragma('user_version=7');bad.close();await expect(inspectBackup(file)).rejects.toThrow('версией');
    await copyFile(valid,file);bad=new Database(file);bad.exec('CREATE TRIGGER unexpected AFTER INSERT ON settings BEGIN SELECT 1; END;');bad.close();await expect(inspectBackup(file)).rejects.toThrow('FireCNC');
    await copyFile(valid,file);bad=new Database(file);bad.prepare('INSERT INTO projects VALUES (?,?)').run(store.profileId,'{"version":2}');bad.close();await expect(inspectBackup(file)).rejects.toThrow('резервной копии');
    expect(store.profile().name).toBe('Студент');expect((await readdir(path.join(root,'live'))).some(f=>f.startsWith('restore-candidate-'))).toBe(false);
  }finally{store.close();await rm(root,{recursive:true,force:true});}
});
it('ограничивает размер до открытия SQLite',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'FireCNC-restore-size-'));try{const file=path.join(root,'large.sqlite'),handle=await open(file,'w');await handle.truncate(64*1024*1024+1);await handle.close();await expect(inspectBackup(file)).rejects.toThrow('64 МБ');}finally{await rm(root,{recursive:true,force:true});}
});
