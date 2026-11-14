import {parentPort,workerData} from 'node:worker_threads';
import {compile} from '@firecnc/core';
import {simulate} from '@firecnc/simulation';
import {exercises,assess} from '@firecnc/learning';
import {projectSchema,type PracticeAttempt} from '@firecnc/contracts';
try {
  const data=workerData as {id:string;createdAt:number;exerciseId:string;project:unknown},project=projectSchema.parse(data.project);
  const exercise=exercises.find(e=>e.id===data.exerciseId&&e.kind===project.kind);if(!exercise)throw new Error('Задание не найдено для этого станка.');
  const program=compile(project.source,{kind:project.kind,offset:project.offset}),result=simulate(program,{kind:project.kind,setup:project.setup,resolution:project.resolution,offset:project.offset});
  const grade=assess(exercise,result,{completed:!program.error&&result.completed===program.events.length});
  const attempt:PracticeAttempt={id:data.id,createdAt:data.createdAt,exercise:{id:exercise.id,version:exercise.version,title:exercise.title,lesson:exercise.lesson,target:exercise.target},project,grade,diagnostic:program.error??result.collision,statistics:{removedVolume:result.removedVolume,seconds:program.events.slice(0,result.completed).reduce((sum,e)=>sum+e.seconds,0),completed:result.completed,frames:program.events.length,uncertainty:result.uncertainty}};
  parentPort!.postMessage({ok:true,value:attempt});
}catch(error){parentPort!.postMessage({ok:false,error:error instanceof Error?error.message:'Не удалось проверить практику.'});}
