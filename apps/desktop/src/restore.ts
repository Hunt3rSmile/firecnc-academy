import Database from 'better-sqlite3';
import {stat,chmod,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {projectSchema} from '@firecnc/contracts';
import {strictJSON} from '@firecnc/licensing';
import {questionSchema,coordinateAttemptSchema,measurementAttemptSchema,storedExamSchema,examQuestionSchema,examDefinitionSchema,exerciseSchema,workshopStateSchema} from '@firecnc/learning';
import {camDocumentSchema} from '@firecnc/cam';
import {targetSchema} from '../../../packages/learning/src/geometry-grade';
const MAX_BACKUP=64*1024*1024;
const tables=new Set(['settings','profiles','progress','attempts','projects','coordinate_attempts','practice_attempts','measurement_attempts','exams','teaching_content','audit']);
export async function inspectBackup(file:string):Promise<void> {
  if((await stat(file)).size>MAX_BACKUP)throw new Error('Резервная копия превышает 64 МБ.');
  let db:Database.Database|undefined;
  try{
    db=new Database(file,{readonly:true,fileMustExist:true});
    const version=db.pragma('user_version',{simple:true}) as number;if(version<0||version>6)throw new Error('Резервная копия создана неподдерживаемой версией.');
    if(db.pragma('quick_check',{simple:true})!=='ok'||(db.pragma('foreign_key_check') as unknown[]).length)throw new Error('Нарушена целостность резервной копии.');
    const names=db.prepare("SELECT name,type FROM sqlite_master WHERE type IN ('table','view','trigger') AND name NOT LIKE 'sqlite_%'").all() as {name:string;type:string}[];
    if(names.some(n=>n.type!=='table'||!tables.has(n.name))||['settings','profiles','progress','attempts','projects'].some(name=>!names.some(n=>n.name===name)))throw new Error('Файл не является поддерживаемой резервной копией FireCNC.');
    const setting=(key:string)=>(db!.prepare('SELECT value FROM settings WHERE key=?').get(key) as {value:string}|undefined)?.value;
    z.string().uuid().parse(setting('installationId'));const profile=z.string().uuid().parse(setting('profileId'));
    if(!db.prepare('SELECT id,name FROM profiles WHERE id=?').get(profile))throw new Error('В копии отсутствует текущий профиль.');
    for(const row of db.prepare('SELECT id,name FROM profiles').all())z.strictObject({id:z.string().uuid(),name:z.string().min(1).max(80)}).parse(row);
    const json=(text:string)=>{if(Buffer.byteLength(text,'utf8')>2000000)throw new Error('Запись в резервной копии превышает допустимый размер.');return strictJSON(text,{maxDepth:18,maxNodes:50000});};
    const validateRows=(table:string,schema:z.ZodType)=>{if(names.some(n=>n.name===table))for(const row of db!.prepare(`SELECT document FROM ${table}`).all() as {document:string}[])schema.parse(json(row.document));};
    validateRows('projects',projectSchema);validateRows('coordinate_attempts',coordinateAttemptSchema);validateRows('measurement_attempts',measurementAttemptSchema);validateRows('exams',storedExamSchema);
    const check=z.object({name:z.string(),value:z.number().nullable(),expected:z.number(),tolerance:z.number().nonnegative(),passed:z.boolean()});
    validateRows('practice_attempts',z.object({id:z.string().uuid(),createdAt:z.number().int().nonnegative(),project:projectSchema,exercise:z.object({id:z.string(),title:z.string(),lesson:z.string(),version:z.number().int().positive(),target:targetSchema}),grade:z.object({score:z.number().min(0).max(100),passed:z.boolean(),checks:z.array(check),geometry:z.object({passed:z.boolean(),checkedCells:z.number().nonnegative(),wrongCells:z.number().nonnegative(),message:z.string()})}),diagnostic:z.object({line:z.number().int().positive(),message:z.string(),fix:z.string()}).nullable(),statistics:z.object({removedVolume:z.number().nonnegative(),seconds:z.number().nonnegative(),completed:z.number().nonnegative(),frames:z.number().nonnegative(),uncertainty:z.number().positive()})}));
    for(const row of db.prepare('SELECT questions,answers FROM attempts').all() as {questions:string;answers:string}[]){z.array(questionSchema).max(50).parse(json(row.questions));z.record(z.string(),z.array(z.string())).parse(json(row.answers));}
    if(names.some(n=>n.name==='teaching_content'))for(const row of db.prepare('SELECT kind,document FROM teaching_content').all() as {kind:string;document:string}[]){const schema={questions:examQuestionSchema,exams:examDefinitionSchema,exercises:exerciseSchema}[row.kind];if(!schema)throw new Error('Неизвестный тип учебного материала в копии.');schema.parse(json(row.document));}
    for(const row of db.prepare("SELECT key,value FROM settings WHERE key LIKE 'workshop:%' OR key LIKE 'cam:%'").all() as {key:string;value:string}[]){
      if(row.key.startsWith('workshop:'))workshopStateSchema.parse(json(row.value));else z.strictObject({document:camDocumentSchema,result:z.strictObject({project:projectSchema,target:targetSchema,note:z.string(),validation:z.strictObject({passed:z.literal(true),removedVolume:z.number().nonnegative(),analyticVolume:z.number().nonnegative(),volumeError:z.number().nonnegative(),uncertainty:z.number().positive(),frames:z.number().int().positive()})}).nullable()}).parse(json(row.value));
    }
  }catch(error){
    if(error instanceof z.ZodError||error&&typeof error==='object'&&'code' in error&&String(error.code).startsWith('SQLITE'))throw new Error('Файл резервной копии повреждён или не соответствует формату FireCNC. Текущие данные сохранены.');
    throw error;
  }finally{db?.close();}
}
export async function prepareRestore(file:string,directory:string):Promise<string> {
  await inspectBackup(file);const candidate=path.join(directory,`restore-candidate-${randomUUID()}.sqlite`),source=new Database(file,{readonly:true,fileMustExist:true});
  try{await source.backup(candidate);if(process.platform!=='win32')await chmod(candidate,0o600);await inspectBackup(candidate);return candidate;}
  catch(error){await unlink(candidate).catch(()=>{});throw error;}finally{source.close();}
}
