import {useEffect,useRef} from 'react';
import type {Program,Vec3} from '@firecnc/core';
import {createMaterial,type WorkshopSetup,type SimulationResult} from '@firecnc/simulation';
export function Projection({result,program,offset,setup}:{result:SimulationResult|null;program:Program|null;offset:Vec3;setup:WorkshopSetup}) {
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const element=canvas.current!;
    const draw=()=>{
      const bounds=element.getBoundingClientRect(),dpr=window.devicePixelRatio;
      element.width=bounds.width*dpr;element.height=bounds.height*dpr;
      const ctx=element.getContext('2d')!;ctx.scale(dpr,dpr);const w=bounds.width,h=bounds.height;
      ctx.fillStyle='#14262b';ctx.fillRect(0,0,w,h);
      ctx.strokeStyle='#254047';ctx.lineWidth=1;
      for(let x=0;x<w;x+=25){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
      for(let y=0;y<h;y+=25){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
      let m;try{m=result?.material??createMaterial(setup.kind,.25,setup);}catch(error){ctx.fillStyle='#edb393';ctx.font='13px sans-serif';ctx.fillText(error instanceof Error?error.message:'Проверьте заготовку.',20,40,w-40);return;}
      const scale=Math.min((w-80)/(m.kind==='turning'?m.length+60:m.width+35),(h-90)/(m.kind==='turning'?Math.max(65,m.radius+20):m.depth+25)),ox=40,oy=h-45;
      const chuckFront=setup.kind==='turning'?-setup.length+setup.clampLength:0,zLeft=chuckFront-40;
      const xy=(p:Vec3):[number,number]=>m.kind==='turning'?[ox+(p.z-zLeft)*scale,oy-(p.x+5)*scale]:[ox+(p.x+15)*scale,oy-(p.y+10)*scale];
      if(m.kind==='turning') {
        ctx.fillStyle='#5f7680';ctx.fillRect(ox+5*scale,oy-(Math.max(35,m.radius+10)+5)*scale,35*scale,Math.max(35,m.radius+10)*scale);
        ctx.fillStyle='#dfb36c';const dz=m.length/m.nz;
        for(let z=0;z<m.nz;z++)for(let r=0;r<m.nr;r++)if(m.occupied[z*m.nr+r])ctx.fillRect(ox+(m.zMin+z*dz-zLeft)*scale,oy-((r+1)*m.resolution+5)*scale,dz*scale+.3,m.resolution*scale+.3);
        ctx.fillStyle='#9eb8bd';ctx.font='12px sans-serif';ctx.fillText('Z →',w-50,oy+20);ctx.fillText('r ↑ (X/2)',14,20);
      } else {
        const dx=m.width/m.nx,dy=m.depth/m.ny;
        for(let y=0;y<m.ny;y++)for(let x=0;x<m.nx;x++) {
          const depth=-m.heights[y*m.nx+x]!,t=Math.min(1,depth/10);
          ctx.fillStyle=depth<1e-5?'#dfb36c':`rgb(${Math.round(72-t*25)},${Math.round(172-t*60)},${Math.round(164-t*35)})`;
          ctx.fillRect(ox+(x*dx+15)*scale,oy-((y+1)*dy+10)*scale,dx*scale+.3,dy*scale+.3);
        }
        ctx.fillStyle='#9eb8bd';ctx.font='12px sans-serif';ctx.fillText('X →',w-50,oy+20);ctx.fillText('Y ↑ · вид сверху',14,20);
      }
      for(const event of program?.events.slice(0,result?.completed??0)??[]) {
        if(event.points.length<2)continue;ctx.strokeStyle=event.motion===0?'#ed9265':'#73ffe0';ctx.lineWidth=1.5;ctx.setLineDash(event.motion===0?[4,4]:[]);ctx.beginPath();
        event.points.forEach((p,i)=>{const [x,y]=xy(p);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();
      }
      ctx.setLineDash([]);if(result){const [x,y]=xy(result.state.position);ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();}
      ctx.fillStyle='#b6ced0';ctx.font='12px sans-serif';ctx.fillText(`Сетка ${m.resolution.toFixed(2)} мм · ${result?.completed??0} кадров`,16,h-12);
    };
    const observer=new ResizeObserver(draw);observer.observe(element);draw();return ()=>observer.disconnect();
  },[result,program,offset,setup]);
  return <canvas className="projection" aria-label="Плоская проекция материала и выполненной траектории" ref={canvas}/>;
}
