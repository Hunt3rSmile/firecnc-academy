import Database from 'better-sqlite3';
import {mkdir,chmod} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {projectSchema,type CNCProject,type AttemptView,type PracticeAttempt} from '@firecnc/contracts';
import {grade,introQuestions,coordinateAttemptSchema,measurementAttemptSchema,storedExamSchema,teachingPackageSchema,type TeachingPackage,type StoredExam,type CoordinateAttempt,type MeasurementAttempt} from '@firecnc/learning';
export class Store {
  constructor(public db:Database.Database) {}
  static async open(directory:string):Promise<Store> {
    await mkdir(directory,{recursive:true,mode:0o700});
    const db=new Database(path.join(directory,'academy.sqlite'));
    if(process.platform!=='win32'){await chmod(directory,0o700);await chmod(db.name,0o600);}
    db.pragma('journal_mode = WAL');db.pragma('foreign_keys = ON');db.pragma('busy_timeout = 5000');
    const version=db.pragma('user_version',{simple:true}) as number;
    if(version>6){db.close();throw new Error('Эта БД создана более новой версией приложения. Восстановите новую версию.');}
    if(version<6) {
      if(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length)await db.backup(path.join(directory,`before-migration-${Date.now()}.sqlite`));
      db.transaction(()=>{
        db.exec(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS progress(profile_id TEXT NOT NULL REFERENCES profiles(id),lesson_id TEXT NOT NULL,completed_at INTEGER NOT NULL,PRIMARY KEY(profile_id,lesson_id));
          CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id),created_at INTEGER NOT NULL,score INTEGER NOT NULL,total INTEGER NOT NULL,answers TEXT NOT NULL,questions TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS projects(profile_id TEXT PRIMARY KEY REFERENCES profiles(id),document TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS coordinate_attempts(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id),created_at INTEGER NOT NULL,document TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS practice_attempts(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id),created_at INTEGER NOT NULL,document TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS measurement_attempts(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id),created_at INTEGER NOT NULL,document TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS exams(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id),created_at INTEGER NOT NULL,definition_id TEXT NOT NULL,status TEXT NOT NULL,document TEXT NOT NULL);
          CREATE UNIQUE INDEX IF NOT EXISTS one_active_exam_per_profile ON exams(profile_id) WHERE status='active';
          CREATE TABLE IF NOT EXISTS teaching_content(kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,document TEXT NOT NULL,PRIMARY KEY(kind,id,version));
          CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,created_at INTEGER NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL);
          PRAGMA user_version=6;`);
      })();
    }
    const store=new Store(db);
    if(!store.get('installationId'))store.set('installationId',randomUUID());
    if(!store.get('profileId')) {
      const id=randomUUID();db.prepare('INSERT INTO profiles(id,name) VALUES (?,?)').run(id,'Студент');store.set('profileId',id);
    }
    return store;
  }
  get(key:string):string|undefined {return (this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as {value:string}|undefined)?.value;}
  set(key:string,value:string):void {this.db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}
  get profileId():string {return this.get('profileId')!;}
  profile():{id:string;name:string} {return this.db.prepare('SELECT id,name FROM profiles WHERE id=?').get(this.profileId) as {id:string;name:string};}
  rename(name:string):void {this.db.prepare('UPDATE profiles SET name=? WHERE id=?').run(name,this.profileId);}
  profiles():{id:string;name:string}[] {return this.db.prepare('SELECT id,name FROM profiles ORDER BY name,id').all() as {id:string;name:string}[];}
  selectProfile(id:string):void {if(!this.profiles().some(p=>p.id===id))throw new Error('Профиль не найден.');this.set('profileId',id);}
  createProfile(name:string):void {if(this.profiles().length>=200)throw new Error('Разрешено не более 200 локальных профилей.');this.db.prepare('INSERT INTO profiles VALUES (?,?)').run(randomUUID(),name);this.audit('profile-create','Добавлен локальный профиль.');}
  teaching():TeachingPackage {
    const rows=this.db.prepare('SELECT t.kind,t.document FROM teaching_content t WHERE version=(SELECT MAX(version) FROM teaching_content WHERE kind=t.kind AND id=t.id) ORDER BY t.id').all() as {kind:string;document:string}[];
    return teachingPackageSchema.parse({format:'firecnc-teaching',version:1,title:'Локальные материалы преподавателя',questions:rows.filter(r=>r.kind==='questions').map(r=>JSON.parse(r.document)),exams:rows.filter(r=>r.kind==='exams').map(r=>JSON.parse(r.document)),exercises:rows.filter(r=>r.kind==='exercises').map(r=>JSON.parse(r.document))});
  }
  importTeaching(p:TeachingPackage):void {
    this.db.transaction(()=>{
      const insert=this.db.prepare('INSERT INTO teaching_content VALUES (?,?,?,?)');
      for(const kind of ['questions','exams','exercises'] as const)for(const item of p[kind]){
        const previous=this.db.prepare('SELECT version,document FROM teaching_content WHERE kind=? AND id=? ORDER BY version DESC LIMIT 1').get(kind,item.id) as {version:number;document:string}|undefined;
        const text=JSON.stringify(item);
        if(previous&&previous.version>=item.version){if(previous.version===item.version&&previous.document===text)continue;throw new Error('Для изменения материала увеличьте его версию: '+item.id);}
        insert.run(kind,item.id,item.version,text);
      }
      this.teaching();this.audit('teaching-import',p.title);
    })();
  }
  audit(action:string,detail:string):void {this.db.prepare('INSERT INTO audit(created_at,action,detail) VALUES (?,?,?)').run(Date.now(),action,detail.slice(0,300));this.db.prepare('DELETE FROM audit WHERE id NOT IN (SELECT id FROM audit ORDER BY id DESC LIMIT 2000)').run();}
  classroom():{id:string;name:string;lessons:number;exams:number;best:number|null;practice:number}[] {return this.profiles().map(p=>({ ...p,
    lessons:(this.db.prepare('SELECT COUNT(*) n FROM progress WHERE profile_id=?').get(p.id) as {n:number}).n,
    exams:(this.db.prepare("SELECT COUNT(*) n FROM exams WHERE profile_id=? AND status<>'active'").get(p.id) as {n:number}).n,
    best:(this.db.prepare('SELECT MAX(score) n FROM attempts WHERE profile_id=?').get(p.id) as {n:number|null}).n,
    practice:(this.db.prepare('SELECT COUNT(*) n FROM practice_attempts WHERE profile_id=?').get(p.id) as {n:number}).n
  }));}
  completed():string[] {return (this.db.prepare('SELECT lesson_id FROM progress WHERE profile_id=?').all(this.profileId) as {lesson_id:string}[]).map(r=>r.lesson_id);}
  complete(id:string):void {this.db.prepare('INSERT INTO progress VALUES (?,?,?) ON CONFLICT(profile_id,lesson_id) DO UPDATE SET completed_at=excluded.completed_at').run(this.profileId,id,Date.now());}
  submit(answers:Record<string,string[]>):void {
    const result=grade(answers);this.db.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?,?)').run(randomUUID(),this.profileId,Date.now(),result.score,result.total,JSON.stringify(answers),JSON.stringify(introQuestions));
  }
  attempts(all=false):AttemptView[] {
    return (this.db.prepare('SELECT * FROM attempts WHERE profile_id=? ORDER BY created_at DESC'+(all?'':' LIMIT 100')).all(this.profileId) as {id:string;created_at:number;score:number;total:number;answers:string;questions:string}[])
      .map(r=>({id:r.id,createdAt:r.created_at,score:r.score,total:r.total,answers:JSON.parse(r.answers) as Record<string,string[]>,questions:JSON.parse(r.questions) as unknown[]}));
  }
  project():CNCProject|null {const r=this.db.prepare('SELECT document FROM projects WHERE profile_id=?').get(this.profileId) as {document:string}|undefined;return r?projectSchema.parse(JSON.parse(r.document)):null;}
  saveProject(p:CNCProject):void {this.db.prepare('INSERT INTO projects VALUES (?,?) ON CONFLICT(profile_id) DO UPDATE SET document=excluded.document').run(this.profileId,JSON.stringify(p));}
  coordinate(id?:string):CoordinateAttempt|null {
    const row=(id?this.db.prepare('SELECT document FROM coordinate_attempts WHERE profile_id=? AND id=?').get(this.profileId,id):this.db.prepare('SELECT document FROM coordinate_attempts WHERE profile_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(this.profileId)) as {document:string}|undefined;
    return row?coordinateAttemptSchema.parse(JSON.parse(row.document)):null;
  }
  coordinateHistory(all=false):CoordinateAttempt[] {return (this.db.prepare('SELECT document FROM coordinate_attempts WHERE profile_id=? ORDER BY created_at DESC'+(all?'':' LIMIT 100')).all(this.profileId) as {document:string}[]).map(row=>coordinateAttemptSchema.parse(JSON.parse(row.document)));}
  saveCoordinate(value:CoordinateAttempt):void {const a=coordinateAttemptSchema.parse(value);this.db.prepare('INSERT INTO coordinate_attempts VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document').run(a.id,this.profileId,a.createdAt,JSON.stringify(a));}
  savePractice(a:PracticeAttempt):void {this.db.prepare('INSERT INTO practice_attempts VALUES (?,?,?,?)').run(a.id,this.profileId,a.createdAt,JSON.stringify(a));}
  practiceHistory(all=false):PracticeAttempt[] {return (this.db.prepare('SELECT document FROM practice_attempts WHERE profile_id=? ORDER BY created_at DESC'+(all?'':' LIMIT 100')).all(this.profileId) as {document:string}[]).map(row=>JSON.parse(row.document) as PracticeAttempt);}
  measurement(id?:string):MeasurementAttempt|null {
    const row=(id?this.db.prepare('SELECT document FROM measurement_attempts WHERE profile_id=? AND id=?').get(this.profileId,id):this.db.prepare('SELECT document FROM measurement_attempts WHERE profile_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(this.profileId)) as {document:string}|undefined;
    return row?measurementAttemptSchema.parse(JSON.parse(row.document)):null;
  }
  saveMeasurement(a:MeasurementAttempt):void {measurementAttemptSchema.parse(a);this.db.prepare('INSERT INTO measurement_attempts VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document').run(a.id,this.profileId,a.createdAt,JSON.stringify(a));}
  measurementHistory(all=false):MeasurementAttempt[] {return (this.db.prepare('SELECT document FROM measurement_attempts WHERE profile_id=? ORDER BY created_at DESC'+(all?'':' LIMIT 100')).all(this.profileId) as {document:string}[]).map(row=>measurementAttemptSchema.parse(JSON.parse(row.document)));}
  exam(id?:string):StoredExam|null {
    const row=(id?this.db.prepare('SELECT document FROM exams WHERE profile_id=? AND id=?').get(this.profileId,id):this.db.prepare("SELECT document FROM exams WHERE profile_id=? ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,created_at DESC LIMIT 1").get(this.profileId)) as {document:string}|undefined;
    return row?storedExamSchema.parse(JSON.parse(row.document)):null;
  }
  saveExam(a:StoredExam):void {storedExamSchema.parse(a);this.db.prepare('INSERT INTO exams VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,document=excluded.document').run(a.id,this.profileId,a.createdAt,a.definition.id,a.status,JSON.stringify(a));}
  examCount(definitionId:string):number {return (this.db.prepare('SELECT COUNT(*) AS n FROM exams WHERE profile_id=? AND definition_id=?').get(this.profileId,definitionId) as {n:number}).n;}
  examHistory(all=false):StoredExam[] {return (this.db.prepare('SELECT document FROM exams WHERE profile_id=? ORDER BY created_at DESC'+(all?'':' LIMIT 100')).all(this.profileId) as {document:string}[]).map(row=>storedExamSchema.parse(JSON.parse(row.document)));}
  async backup(file:string):Promise<void> {
    const normalize=(v:string)=>process.platform==='win32'?path.resolve(v).toLowerCase():path.resolve(v);
    if([this.db.name,this.db.name+'-wal',this.db.name+'-shm'].some(v=>normalize(v)===normalize(file)))throw new Error('Выберите отдельный файл резервной копии, вне файлов открытой БД.');
    await this.db.backup(file);
    if(process.platform!=='win32')await chmod(file,0o600);
  }
  close():void {this.db.close();}
}
