import {distance,interpolate,initialState,type Vec3,type Program,type MachineKind,type ModalState,type MachineEvent} from '@firecnc/core';
export interface TurningStock {kind:'turning';resolution:number;nr:number;nz:number;radius:number;length:number;zMin:number;occupied:Uint8Array}
export interface MillingStock {kind:'milling';resolution:number;nx:number;ny:number;width:number;depth:number;bottom:number;heights:Float32Array}
export type Material = TurningStock | MillingStock;
export interface Collision {code:string;line:number;message:string;fix:string;objects:string[];hitPosition:Vec3}
export interface SimulationResult {material:Material;completed:number;state:ModalState;collision:Collision|null;removedVolume:number;samples:number;uncertainty:number}
export interface SimulationOptions {kind:MachineKind;resolution?:number;frame?:number;offset?:Vec3;onProgress?:(n:number)=>void}
type Box={min:Vec3;max:Vec3;name:string};
export const SIM_LIMITS={cells:250000,samples:300000,cellVisits:20000000};
export function createMaterial(kind:MachineKind,resolution=0.25):Material {
  if(!Number.isFinite(resolution)||resolution<0.1||resolution>1)throw new Error('Шаг сетки должен быть от 0,1 до 1 мм.');
  if(kind==='turning') {
    const nr=Math.ceil(20/resolution),nz=Math.ceil(60/resolution);
    if(nr*nz>SIM_LIMITS.cells)throw new Error('Сетка слишком велика.');
    return {kind,resolution:20/nr,nr,nz,radius:20,length:60,zMin:-60,occupied:new Uint8Array(nr*nz).fill(1)};
  }
  const nx=Math.ceil(60/resolution),ny=Math.ceil(40/resolution);
  if(nx*ny>SIM_LIMITS.cells)throw new Error('Сетка превышает 250000 ячеек. Увеличьте шаг.');
  return {kind,resolution:60/nx,nx,ny,width:60,depth:40,bottom:-15,heights:new Float32Array(nx*ny)};
}
function overlap(a:Box,b:Box,margin=0):boolean {return (['x','y','z'] as const).every(k=>a.min[k]-margin<=b.max[k]&&a.max[k]+margin>=b.min[k]);}
function cylinderBox(p:Vec3,r:number,low:number,high:number,b:Box,margin:number):boolean {
  if(high+margin<b.min.z||low-margin>b.max.z)return false;
  const dx=Math.max(b.min.x-p.x,0,p.x-b.max.x),dy=Math.max(b.min.y-p.y,0,p.y-b.max.y);
  return dx*dx+dy*dy<=(r+margin)**2;
}
const box=(x:number,y:number,z:number,xx:number,yy:number,zz:number,name:string):Box=>({min:{x,y,z},max:{x:xx,y:yy,z:zz},name});
export function simulate(program:Program,options:SimulationOptions):SimulationResult {
  const material=createMaterial(options.kind,options.resolution),offset=options.offset??{x:0,y:0,z:0};
  let state=program.events[0]?initialState({kind:options.kind,initialPosition:program.events[0].from,offset}):initialState({kind:options.kind,offset});
  let completed=0,collision:Collision|null=null,samples=0,visits=0;
  const originalVolume=volume(material),h=material.resolution/2,margin=h/2+0.02;
  const fail=(code:string,e:MachineEvent,p:Vec3,message:string,fix:string,objects:string[]):never=>{throw {simulationCollision:true,collision:{code,line:e.line,hitPosition:p,message,fix,objects}};};
  const fixtures=options.kind==='turning'?[box(0,-30,-80,35,30,-45,'Патрон')]:[box(-5,-8,-20,65,0,-5,'Неподвижная губка тисков'),box(-5,40,-20,65,48,-5,'Подвижная губка тисков'),box(-80,-60,-25,120,100,-20,'Стол')];
  const frame=Math.min(options.frame??program.events.length,program.events.length);
  for(let index=0;index<frame;index++) {
    const event=program.events[index]!;
    const snapshot=material.kind==='turning'?material.occupied.slice():material.heights.slice();
    try {
      const tool=event.state.tool;
      if(tool!==null&&(tool<1||tool>2))fail('TOOL_UNKNOWN',event,event.from,'В этой мастерской нет геометрии инструмента '+tool+'.','Выберите T0101/T0202 либо T1/T2 M6.',['Инструмент']);
      if(event.motion!==null) {
        if(event.motion!==0&&tool===null)fail('NO_TOOL',event,event.from,'Рабочее движение без установленного инструмента.','Сначала выберите инструмент; на фрезерном станке выполните M6.',['Инструмент']);
        if(event.motion!==0&&event.state.spindle==='off')fail('SPINDLE_OFF',event,event.from,'Рабочее движение при выключенном шпинделе.','Задайте S и M3 перед рабочим проходом.',['Шпиндель']);
        if(event.motion!==0&&event.state.spindle==='ccw')fail('SPINDLE_DIRECTION',event,event.from,'Выбранные правые инструменты требуют M3, задано M4.','Для инструментов этого сценария включите M3.',['Шпиндель','Инструмент']);
        for(let segment=1;segment<event.points.length;segment++) {
          const a=event.points[segment-1]!,b=event.points[segment]!,count=Math.max(1,Math.ceil(distance(a,b)/h));
          if(samples+count+1>SIM_LIMITS.samples)throw new Error('Расчёт превысил 300000 положений. Сократите траекторию или увеличьте шаг сетки.');
          // Both endpoints are sampled. Speed and UI frame rate never enter this loop.
          for(let j=0;j<=count;j++) {
            samples++;const machine=interpolate(a,b,j/count),p=machine;
            if(machine.x < -100||machine.x>300||machine.y < -100||machine.y>300||machine.z < -150||machine.z>300)fail('TRAVEL',event,machine,'Выход за пределы перемещений учебного станка.','Проверьте координаты и G54. Учебный предел: X/Y −100…300, Z −150…300 мм.',['Ось']);
            if(tool===null)continue;
            if(material.kind==='turning') {
              if(p.x < -margin)fail('NEGATIVE_RADIUS',event,p,'Траектория пересекает отрицательный радиус.','Остановите резание на оси X0.',['Резец']);
              const width=tool===2?3:2;
              const cutter=box(p.x,-1,p.z,p.x+6,1,p.z+width,'Режущая часть');
              const shank=box(p.x+6,-2,p.z+3,p.x+10,2,p.z+8,'Тело резца');
              const holder=box(p.x+10,-4,p.z+4,p.x+20,4,p.z+14,'Державка');
              for(const fixture of fixtures)for(const part of [cutter,shank,holder])if(overlap(part,fixture,margin))fail('FIXTURE',event,p,`${part.name}: столкновение с узлом «${fixture.name}».`,'Отведите инструмент из защищённой зоны Z ≤ −45 мм. Сначала проверьте установку.',[part.name,fixture.name]);
              const query=(part:Box,cut:boolean)=>{
                // Broad phase restricts work to the tool footprint in the meridian grid.
                const r0=Math.max(0,Math.floor(part.min.x/material.resolution)),r1=Math.min(material.nr-1,Math.floor(part.max.x/material.resolution));
                const dz=material.length/material.nz;
                const z0=Math.max(0,Math.floor((part.min.z-material.zMin)/dz)),z1=Math.min(material.nz-1,Math.floor((part.max.z-material.zMin)/dz));
                for(let iz=z0;iz<=z1;iz++)for(let ir=r0;ir<=r1;ir++) {
                  if(++visits>SIM_LIMITS.cellVisits)throw new Error('Расчёт превысил 20 млн обращений к ячейкам. Увеличьте шаг сетки.');
                  const r=(ir+0.5)*material.resolution,z=material.zMin+(iz+0.5)*dz;
                  if(r<part.min.x||r>part.max.x||z<part.min.z||z>part.max.z)continue;
                  const cell=iz*material.nr+ir;
                  if(!material.occupied[cell])continue;
                  if(!cut)fail('HOLDER_STOCK',event,p,`${part.name} пересекает оставшийся материал.`,'Уменьшите глубину прохода, проверьте вылет и ориентацию инструмента. Пересекается тело, а не режущая часть.',[part.name,'Заготовка']);
                  if(event.motion===0)fail('RAPID_STOCK',event,p,'Быстрый ход G0 входит в материал.','Подойдите по свободному пространству; внутри припуска используйте G1 с подачей.',['Режущая часть','Заготовка']);
                  material.occupied[cell]=0;
                }
              };
              query(shank,false);query(holder,false);query(cutter,true);
            } else {
              const radius=tool===2?3:5,flute=12;
              const parts=[{radius,low:p.z,high:p.z+flute,name:'Режущая часть'},{radius:radius*0.8,low:p.z+flute,high:p.z+24,name:'Хвостовик'},{radius:12,low:p.z+24,high:p.z+39,name:'Держатель'}];
              for(const part of parts) {
                const broad=box(p.x-part.radius,p.y-part.radius,part.low,p.x+part.radius,p.y+part.radius,part.high,part.name);
                for(const fixture of fixtures)if(overlap(broad,fixture,margin)&&cylinderBox(p,part.radius,part.low,part.high,fixture,margin))fail('FIXTURE',event,p,`${part.name}: столкновение с узлом «${fixture.name}».`,'Исправьте глубину, безопасную высоту или положение траектории относительно крепления.',[part.name,fixture.name]);
              }
              const dx=material.width/material.nx,dy=material.depth/material.ny;
              // Check non-cutting bodies before removing any material at this sample.
              for(let partIndex=parts.length-1;partIndex>=0;partIndex--) {
                const part=parts[partIndex]!,cut=partIndex===0;
                if(part.low>=0||part.high<=material.bottom)continue;
                const x0=Math.max(0,Math.floor((p.x-part.radius)/dx)),x1=Math.min(material.nx-1,Math.floor((p.x+part.radius)/dx));
                const y0=Math.max(0,Math.floor((p.y-part.radius)/dy)),y1=Math.min(material.ny-1,Math.floor((p.y+part.radius)/dy));
                for(let iy=y0;iy<=y1;iy++)for(let ix=x0;ix<=x1;ix++) {
                  if(++visits>SIM_LIMITS.cellVisits)throw new Error('Расчёт превысил 20 млн обращений. Увеличьте шаг сетки.');
                  const x=(ix+0.5)*dx,y=(iy+0.5)*dy;if((x-p.x)**2+(y-p.y)**2>part.radius**2)continue;
                  const cell=iy*material.nx+ix,top=material.heights[cell]!;
                  if(part.low>=top-1e-7||part.high<=material.bottom)continue;
                  if(!cut)fail('HOLDER_STOCK',event,p,`${part.name} пересекает материал заготовки.`,'Глубина превышает доступную режущую длину или мешает держатель.',[part.name,'Заготовка']);
                  if(event.motion===0)fail('RAPID_STOCK',event,p,'Быстрый ход фрезы входит в материал.','Отведите фрезу над поверхностью, затем используйте G1.',['Фреза','Заготовка']);
                  material.heights[cell]=Math.max(material.bottom,Math.min(top,p.z));
                }
              }
            }
          }
        }
      }
      state=structuredClone(event.state);completed=index+1;
      options.onProgress?.((index+1)/Math.max(1,frame));
    } catch(e) {
      // A failed block restores material AND machine state to its beginning.
      if(material.kind==='turning')material.occupied=snapshot as Uint8Array;else material.heights=snapshot as Float32Array;
      if(typeof e==='object'&&e!==null&&'simulationCollision' in e&&'collision' in e){collision=e.collision as Collision;break;}
      throw e;
    }
  }
  return {material,completed,state,collision,removedVolume:originalVolume-volume(material),samples,uncertainty:material.resolution*Math.SQRT2+h/2+0.02};
}
export function volume(material:Material):number {
  let result=0;
  if(material.kind==='turning') {
    const dz=material.length/material.nz,dr=material.resolution;
    for(let iz=0;iz<material.nz;iz++)for(let ir=0;ir<material.nr;ir++)if(material.occupied[iz*material.nr+ir])result+=Math.PI*((ir+1)**2-ir**2)*dr*dr*dz;
  } else {
    const area=material.width/material.nx*material.depth/material.ny;
    for(const height of material.heights)result+=(height-material.bottom)*area;
  }
  return result;
}
export function diameterAt(material:TurningStock,z:number):number|null {
  const row=Math.floor((z-material.zMin)/(material.length/material.nz));if(row<0||row>=material.nz)return null;
  for(let r=material.nr-1;r>=0;r--)if(material.occupied[row*material.nr+r])return (r+1)*material.resolution*2;
  return 0;
}
export function depthAt(material:MillingStock,x:number,y:number):number|null {
  const ix=Math.floor(x/material.width*material.nx),iy=Math.floor(y/material.depth*material.ny);
  if(ix<0||ix>=material.nx||iy<0||iy>=material.ny)return null;
  return Math.max(0,-material.heights[iy*material.nx+ix]!);
}
export function frontFace(material:TurningStock):number|null {
  for(let row=material.nz-1;row>=0;row--)if(material.occupied.subarray(row*material.nr,(row+1)*material.nr).some(v=>v===1))return material.zMin+(row+1)*material.length/material.nz;
  return null;
}
