import {z} from 'zod';
import {valid,gt,prerelease} from 'semver';
import type {UpdateView} from '@firecnc/contracts';

export interface UpdateSource {owner:string;repository:string}
export interface UpdateRequest {headers:Record<string,string>;signal:AbortSignal}
export type UpdateTransport=(url:string,options:UpdateRequest)=>Promise<Response>;
const releaseSchema=z.object({tag_name:z.string().max(100),draft:z.boolean(),prerelease:z.boolean(),body:z.string().max(100000).nullish()});
const MAX_RESPONSE=1024*1024;
const SIX_HOURS=6*60*60*1000;

async function boundedJSON(response:Response):Promise<unknown> {
  const advertised=Number(response.headers.get('content-length')??0);
  if(advertised>MAX_RESPONSE)throw new Error('Ответ сервера обновлений превышает допустимый размер.');
  if(!response.body)throw new Error('Сервер обновлений вернул пустой ответ.');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];
  let size=0;
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_RESPONSE)throw new Error('Ответ сервера обновлений слишком велик.');chunks.push(value);}
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;
}

export class UpdateChecker {
  private view:UpdateView;
  private pending:Promise<UpdateView>|null=null;
  private controller:AbortController|null=null;
  private timer:ReturnType<typeof setTimeout>|null=null;
  private stopped=false;
  private readonly now:()=>number;
  constructor(private options:{version:string;source:UpdateSource;request:UpdateTransport;automatic:boolean;packaged:boolean;onChange?:(value:UpdateView)=>void;now?:()=>number}) {
    if(!valid(options.version)||!/^[a-zA-Z0-9-]{1,39}$/.test(options.source.owner)||!/^[a-zA-Z0-9_.-]{1,100}$/.test(options.source.repository))throw new Error('Некорректная конфигурация источника обновлений.');
    this.now=options.now??Date.now;
    this.view={status:'idle',currentVersion:options.version,latestVersion:null,releaseUrl:null,releaseNotes:'',checkedAt:null,automatic:options.automatic,packaged:options.packaged,message:'Обновления ещё не проверялись.'};
  }
  snapshot():UpdateView {return {...this.view};}
  private publish(patch:Partial<UpdateView>):UpdateView {this.view={...this.view,...patch};this.options.onChange?.(this.snapshot());return this.snapshot();}
  start():void {this.stopped=false;this.schedule(10000);}
  private schedule(delay:number):void {
    if(this.timer)clearTimeout(this.timer);this.timer=null;
    if(this.stopped||!this.options.packaged||!this.view.automatic)return;
    this.timer=setTimeout(()=>{void this.check().finally(()=>this.schedule(SIX_HOURS));},delay);
    this.timer.unref?.();
  }
  setAutomatic(value:boolean):UpdateView {
    const result=this.publish({automatic:value});
    this.schedule(value?1000:SIX_HOURS);return result;
  }
  check():Promise<UpdateView> {
    if(this.pending)return this.pending;
    if(this.view.checkedAt!==null&&this.now()>=this.view.checkedAt&&this.now()-this.view.checkedAt<60000&&this.view.status!=='error')return Promise.resolve(this.snapshot());
    this.publish({status:'checking',message:'Проверяем новые выпуски на GitHub…'});
    this.pending=this.requestLatest().finally(()=>{this.pending=null;});return this.pending;
  }
  private async requestLatest():Promise<UpdateView> {
    const controller=new AbortController();this.controller=controller;
    const timeout=setTimeout(()=>controller.abort(),12000);timeout.unref?.();
    try {
      const source=this.options.source;
      const response=await this.options.request(`https://api.github.com/repos/${source.owner}/${source.repository}/releases/latest`,{signal:controller.signal,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':`FireCNC-Academy/${this.options.version}`}});
      if(response.status===404)return this.publish({status:'current',checkedAt:this.now(),latestVersion:null,releaseUrl:null,releaseNotes:'',message:'Новых опубликованных выпусков пока нет.'});
      if(response.status===403||response.status===429)throw new Error('GitHub временно ограничил частоту проверок. Попробуйте позже.');
      if(!response.ok)throw new Error(`Сервер обновлений недоступен (HTTP ${response.status}).`);
      const parsed=releaseSchema.safeParse(await boundedJSON(response));
      if(!parsed.success)throw new Error('Сервер обновлений вернул неподходящий формат ответа.');
      const release=parsed.data,version=valid(release.tag_name.replace(/^v/,''));
      if(!version)throw new Error('В опубликованном выпуске указан некорректный номер версии.');
      if(release.draft||release.prerelease||prerelease(version)!==null)return this.publish({status:'current',checkedAt:this.now(),latestVersion:null,releaseUrl:null,releaseNotes:'',message:'Новых обычных выпусков пока нет.'});
      const available=gt(version,this.options.version);
      return this.publish({status:available?'available':'current',checkedAt:this.now(),latestVersion:version,releaseUrl:available?`https://github.com/${source.owner}/${source.repository}/releases/tag/${encodeURIComponent(release.tag_name)}`:null,releaseNotes:(release.body??'').slice(0,6000),message:available?`Доступна версия ${version}.`:'У вас последняя версия.'});
    } catch(error) {
      return this.publish({status:'error',checkedAt:this.now(),releaseUrl:null,message:error instanceof Error&&error.name!=='AbortError'&&!(error instanceof TypeError)&&!(error instanceof SyntaxError)?error.message:'Не удалось связаться с GitHub. Проверьте интернет и повторите позже. Обучение продолжает работать автономно.'});
    } finally {clearTimeout(timeout);this.controller=null;}
  }
  releaseURL():string|null {
    const url=this.view.releaseUrl;if(!url||this.view.status!=='available')return null;
    const parsed=new URL(url),base=`/${this.options.source.owner}/${this.options.source.repository}/releases/tag/`;
    return parsed.protocol==='https:'&&parsed.hostname==='github.com'&&!parsed.username&&!parsed.password&&parsed.pathname.startsWith(base)&&!parsed.search&&!parsed.hash?url:null;
  }
  stop():void {this.stopped=true;if(this.timer)clearTimeout(this.timer);this.timer=null;this.controller?.abort();}
}
