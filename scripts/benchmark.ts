import {performance} from 'node:perf_hooks';
import {cpus,totalmem,release} from 'node:os';
import {mkdir,writeFile} from 'node:fs/promises';
import {compile} from '@firecnc/core';
import {simulate,diameterAt,depthAt} from '@firecnc/simulation';
import {DEMO_SOURCES} from '@firecnc/contracts';
const scenarios=[];
for(const kind of ['turning','milling'] as const) {
  const source=DEMO_SOURCES[kind],resolution=.25;
  simulate(compile(source,{kind}),{kind,resolution}); // Warm-up is excluded from timings.
  const before=process.memoryUsage();let pathMs=0,simulationMs=0;
  let result=simulate(compile('',{kind}),{kind,resolution});let program=compile('',{kind});
  for(let repetition=0;repetition<3;repetition++) {
    const a=performance.now();program=compile(source,{kind});const b=performance.now();
    result=simulate(program,{kind,resolution});const c=performance.now();
    if(program.error||result.collision)throw new Error('Эталонный сценарий не прошёл.');
    pathMs+=b-a;simulationMs+=c-b;
  }
  const expectedVolume=kind==='turning'?Math.PI*(20**2-15**2)*30:60*10*3;
  scenarios.push({kind,resolution,grid:result.material.kind==='turning'?[result.material.nr,result.material.nz]:[result.material.nx,result.material.ny],
    sourceLines:source.split('\n').length,events:program.events.length,segments:program.segments,samples:result.samples,
    pathMilliseconds:pathMs/3,simulationMilliseconds:simulationMs/3,rssBefore:before.rss,rssAfter:process.memoryUsage().rss,
    expectedVolume,actualVolume:result.removedVolume,volumeAbsoluteError:Math.abs(result.removedVolume-expectedVolume),
    measured:result.material.kind==='turning'?diameterAt(result.material,-15):depthAt(result.material,30,20),expectedMeasurement:kind==='turning'?30:3,uncertainty:result.uncertainty});
}
const report={date:new Date().toISOString(),runtime:process.version,platform:process.platform,os:release(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,memoryBytes:totalmem(),repetitions:3,maxProcessRssKiB:process.resourceUsage().maxRSS,scenarios};
await mkdir('docs/benchmarks',{recursive:true});await writeFile('docs/benchmarks/linux-x64.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
