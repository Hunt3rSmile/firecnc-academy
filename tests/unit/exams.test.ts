import {describe,it,expect} from 'vitest';
import {examBank,examDefinitions,createExam,answerExam,finishExam,tickExam,examView,navigateExam,useExamHint,storedExamSchema,validateExamBank,type ExamQuestion,type ExamDefinition} from '@firecnc/learning';
const id='5552592d-dc84-4010-a9bb-82ae578e8148',now=100000;
const definition=(changes:Partial<ExamDefinition>={}):ExamDefinition=>({...examDefinitions[0]!,topics:[...new Set(examBank.filter(q=>q.course==='turning').map(q=>q.lessonId))],...changes});
const create=(changes:Partial<ExamDefinition>={})=>createExam({id,definition:definition(changes),seed:2026,now});
describe('Воспроизводимый локальный экзамен',()=>{
  it('имеет все восемь типов вопросов и проверяемые фрагменты программ',()=>{
    expect(new Set(examBank.map(q=>q.type)).size).toBe(8);expect(examBank).toHaveLength(120);expect(new Set(examBank.map(q=>q.prompt)).size).toBe(120);expect(()=>validateExamBank(examBank)).not.toThrow();
    const broken=structuredClone(examBank),q=broken.find(q=>q.type==='program-result')!;if(q.type==='program-result')q.expected+=1;
    expect(()=>validateExamBank(broken)).toThrow('результат');
  });
  it('фиксирует вопросы и порядок вариантов по seed и скрывает ответы до завершения',()=>{
    const a=create();expect(create()).toEqual(a);expect(createExam({id,definition:a.definition,seed:99,now}).questions).not.toEqual(a.questions);
    const view=examView(a);expect(view.review).toBeNull();for(const q of view.questions)for(const key of ['correct','expected','explanation','mistake'])expect(key in q).toBe(false);
  });
  it('оценивает несколько вариантов только полным правильным набором',()=>{
    const question=examBank.find(q=>q.id==='et-safe')!;const a=createExam({id,definition:definition({count:1}),seed:1,now,bank:[question]});
    expect(examView(finishExam(answerExam(a,question.id,['tool'],now+10),now+20)).review?.score).toBe(0);
    expect(examView(finishExam(answerExam(a,question.id,['spindle','tool'],now+10),now+20)).review?.score).toBe(100);
    expect(()=>answerExam(a,question.id,['tool','tool'],now+10)).toThrow();
  });
  it('проверяет числовой допуск и запятую',()=>{
    const q=examBank.find(q=>q.id==='et-time')!;const a=createExam({id,definition:definition({count:1}),seed:1,now,bank:[q]});
    expect(examView(finishExam(answerExam(a,q.id,'30,005',now+10),now+20)).review?.score).toBe(100);
    expect(examView(finishExam(answerExam(a,q.id,'30,02',now+10),now+20)).review?.score).toBe(0);
  });
  it('проверяет порядок, узел, результат программы, ошибку и шкалу',()=>{
    const selected=examBank.filter(q=>['order','node','program-result','program-error','measurement'].includes(q.type)&&q.course==='turning');
    for(const q of selected){const a=createExam({id,definition:definition({count:1}),seed:1,now,bank:[q]});const answer=q.type==='order'?q.correct:q.type==='node'?q.expected:q.type==='measurement'?String(q.ticks/100):'expected' in q?String(q.expected):'';
      expect(examView(finishExam(answerExam(a,q.id,answer,now+1),now+2)).review?.score).toBe(100);
    }
  });
  it('сохраняет разбор после изменения банка',()=>{
    const q=structuredClone(examBank.find(q=>q.id==='et-time')!);const a=createExam({id,definition:definition({count:1}),seed:1,now,bank:[q]});const saved=storedExamSchema.parse(JSON.parse(JSON.stringify(answerExam(a,q.id,'30',now+1))));
    if(q.type==='numeric')q.expected=999;
    expect(examView(finishExam(saved,now+2)).review?.score).toBe(100);expect(saved.questions[0]).not.toEqual(q);
  });
  it('считает закрытое приложение частью времени и не увеличивает время при откате часов',()=>{
    const a=create({durationSeconds:60});const moved=navigateExam(a,1,now+10000);expect(moved.timeByQuestion[a.questions[0]!.id]).toBe(10000);
    const rollback=tickExam(moved,now+5000);expect(rollback.lastSeenAt).toBe(now+10000);expect(rollback.deadline).toBe(a.deadline);
    const expired=tickExam(rollback,now+60000);expect(expired.status).toBe('expired');expect(expired.finishedAt).toBe(a.deadline);expect(examView(expired).review?.correct).toBe(0);
    expect(()=>answerExam(expired,expired.questions[0]!.id,'0',now+60001)).toThrow('завершены');
  });
  it('отклоняет неизвестные вопросы, варианты и недостаточный банк',()=>{
    const a=create();expect(()=>answerExam(a,'missing','0',now+1)).toThrow('отсутствует');
    expect(()=>create({topics:['missing']})).toThrow('доступно 0');
    const single=examBank.find(q=>q.type==='single')!;const b=createExam({id,definition:definition({count:1}),seed:1,now,bank:[single]});expect(()=>answerExam(b,single.id,'missing',now+1)).toThrow('вариантах');
  });
  it('учитывает подсказки и запрет определения',()=>{
    const a=create({hints:true});const q=a.questions[0]!.id;expect(useExamHint(useExamHint(a,q,now+1),q,now+2).hintsUsed).toEqual([q]);
    expect(()=>useExamHint(create({hints:false}),q,now+1)).toThrow('недоступна');
  });
});
