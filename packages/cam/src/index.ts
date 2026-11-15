import {z} from 'zod';
import {compile} from '@firecnc/core';
import {simulate,defaultSetup} from '@firecnc/simulation';
import {gradeGeometry,type GeometryTarget} from '../../learning/src/geometry-grade';
export const pointSchema=z.strictObject({x:z.number().min(-1000).max(1000),y:z.number().min(-1000).max(1000)});
export type Point=z.infer<typeof pointSchema>;
export const segmentSchema=z.discriminatedUnion('type',[
  z.strictObject({type:z.literal('line'),from:pointSchema,to:pointSchema}),
  z.strictObject({type:z.literal('arc'),from:pointSchema,to:pointSchema,center:pointSchema,clockwise:z.boolean()})
]);
export type Segment=z.infer<typeof segmentSchema>;
export const contourSchema=z.strictObject({closed:z.boolean(),segments:z.array(segmentSchema).min(1).max(100)});
export type Contour=z.infer<typeof contourSchema>;
export const camDocumentSchema=z.strictObject({version:z.literal(1),operation:z.enum(['turn-profile','turn-face','mill-plane','mill-pocket']),contour:contourSchema,depth:z.number().min(.25).max(6),tool:z.number().int().min(1).max(2),feed:z.number().min(20).max(1000),rpm:z.number().int().min(400).max(3000),safeHeight:z.number().min(3).max(30)});
export type CAMDocument=z.infer<typeof camDocumentSchema>;
export const CHORD_ERROR=.02;
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y),same=(a:Point,b:Point)=>distance(a,b)<1e-6;
export function segmentPoints(s:Segment):Point[] {
  if(s.type==='line')return [s.from,s.to];
  const radius=distance(s.from,s.center);if(radius<.1||Math.abs(radius-distance(s.to,s.center))>1e-5)throw new Error('Радиусы начала и конца дуги не совпадают либо радиус меньше 0,1 мм.');
  const start=Math.atan2(s.from.y-s.center.y,s.from.x-s.center.x),end=Math.atan2(s.to.y-s.center.y,s.to.x-s.center.x),tau=Math.PI*2;
  let sweep=s.clockwise?-((start-end+tau)%tau):((end-start+tau)%tau);if(same(s.from,s.to))sweep=s.clockwise?-tau:tau;
  const count=Math.max(1,Math.ceil(Math.abs(sweep)/(2*Math.acos(Math.max(-1,1-CHORD_ERROR/radius)))));if(count>2048)throw new Error('Дуга слишком сложна для учебного CAD. Уменьшите радиус.');
  return Array.from({length:count+1},(_,i)=>i===0?s.from:i===count?s.to:{x:s.center.x+radius*Math.cos(start+sweep*i/count),y:s.center.y+radius*Math.sin(start+sweep*i/count)});
}
function intersects(a:Point,b:Point,c:Point,d:Point):boolean {
  if(Math.max(a.x,b.x)<Math.min(c.x,d.x)-1e-7||Math.max(c.x,d.x)<Math.min(a.x,b.x)-1e-7||Math.max(a.y,b.y)<Math.min(c.y,d.y)-1e-7||Math.max(c.y,d.y)<Math.min(a.y,b.y)-1e-7)return false;
  const cross=(a:Point,b:Point,c:Point)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  return cross(a,b,c)*cross(a,b,d)<=1e-10&&cross(c,d,a)*cross(c,d,b)<=1e-10;
}
export function validateContour(contour:Contour):{valid:boolean;errors:string[];points:Point[]} {
  const errors:string[]=[],points:Point[]=[];if(!contourSchema.safeParse(contour).success)return {valid:false,errors:['Контур содержит недопустимые числа или слишком много элементов.'],points:[]};
  for(let i=0;i<contour.segments.length;i++){
    const s=contour.segments[i]!;if(i>0&&!same(contour.segments[i-1]!.to,s.from))errors.push(`Разрыв перед элементом ${i+1}.`);if(s.type==='line'&&same(s.from,s.to))errors.push(`Нулевая длина элемента ${i+1}.`);
    try{const p=segmentPoints(s);points.push(...(i?p.slice(1):p));}catch(error){errors.push(`Элемент ${i+1}: ${error instanceof Error?error.message:'неверная дуга'}`);}
    if(points.length>2048){errors.push('Аппроксимация превысила 2048 точек. Упростите контур.');break;}
  }
  const closed=points.length>1&&same(points[0]!,points.at(-1)!);if(contour.closed&&!closed)errors.push('Замкнутый контур имеет разрыв в последней точке.');
  if(!contour.closed&&closed)errors.push('Контур замкнут. Включите признак замыкания либо удалите замыкающий элемент.');
  if(!errors.length){outer:for(let i=0;i<points.length-1;i++)for(let j=i+2;j<points.length-1;j++){
    if(closed&&i===0&&j===points.length-2)continue;
    if(intersects(points[i]!,points[i+1]!,points[j]!,points[j+1]!)){errors.push('Контур самопересекается или повторно касается себя.');break outer;}
  }}
  if(contour.closed&&Math.abs(points.slice(1).reduce((area,p,i)=>area+points[i]!.x*p.y-p.x*points[i]!.y,0))<.01)errors.push('Замкнутый контур не имеет площади.');
  return {valid:errors.length===0,errors,points};
}
export function defaultCAM(operation:CAMDocument['operation']):CAMDocument {
  const contour:Contour=operation.startsWith('turn')?{closed:false,segments:[{type:'line',from:{x:0,y:15},to:{x:-30,y:15}}]}:{closed:true,segments:[{x:10,y:10},{x:50,y:10},{x:50,y:30},{x:10,y:30}].map((p,i,all)=>({type:'line' as const,from:p,to:all[(i+1)%all.length]!}))};
  return {version:1,operation,contour,depth:operation==='turn-face'?2:3,tool:1,feed:150,rpm:operation.startsWith('turn')?800:1600,safeHeight:5};
}
const number=(n:number)=>String(Number(n.toFixed(4)));
const levels=(depth:number)=>Array.from({length:Math.ceil(depth)},(_,i)=>Math.min(i+1,depth));
const rows=(a:number,b:number,step:number)=>Array.from({length:Math.ceil((b-a)/step)+1},(_,i)=>Math.min(b,a+i*step));
export interface GeneratedCAM {kind:'turning'|'milling';source:string;target:GeometryTarget;analyticVolume:number;note:string}
export function generateCAM(value:CAMDocument):GeneratedCAM {
  const doc=camDocumentSchema.parse(value),kind=doc.operation.startsWith('turn')?'turning':'milling',lines=[`(FireCNC DIN v1 / ${doc.operation} / учебная программа)`,`G21 ${kind==='turning'?'G18':'G17'} G90 G54`,kind==='turning'?'T0101':`T${doc.tool} M6`,`S${doc.rpm} M3`];
  let target:GeometryTarget,analyticVolume=0;
  if(kind==='turning'&&doc.tool!==1)throw new Error('Первый постпроцессор точения рассчитан на наружный резец 1.');
  if(doc.operation==='turn-face'){
    if(doc.depth>4)throw new Error('Первое торцевание ограничено припуском 4 мм.');
    lines.push('G0 X44 Z3');for(const depth of levels(doc.depth))lines.push(`G0 Z-${number(depth)}`,`G1 X0 F${doc.feed}`,'G1 X44');lines.push('G0 Z5');
    target={kind:'turning',diameter:40,length:60,front:-doc.depth,regions:[]};analyticVolume=Math.PI*20**2*doc.depth;
  }else if(doc.operation==='turn-profile'){
    const check=validateContour(doc.contour);if(!check.valid)throw new Error(check.errors.join(' '));
    if(doc.contour.closed||doc.contour.segments.some(s=>s.type!=='line'))throw new Error('Наружное точение v1 принимает открытый профиль из отрезков. Дуги пока доступны только для построения CAD.');
    const p=check.points;if(p[0]!.x!==0||p.at(-1)!.x>=0||p.some(p=>p.x< -35||p.x>0||p.y<12||p.y>20))throw new Error('Профиль начинается при Z0, заканчивается в Z−35…0; радиусы от 12 до 20 мм.');
    const regions:Extract<GeometryTarget,{kind:'turning'}>['regions']=[];
    for(let i=1;i<p.length;i++){
      const a=p[i-1]!,b=p[i]!;if(b.x>a.x+1e-6||b.y<a.y-1e-6)throw new Error('Профиль v1 идёт к патрону без возврата Z, радиус по направлению к патрону не уменьшается. Канавки выполняются отдельными заданиями.');
      if(b.x<a.x){regions.push({from:b.x,to:a.x,diameter:2*b.y,endDiameter:2*a.y});analyticVolume+=Math.PI*(400-(a.y*a.y+a.y*b.y+b.y*b.y)/3)*(a.x-b.x);}
    }
    const radialDepth=20-Math.min(...p.map(v=>v.y));
    if(regions.length>30)throw new Error('CAM профиля v1 поддерживает не более 30 осевых участков. Объедините соседние отрезки или упростите профиль.');
    for(let pass=1;pass<=Math.max(1,Math.ceil(radialDepth/3));pass++){
      const allowance=Math.max(0,radialDepth-pass*3),radius=(r:number)=>Math.min(20,r+allowance);
      lines.push('G0 X44 Z3',`G1 X${number(radius(p[0]!.y)*2)} F${doc.feed}`,'G1 Z0');
      for(const b of p.slice(1))lines.push(`G1 X${number(radius(b.y)*2)} Z${number(b.x)}`);
      lines.push('G1 X44','G0 Z5');
    }
    target={kind:'turning',diameter:40,length:60,front:0,regions};
  }else{
    const radius=doc.tool===1?5:3,depth=doc.depth,safe=number(doc.safeHeight);
    target={kind:'milling',width:60,depth:40,thickness:15,regions:[]};
    if(doc.operation==='mill-plane'){
      if(depth>4)throw new Error('Первое фрезерование плоскости ограничено глубиной 4 мм.');
      for(const z of levels(depth))for(const y of rows(0,40,radius*1.5))lines.push(`G0 Z${safe}`,`G0 X${-radius-1} Y${number(y)}`,`G1 Z-${number(z)} F${doc.feed}`,`G1 X${61+radius} F${doc.feed}`);
      target.regions=[{left:0,right:60,bottom:0,top:40,radius:0,depth}];analyticVolume=60*40*depth;
    }else{
      const check=validateContour(doc.contour);if(!check.valid)throw new Error(check.errors.join(' '));const segments=doc.contour.segments;
      if(!doc.contour.closed||segments.length!==4||segments.some(s=>s.type!=='line'||Math.abs(s.from.x-s.to.x)>1e-6&&Math.abs(s.from.y-s.to.y)>1e-6))throw new Error('Карман v1 требует замкнутый прямоугольник из четырёх отрезков, параллельных осям.');
      const left=Math.min(...check.points.map(p=>p.x)),right=Math.max(...check.points.map(p=>p.x)),bottom=Math.min(...check.points.map(p=>p.y)),top=Math.max(...check.points.map(p=>p.y));
      if(left<5||right>55||bottom<7||top>33)throw new Error('Карман должен находиться в X5…55, Y7…33 внутри плиты.');
      if(right-left<radius*2-1e-6||top-bottom<radius*2-1e-6)throw new Error('Область уже диаметра фрезы. Выберите меньший инструмент или увеличьте размеры.');
      const x1=left+radius,x2=right-radius,y1=bottom+radius,y2=top-radius;
      for(const z of levels(depth)){
        lines.push(`G0 Z${safe}`,`G0 X${number(x1)} Y${number(y1)}`,`G1 Z-${number(z)} F${doc.feed}`);
        rows(y1,y2,radius).forEach((y,i)=>{lines.push(`G1 Y${number(y)}`,`G1 X${number(i%2?x1:x2)}`);});
        lines.push(`G1 X${number(x1)} Y${number(y1)}`,`G1 X${number(x2)}`,`G1 Y${number(y2)}`,`G1 X${number(x1)}`,`G1 Y${number(y1)}`);
      }
      target.regions=[{left,right,bottom,top,radius,depth}];analyticVolume=((right-left)*(top-bottom)-(4-Math.PI)*radius*radius)*depth;
    }
    lines.push(`G0 Z${safe}`);
  }
  lines.push('M5','M30');return {kind,source:lines.join('\n'),target,analyticVolume,note:kind==='turning'?'Профиль задан физическим радиусом r. В программе X=2r; режущая точка без радиуса вершины.':'Траектория центра плоской фрезы рассчитана заранее, радиусной компенсации G41/G42 нет. Внутренние углы ограничены радиусом инструмента.'};
}
export function verifyGeneratedCAM(generated:GeneratedCAM):{passed:boolean;removedVolume:number;analyticVolume:number;volumeError:number;uncertainty:number;frames:number} {
  const program=compile(generated.source,{kind:generated.kind});if(program.error)throw new Error(`Строка ${program.error.line}: ${program.error.message}`);
  const simulation=simulate(program,{kind:generated.kind,setup:defaultSetup(generated.kind)});if(simulation.collision)throw new Error(`Строка ${simulation.collision.line}: ${simulation.collision.message}`);
  const geometry=gradeGeometry(generated.target,simulation);if(!geometry.passed)throw new Error('Полученная форма не совпадает с независимой аналитической целью.');
  const volumeError=Math.abs(simulation.removedVolume-generated.analyticVolume),limit=simulation.uncertainty*(generated.kind==='turning'?Math.PI*40*60:60*40+2*(60+40)*6);
  if(volumeError>limit)throw new Error('Объём снятия не совпадает с аналитическим эталоном в пределах сетки.');
  return {passed:true,removedVolume:simulation.removedVolume,analyticVolume:generated.analyticVolume,volumeError,uncertainty:simulation.uncertainty,frames:program.events.length};
}
