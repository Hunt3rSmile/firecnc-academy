import {compile} from '@firecnc/core';
import {simulate} from '@firecnc/simulation';
import type {ComputeRequest,ComputeResponse} from '@firecnc/contracts';
self.onmessage=(event:MessageEvent<ComputeRequest>)=>{
  const {id,project,frame}=event.data;
  const post=(value:ComputeResponse)=>self.postMessage(value);
  try {
    const program=compile(project.source,{kind:project.kind,offset:project.offset});
    let last=-1;
    const simulation=simulate(program,{kind:project.kind,resolution:project.resolution,offset:project.offset,setup:project.setup,frame:frame??undefined,onProgress:n=>{const percent=Math.floor(n*10);if(percent!==last){post({type:'progress',id,progress:n});last=percent;}}});
    post({type:'done',id,program,simulation});
  } catch(e) {post({type:'error',id,message:e instanceof Error?e.message:'Ошибка расчёта.'});}
};
