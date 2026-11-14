import {describe,it,expect,vi,afterEach} from 'vitest';
import {UpdateChecker,type UpdateTransport} from '../../apps/desktop/src/updates';
const source={owner:'Hunt3rSmile',repository:'firecnc-academy'};
const response=(tag_name:string,extra:Record<string,unknown>={})=>new Response(JSON.stringify({tag_name,draft:false,prerelease:false,body:'Список изменений',...extra}),{headers:{'content-type':'application/json'}});
const create=(request:UpdateTransport,extra:Partial<ConstructorParameters<typeof UpdateChecker>[0]>={})=>new UpdateChecker({source,version:'0.2.0',automatic:true,packaged:false,request,...extra});
afterEach(()=>vi.useRealTimers());
describe('Проверка GitHub Releases',()=>{
  it('сравнивает числовые части версий и предлагает новый выпуск',async()=>{
    const request=vi.fn(async()=>response('v0.10.0'));
    const checker=create(request);const view=await checker.check();
    expect(view.status).toBe('available');expect(view.latestVersion).toBe('0.10.0');
    expect(checker.releaseURL()).toBe('https://github.com/Hunt3rSmile/firecnc-academy/releases/tag/v0.10.0');
    const [url,options]=request.mock.calls[0] as unknown as [string,{headers:Record<string,string>}];
    expect(url).toBe('https://api.github.com/repos/Hunt3rSmile/firecnc-academy/releases/latest');
    expect(options.headers.Authorization).toBeUndefined();expect(JSON.stringify(options)).not.toContain('FCNC1');
  });
  it.each(['v0.2.0','v0.1.99'])('не предлагает одинаковую или старую %s',async tag=>{
    const checker=create(async()=>response(tag));expect((await checker.check()).status).toBe('current');expect(checker.releaseURL()).toBeNull();
  });
  it.each([{draft:true},{prerelease:true},{tag_name:'v0.3.0-beta.1'}])('не включает тестовый выпуск %j',async extra=>{
    expect((await create(async()=>response('v0.3.0',extra)).check()).status).toBe('current');
  });
  it('отсутствие выпусков обрабатывает спокойно',async()=>{
    expect((await create(async()=>new Response('',{status:404})).check()).status).toBe('current');
  });
  it('не использует внешнюю ссылку из ответа сервера',async()=>{
    const checker=create(async()=>response('v1.0.0',{html_url:'file:///tmp/malware.exe'}));await checker.check();
    expect(checker.releaseURL()).toBe('https://github.com/Hunt3rSmile/firecnc-academy/releases/tag/v1.0.0');
  });
  it.each(['../../1.0.0','javascript:alert(1)','v3'])('отклоняет некорректный tag %s',async tag=>{
    const checker=create(async()=>response(tag));expect((await checker.check()).status).toBe('error');expect(checker.releaseURL()).toBeNull();
  });
  it('не ломает приложение без интернета',async()=>{
    const checker=create(async()=>{throw new TypeError('fetch failed');});
    expect(await checker.check()).toMatchObject({status:'error',releaseUrl:null});expect(checker.snapshot().message).toContain('автономно');
  });
  it('ограничивает размер и проверяет формат ответа',async()=>{
    for(const value of [new Response('<html>error</html>'),new Response('{}'),new Response('x',{headers:{'content-length':'2000000'}}),new Response('x'.repeat(1024*1024+1))]) {
      expect((await create(async()=>value).check()).status).toBe('error');
    }
  });
  it('показывает понятное ограничение частоты GitHub',async()=>{
    expect((await create(async()=>new Response('',{status:429})).check()).message).toContain('ограничил');
  });
  it('объединяет параллельные запросы и сохраняет короткий кэш',async()=>{
    let now=100000,resolve!:(value:Response)=>void;
    const request=vi.fn(()=>new Promise<Response>(r=>{resolve=r;}));
    const checker=create(request,{now:()=>now});const a=checker.check(),b=checker.check();expect(a).toBe(b);expect(request).toHaveBeenCalledTimes(1);
    resolve(response('v1.0.0'));await a;await checker.check();expect(request).toHaveBeenCalledTimes(1);
    now+=61000;const again=checker.check();resolve(response('v1.1.0'));await again;expect(request).toHaveBeenCalledTimes(2);
  });
  it('автоматически проверяет при запуске и отключается переключателем',async()=>{
    vi.useFakeTimers();const request=vi.fn(async()=>response('v0.2.0'));
    const checker=create(request,{packaged:true});checker.start();await vi.advanceTimersByTimeAsync(9999);expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);expect(request).toHaveBeenCalledTimes(1);
    checker.setAutomatic(false);await vi.advanceTimersByTimeAsync(7*60*60*1000);expect(request).toHaveBeenCalledTimes(1);checker.stop();
  });
  it('development не начинает фоновый доступ в сеть',async()=>{
    vi.useFakeTimers();const request=vi.fn(async()=>response('v1.0.0'));
    const checker=create(request);checker.start();await vi.advanceTimersByTimeAsync(7*60*60*1000);expect(request).not.toHaveBeenCalled();checker.stop();
  });
});
