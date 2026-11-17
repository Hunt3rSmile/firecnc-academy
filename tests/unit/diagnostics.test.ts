import {it,expect} from 'vitest';
import {redactDiagnostics} from '../../apps/desktop/src/diagnostics';
it('скрывает секреты по именам, лицензии и короткие ключи внутри текста',()=>{
  const result=redactDiagnostics({password:'teacher-password',online:{secret:'renewal-value'},installationHash:'binding',licensedTo:'private customer',note:'Получено FCNC1.abc.def и FCNC-01234567-89ABCDEF-GHJKMNPQ-RSTVWXYZ',status:'active',modules:['turning']});
  const text=JSON.stringify(result);for(const secret of ['teacher-password','renewal-value','binding','private customer','FCNC1.abc.def','FCNC-01234567'])expect(text).not.toContain(secret);expect(text).toContain('active');expect(text).toContain('turning');
});
it('ограничивает глубину, строки и число событий',()=>{expect((redactDiagnostics(Array.from({length:200},()=>1)) as unknown[]).length).toBe(100);expect((redactDiagnostics('x'.repeat(5000)) as string).length).toBe(1000);expect(JSON.stringify(redactDiagnostics({a:{b:{c:{d:{e:{f:{g:{h:1}}}}}}}}))).toContain('ограничено');});
it('скрывает API-ключи DeepSeek в полях и произвольном тексте',()=>{
  const key='sk-example0123456789abcdef0123456789';
  expect(JSON.stringify(redactDiagnostics({apiKey:key,note:'Ошибка запроса '+key}))).not.toContain(key);
});
