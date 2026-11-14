import {z} from 'zod';
import type {SimulationResult} from '@firecnc/simulation';
const region=z.strictObject({left:z.number(),right:z.number(),bottom:z.number(),top:z.number(),radius:z.number().min(0),depth:z.number().min(0)}).refine(r=>r.left<r.right&&r.bottom<r.top&&r.radius*2<=Math.min(r.right-r.left,r.top-r.bottom));
export const targetSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('turning'),diameter:z.number().positive(),length:z.number().positive(),front:z.number().max(0),regions:z.array(z.strictObject({from:z.number(),to:z.number(),diameter:z.number().min(0)}).refine(r=>r.from<r.to)).max(30)}),
  z.strictObject({kind:z.literal('milling'),width:z.number().positive(),depth:z.number().positive(),thickness:z.number().positive(),regions:z.array(region).max(30)})
]);
export type GeometryTarget=z.infer<typeof targetSchema>;
// Signed distance to an analytic rounded rectangle, independent of the tool sweep algorithm.
function distanceToRegion(x:number,y:number,r:{left:number;right:number;bottom:number;top:number;radius:number}):number {
  const qx=Math.abs(x-(r.left+r.right)/2)-(r.right-r.left)/2+r.radius,qy=Math.abs(y-(r.bottom+r.top)/2)-(r.top-r.bottom)/2+r.radius;
  return Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-r.radius;
}
export function gradeGeometry(target:GeometryTarget,result:SimulationResult):{passed:boolean;checkedCells:number;wrongCells:number;message:string} {
  const m=result.material,tolerance=result.uncertainty;
  let checkedCells=0,wrongCells=0;
  const dimensions=m.kind==='turning'&&target.kind==='turning'?Math.abs(m.radius*2-target.diameter)<1e-8&&Math.abs(m.length-target.length)<1e-8:m.kind==='milling'&&target.kind==='milling'?Math.abs(m.width-target.width)<1e-8&&Math.abs(m.depth-target.depth)<1e-8&&Math.abs(-m.bottom-target.thickness)<1e-8:false;
  if(!dimensions)return {passed:false,checkedCells:0,wrongCells:0,message:'Размеры исходной заготовки не соответствуют заданию. Загрузите условия задания.'};
  if(m.kind==='turning'&&target.kind==='turning'){
    const boundaries=[target.front,...target.regions.flatMap(r=>[r.from,r.to])];
    for(let iz=0;iz<m.nz;iz++){
      const z=m.zMin+(iz+.5)*m.length/m.nz;if(boundaries.some(b=>Math.abs(z-b)<=tolerance))continue;
      const radius=z>target.front?0:Math.min(target.diameter/2,...target.regions.filter(r=>z>r.from&&z<r.to).map(r=>r.diameter/2));
      for(let ir=0;ir<m.nr;ir++){
        const r=(ir+.5)*m.resolution;if(Math.abs(r-radius)<=tolerance)continue;
        checkedCells++;if((m.occupied[iz*m.nr+ir]===1)!==(r<radius))wrongCells++;
      }
    }
  }else if(m.kind==='milling'&&target.kind==='milling'){
    for(let iy=0;iy<m.ny;iy++)for(let ix=0;ix<m.nx;ix++){
      const x=(ix+.5)*m.width/m.nx,y=(iy+.5)*m.depth/m.ny;
      const regions=target.regions.map(r=>({r,d:distanceToRegion(x,y,r)}));
      if(regions.some(({d})=>Math.abs(d)<=tolerance))continue;
      const depth=Math.max(0,...regions.filter(({d})=>d<0).map(({r})=>r.depth));
      checkedCells++;if(Math.abs(m.heights[iy*m.nx+ix]!+depth)>tolerance)wrongCells++;
    }
  }
  return {passed:checkedCells>0&&wrongCells===0,checkedCells,wrongCells,message:wrongCells?`Форма отличается от чертежа в ${wrongCells} проверяемых ячейках. Проверьте необработанные участки и лишний съём.`:'Вся доступная форма соответствует чертежу с учётом погрешности сетки.'};
}
