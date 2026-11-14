import {parentPort,workerData} from 'node:worker_threads';
import {validateTeachingPackage} from '@firecnc/learning';
try{parentPort!.postMessage({ok:true,value:validateTeachingPackage(workerData)});}catch(error){parentPort!.postMessage({ok:false,error:error instanceof Error?error.message:'Неверный учебный пакет.'});}
