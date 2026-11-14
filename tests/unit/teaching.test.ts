import {describe,it,expect} from 'vitest';
import {validateTeachingPackage,mergeTeachingPackages,createExam,examBank,exerciseSchema} from '@firecnc/learning';
import {hashPassword,checkPassword,passwordKey} from '../../apps/desktop/src/password';
import raw from '../../content/exercises.json' with {type:'json'};
const fixture=()=>({format:'firecnc-teaching',version:1,title:'Проверяемый учебный пакет',questions:[{...examBank[0]!,id:'custom-question-one',version:1}],exams:[],exercises:[{...raw[0]!,id:'custom-exercise-one',version:1}]});
describe('Преподаватель: пароль и учебные пакеты',()=>{
  it('scrypt совпадает с независимым вектором Python hashlib',async()=>{
    const key=await passwordKey('Преподаватель-2026',Buffer.from(Array.from({length:32},(_,i)=>i)));
    expect(key.toString('hex')).toBe('bc44fb726fc6f0bc7f9630925e6af5bfa70357441ac097e0569a271fda403cf0aadb78b6cb6f09604aac975d962c7c95a6b97c9fab1fc10ca00f854f7868a124');
  });
  it('соль индивидуальна, пароль проверяется, параметры KDF не подменяются',async()=>{
    const a=await hashPassword('Учебный-пароль-2026'),b=await hashPassword('Учебный-пароль-2026');expect(a.salt).not.toBe(b.salt);
    expect(await checkPassword('Учебный-пароль-2026',a)).toBe(true);expect(await checkPassword('чужой-пароль',a)).toBe(false);expect(await checkPassword('Учебный-пароль-2026',{...a,N:2})).toBe(false);
    await expect(hashPassword('1234')).rejects.toThrow();
  });
  it('собственное задание проходит независимую проверку формы; неизвестные поля запрещены',()=>{
    expect(validateTeachingPackage(fixture()).exercises).toHaveLength(1);expect(()=>validateTeachingPackage({...fixture(),trustedKeys:{}})).toThrow();
    const bad=fixture();bad.exercises[0]!.source='M30';expect(()=>validateTeachingPackage(bad)).toThrow('целевой геометрии');
  });
  it('отклоняет повтор ID, неверную связь, подмену профиля и некорректные ответы',()=>{
    const p=fixture();expect(()=>validateTeachingPackage({...p,questions:[...p.questions,...p.questions]})).toThrow();
    expect(()=>validateTeachingPackage({...p,questions:[{...p.questions[0],lessonId:'missing'}]})).toThrow();
    expect(()=>exerciseSchema.parse({...raw[0],profile:'fanuc'})).toThrow();
    expect(()=>validateTeachingPackage({...p,questions:[{...p.questions[0],correct:['missing']}]})).toThrow();
  });
  it('новый тест выбирает только указанные вопросы; новая редакция не меняет снимок',()=>{
    const p=validateTeachingPackage(fixture()),q=p.questions[0]!;
    const definition={id:'custom-test-one',version:1,title:'Точный состав',course:q.course,count:1,durationSeconds:60,passingScore:70,topics:[q.lessonId],hints:false,maxAttempts:3,questionIds:[q.id]};
    const a=createExam({id:crypto.randomUUID(),definition,now:100,seed:20,bank:mergeTeachingPackages([p]).questions});expect(a.questions[0]!.id).toBe(q.id);
    const v2=structuredClone(p);v2.questions[0]!.version=2;v2.questions[0]!.prompt='Новая редакция собственного учебного вопроса?';
    expect(mergeTeachingPackages([p,v2]).questions.filter(q=>q.id===a.questions[0]!.id)).toHaveLength(1);expect(a.questions[0]!.prompt).not.toBe(v2.questions[0]!.prompt);
  });
});
