import {z} from 'zod';

const number=z.number().finite();
const edge=z.strictObject({from:z.number().int().nonnegative(),to:z.number().int().positive(),size:number.positive()});
export const turningDrawingSchema=z.strictObject({
  family:z.enum(['stepped','tapered','shoulder']),length:number.positive(),
  sections:z.array(z.strictObject({diameter:number.positive(),frontZ:number,backZ:number})).min(3).max(4),
  stations:z.array(number).min(4).max(12),chamfers:z.array(edge).min(1).max(5),tapers:z.array(edge).max(3)
});
export type TurningDrawing=z.infer<typeof turningDrawingSchema>;
type Point={x:number;y:number;z:number};

/** Physical 45° means Δdiameter / 2 = |ΔZ|. Dimensions are generated before answer points. */
export function generateTurningDrawing(random:()=>number):{points:Point[];drawing:TurningDrawing}{
  const pick=(count:number)=>Math.floor(random()*count),count=3+pick(2);
  const family=(['stepped','tapered','shoulder'] as const)[pick(3)]!;
  const diameters=[[16,18,20,22,25,28][pick(6)]!],lengths=[14+pick(9)];
  for(let i=1;i<count;i++){diameters.push(diameters[i-1]!+[12,14,17,20][pick(4)]!);lengths.push(20+pick(15));}
  const sizes=[1.5,2,2.5,3],nose=sizes[pick(sizes.length)]!;
  const points:Point[]=[{x:diameters[0]!-2*nose,y:0,z:0},{x:diameters[0]!,y:0,z:-nose}];
  const chamfers:TurningDrawing['chamfers']=[{from:0,to:1,size:nose}],tapers:TurningDrawing['tapers']=[],sections:TurningDrawing['sections']=[];
  const stations=[0];let depth=lengths[0]!;
  points.push({x:diameters[0]!,y:0,z:-depth});
  sections.push({diameter:diameters[0]!,frontZ:-nose,backZ:-depth});stations.push(-depth);
  const special=1+pick(count-1);
  for(let i=1;i<count;i++){
    const previous=diameters[i-1]!,diameter=diameters[i]!,radiusStep=(diameter-previous)/2,c=sizes[pick(4)]!;
    let front=-depth;
    if(i===special&&family==='tapered'){
      const from=points.length-1;front-=radiusStep;
      points.push({x:diameter,y:0,z:front});tapers.push({from,to:points.length-1,size:radiusStep});stations.push(front);
    }else{
      if(i===special&&family==='shoulder'){
        const rise=2+pick(Math.max(1,Math.floor(radiusStep-c)-2)),from=points.length-1;front-=rise;
        points.push({x:previous+2*rise,y:0,z:front});tapers.push({from,to:points.length-1,size:rise});stations.push(front);
      }
      points.push({x:diameter-2*c,y:0,z:front});const from=points.length-1;front-=c;
      points.push({x:diameter,y:0,z:front});chamfers.push({from,to:points.length-1,size:c});
    }
    depth+=lengths[i]!;points.push({x:diameter,y:0,z:-depth});stations.push(-depth);
    sections.push({diameter,frontZ:front,backZ:-depth});
  }
  return {points,drawing:turningDrawingSchema.parse({family,length:depth,sections,stations:[...new Set(stations)].sort((a,b)=>b-a),chamfers,tapers})};
}
