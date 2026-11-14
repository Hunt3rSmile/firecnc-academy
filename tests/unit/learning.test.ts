import {describe,it,expect} from 'vitest';
import {lessons,questions,introQuestions,grade,decimalAnswer,validateContent} from '@firecnc/learning';
describe('Содержательный вводный контроль',()=>{
  it('проверяет схему, ID, связи и разные тексты вопросов',()=>{expect(validateContent).not.toThrow();expect(new Set(questions.map(q=>q.prompt)).size).toBe(questions.length);expect(lessons.length).toBe(6);});
  it('оценивает все ответы и объясняет ошибки',()=>{
    const answers=Object.fromEntries(introQuestions.map(q=>[q.id,q.correct.map(String)]));
    expect(grade(answers).score).toBe(6);answers[introQuestions[0]!.id]=['2'];const r=grade(answers);expect(r.score).toBe(5);expect(r.details[0]!.question.mistake.length).toBeGreaterThan(20);
  });
  it('снимок вопроса сохраняет разбор после изменения банка',()=>{
    const snapshot=structuredClone(introQuestions),answers=Object.fromEntries(snapshot.map(q=>[q.id,q.correct.map(String)]));
    const changed=structuredClone(snapshot);changed[0]!.correct=[2];
    expect(grade(answers,snapshot).score).toBe(6);expect(grade(answers,changed).score).toBe(5);
  });
  it.each([['12,35',12.35],['12.35',12.35],[' 0 ',0],['.5',.5],['1,2,3',null],['1e2',null],['abc',null]])('числовой ответ %s', (input,expected)=>{expect(decimalAnswer(input as string)).toBe(expected);});
});
