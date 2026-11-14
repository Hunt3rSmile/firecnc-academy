import Database from 'better-sqlite3';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {CNCProject,AttemptView} from '@firecnc/contracts';
import {grade,introQuestions} from '@firecnc/learning';
export class Store {
  constructor(public db:Database.Database) {}
  static async open(directory:string):Promise<Store> {
    await mkdir(directory,{recursive:true});
    const db=new Database(path.join(directory,'academy.sqlite'));
    db.pragma('journal_mode = WAL');db.pragma('foreign_keys = ON');db.pragma('busy_timeout = 5000');
    const version=db.pragma('user_version',{simple:true}) as number;
    if(version>1){db.close();throw new Error('Эта БД создана более новой версией приложения. Восстановите новую версию.');}
    if(version<1) {
      if(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length)await db.backup(path.join(directory,`before-migration-${Date.now()}.sqlite`));
      db.transaction(()=>{
        db.exec(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS progress(profile_id TEXT NOT NULL REFERENCES profiles(id),lesson_id TEXT NOT NULL,completed_at INTEGER NOT NULL,PRIMARY KEY(profile_id,lesson_id));
          CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id),created_at INTEGER NOT NULL,score INTEGER NOT NULL,total INTEGER NOT NULL,answers TEXT NOT NULL,questions TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS projects(profile_id TEXT PRIMARY KEY REFERENCES profiles(id),document TEXT NOT NULL);
          PRAGMA user_version=1;`);
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
  completed():string[] {return (this.db.prepare('SELECT lesson_id FROM progress WHERE profile_id=?').all(this.profileId) as {lesson_id:string}[]).map(r=>r.lesson_id);}
  complete(id:string):void {this.db.prepare('INSERT INTO progress VALUES (?,?,?) ON CONFLICT(profile_id,lesson_id) DO UPDATE SET completed_at=excluded.completed_at').run(this.profileId,id,Date.now());}
  submit(answers:Record<string,string[]>):void {
    const result=grade(answers);this.db.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?,?)').run(randomUUID(),this.profileId,Date.now(),result.score,result.total,JSON.stringify(answers),JSON.stringify(introQuestions));
  }
  attempts():AttemptView[] {
    return (this.db.prepare('SELECT * FROM attempts WHERE profile_id=? ORDER BY created_at DESC LIMIT 100').all(this.profileId) as {id:string;created_at:number;score:number;total:number;answers:string;questions:string}[])
      .map(r=>({id:r.id,createdAt:r.created_at,score:r.score,total:r.total,answers:JSON.parse(r.answers) as Record<string,string[]>,questions:JSON.parse(r.questions) as unknown[]}));
  }
  project():CNCProject|null {const r=this.db.prepare('SELECT document FROM projects WHERE profile_id=?').get(this.profileId) as {document:string}|undefined;return r?JSON.parse(r.document) as CNCProject:null;}
  saveProject(p:CNCProject):void {this.db.prepare('INSERT INTO projects VALUES (?,?) ON CONFLICT(profile_id) DO UPDATE SET document=excluded.document').run(this.profileId,JSON.stringify(p));}
  async backup(file:string):Promise<void> {
    const normalize=(v:string)=>process.platform==='win32'?path.resolve(v).toLowerCase():path.resolve(v);
    if([this.db.name,this.db.name+'-wal',this.db.name+'-shm'].some(v=>normalize(v)===normalize(file)))throw new Error('Выберите отдельный файл резервной копии, вне файлов открытой БД.');
    await this.db.backup(file);
  }
  close():void {this.db.close();}
}
