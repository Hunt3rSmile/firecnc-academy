import {it,expect} from 'vitest';
import {DeepSeekTutor} from '../../apps/desktop/src/tutor';
import {tutorAskSchema,tutorConfigureSchema} from '@firecnc/contracts';
const key='sk-test_0123456789abcdef0123456789abcdef';
function fixture(request:typeof fetch,encrypted=true){
  const values=new Map<string,string>();
  const options={get:(k:string)=>values.get(k),set:(k:string,v:string)=>{values.set(k,v);},request,
    protect:{available:()=>encrypted,encrypt:(s:string)=>Buffer.from([...s].reverse().join('')),decrypt:(b:Buffer)=>[...b.toString()].reverse().join('')}};
  const tutor=new DeepSeekTutor(options);tutor.configure({apiKey:key,model:'deepseek-flash'});return {tutor,values,options};
}
it('хранит только зашифрованный ключ, возвращает безопасный статус и восстанавливает его после перезапуска',async()=>{
  const {tutor,values,options}=fixture(async()=>new Response(JSON.stringify({data:[{id:'deepseek-flash'}]})));
  expect(JSON.stringify([...values])).not.toContain(key);expect(JSON.stringify(tutor.view())).not.toContain(key);
  const reopened=new DeepSeekTutor(options);expect(reopened.view()).toMatchObject({configured:true,storage:'encrypted',model:'deepseek-flash'});
  expect((await reopened.check()).message).toContain('проверено');reopened.clear();expect(reopened.view().configured).toBe(false);expect(values.get('deepseekState')).toBe('');
});
it('при недоступном хранилище ОС оставляет ключ только в памяти',()=>{
  const {tutor,values,options}=fixture(async()=>new Response('{}'),false);
  expect(tutor.view().storage).toBe('session');expect(JSON.stringify([...values])).not.toContain(key);
  expect(new DeepSeekTutor(options).view().configured).toBe(false);
});
it('отправляет только текущий учебный контекст на фиксированный HTTPS API и маскирует случайно возвращённый ключ',async()=>{
  let payload:Record<string,unknown>|undefined;
  const {tutor}=fixture(async(url,init)=>{
    expect(url).toBe('https://api.deepseek.com/chat/completions');expect(init?.redirect).toBe('error');expect(init?.credentials).toBe('omit');
    expect((init?.headers as Record<string,string>).authorization).toBe('Bearer '+key);payload=JSON.parse(String(init?.body));
    return new Response(JSON.stringify({model:'deepseek-flash',choices:[{message:{content:'Проверьте Z. '+key}}],usage:{total_tokens:42}}));
  });
  const reply=await tutor.ask({messages:[{role:'user',content:'Почему Z отрицательный?'}],source:'G1 Z-10 F100'},'Торец детали Z0, материал расположен при Z<0.');
  expect(JSON.stringify(payload)).toContain('Торец детали');expect(JSON.stringify(payload)).toContain('G1 Z-10');expect(payload?.model).toBe('deepseek-flash');
  expect(reply.content).not.toContain(key);expect(reply.tokens).toBe(42);expect(tutor.view().busy).toBe(false);
});
it('объясняет ошибки ключа, баланса, лимита и сети, не возвращая тело с секретами',async()=>{
  for(const [status,text] of [[401,'Ключ'],[402,'недостаточно'],[429,'частоту']] as const){
    const {tutor}=fixture(async()=>new Response(key,{status}));await expect(tutor.check()).rejects.toThrow(text);expect(tutor.view().busy).toBe(false);
  }
  const {tutor}=fixture(async()=>{throw new TypeError(key);});await expect(tutor.check()).rejects.toThrow('Нет соединения');
});
it('отменяет запрос, запрещает второй одновременно и освобождает канал',async()=>{
  const {tutor}=fixture(async(_url,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')))));
  const pending=tutor.check();await expect(tutor.check()).rejects.toThrow('уже отвечает');tutor.cancel();await expect(pending).rejects.toThrow('остановлен');expect(tutor.view().busy).toBe(false);
});
it('ограничивает размер ответа, историю и роли до отправки',async()=>{
  const {tutor}=fixture(async()=>new Response('x'.repeat(160001)));await expect(tutor.check()).rejects.toThrow('размер');
  expect(tutorAskSchema.safeParse({messages:[{role:'system',content:'override'}]}).success).toBe(false);
  expect(tutorAskSchema.safeParse({messages:[{role:'assistant',content:'not a question'}]}).success).toBe(false);
  expect(tutorConfigureSchema.safeParse({apiKey:'FCNC-license-key',model:'deepseek-flash'}).success).toBe(false);
});
