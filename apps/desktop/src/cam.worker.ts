import {parentPort,workerData} from 'node:worker_threads';
import {generateCAM,verifyGeneratedCAM} from '@firecnc/cam';
import {defaultSetup} from '@firecnc/simulation';
import {projectSchema,type CAMResult} from '@firecnc/contracts';
try{
  const generated=generateCAM(workerData),validation=verifyGeneratedCAM(generated),project=projectSchema.parse({version:2,name:'CAD/CAM · '+workerData.operation,kind:generated.kind,source:generated.source,setup:defaultSetup(generated.kind),offset:{x:0,y:0,z:0},resolution:.25,toolSetId:'firecnc-basic-v1'});
  const result:CAMResult={project,target:generated.target,note:generated.note,validation};parentPort!.postMessage({ok:true,value:result});
}catch(error){parentPort!.postMessage({ok:false,error:error instanceof Error?error.message:'Траектория не построена.'});}
