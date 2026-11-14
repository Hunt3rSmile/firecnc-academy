import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import type {Program,Vec3} from '@firecnc/core';
import {createMaterial,validateSetup,type WorkshopSetup,type Material,type SimulationResult} from '@firecnc/simulation';
function materialGeometry(m:Material):THREE.BufferGeometry {
  const vertices:number[]=[];
  const triangle=(a:number[],b:number[],c:number[])=>vertices.push(...a,...b,...c);
  const quad=(a:number[],b:number[],c:number[],d:number[])=>{triangle(a,b,c);triangle(a,c,d);};
  if(m.kind==='turning') {
    const dz=m.length/m.nz,dr=m.resolution,n=40;
    const occupied=(r:number,z:number)=>r>=0&&r<m.nr&&z>=0&&z<m.nz&&m.occupied[z*m.nr+r]===1;
    const point=(r:number,z:number,angle:number)=>[z,r*Math.cos(angle),r*Math.sin(angle)];
    for(let z=0;z<m.nz;z++)for(let r=0;r<m.nr;r++)if(occupied(r,z)) {
      const r0=r*dr,r1=(r+1)*dr,z0=m.zMin+z*dz,z1=z0+dz;
      const edges:number[][]=[];
      if(!occupied(r+1,z))edges.push([r1,z0,r1,z1]);
      if(r>0&&!occupied(r-1,z))edges.push([r0,z1,r0,z0]);
      if(!occupied(r,z-1))edges.push([r0,z0,r1,z0]);
      if(!occupied(r,z+1))edges.push([r1,z1,r0,z1]);
      for(const [ra,za,rb,zb] of edges)for(let i=0;i<n;i++) {
        const a=i/n*Math.PI*2,b=(i+1)/n*Math.PI*2;
        quad(point(ra!,za!,a),point(rb!,zb!,a),point(rb!,zb!,b),point(ra!,za!,b));
      }
    }
  } else {
    const dx=m.width/m.nx,dy=m.depth/m.ny;
    for(let y=0;y<m.ny;y++)for(let x=0;x<m.nx;x++) {
      const h=m.heights[y*m.nx+x]!,x0=x*dx,x1=x0+dx,y0=y*dy,y1=y0+dy;
      if(h<=m.bottom+1e-7)continue;
      quad([x0,h,-y0],[x1,h,-y0],[x1,h,-y1],[x0,h,-y1]);
      const neighbors=[y===0?m.bottom:m.heights[(y-1)*m.nx+x]!,x===m.nx-1?m.bottom:m.heights[y*m.nx+x+1]!,y===m.ny-1?m.bottom:m.heights[(y+1)*m.nx+x]!,x===0?m.bottom:m.heights[y*m.nx+x-1]!];
      if(neighbors[0]!<h)quad([x0,h,-y0],[x0,neighbors[0]!,-y0],[x1,neighbors[0]!,-y0],[x1,h,-y0]);
      if(neighbors[1]!<h)quad([x1,h,-y0],[x1,neighbors[1]!,-y0],[x1,neighbors[1]!,-y1],[x1,h,-y1]);
      if(neighbors[2]!<h)quad([x1,h,-y1],[x1,neighbors[2]!,-y1],[x0,neighbors[2]!,-y1],[x0,h,-y1]);
      if(neighbors[3]!<h)quad([x0,h,-y1],[x0,neighbors[3]!,-y1],[x0,neighbors[3]!,-y0],[x0,h,-y0]);
    }
    quad([0,m.bottom,0],[0,m.bottom,-m.depth],[m.width,m.bottom,-m.depth],[m.width,m.bottom,0]);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();return geometry;
}
type SceneObjects={stock:THREE.Group;tool:THREE.Group;path:THREE.Group;rotor:THREE.Group;gold:THREE.Material;cutter:THREE.Material;holder:THREE.MeshStandardMaterial;mark:THREE.LineBasicMaterial;trace:THREE.LineBasicMaterial};
const clearGeometry=(group:THREE.Group)=>{group.traverse(object=>{if(object instanceof THREE.Mesh||object instanceof THREE.LineSegments||object instanceof THREE.Line)object.geometry.dispose();});group.clear();};
export function Scene3D({kind,result,program,offset,setup,playing=false,speed=1}:{kind:'turning'|'milling';result:SimulationResult|null;program:Program|null;offset:Vec3;setup:WorkshopSetup;playing?:boolean;speed?:number}) {
  const host=useRef<HTMLDivElement>(null),objects=useRef<SceneObjects|null>(null),reset=useRef<()=>void>(()=>{}),[error,setError]=useState(false);
  const live=useRef({result,playing,speed});live.current={result,playing,speed};
  useEffect(()=>{
    if(validateSetup(setup).length){setError(true);return;}
    const element=host.current!;let renderer:THREE.WebGLRenderer;
    try {renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});}catch{setError(true);return;}
    setError(false);renderer.setPixelRatio(Math.min(2,window.devicePixelRatio));element.appendChild(renderer.domElement);
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,1,.1,2000),controls=new OrbitControls(camera,renderer.domElement);
    const target=setup.kind==='turning'?new THREE.Vector3(-(setup.length-setup.clampLength)/2,3,0):new THREE.Vector3(setup.width/2,0,-setup.depth/2);
    const standard=()=>{camera.position.copy(target).add(kind==='turning'?new THREE.Vector3(70,80,120):new THREE.Vector3(85,105,95));controls.target.copy(target);controls.update();};reset.current=standard;standard();
    controls.enableDamping=true;controls.minDistance=30;controls.maxDistance=400;
    scene.add(new THREE.HemisphereLight(0xd5f6ff,0x263b3d,2.5));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(20,100,60);scene.add(light);
    const gold=new THREE.MeshStandardMaterial({color:0xd5ad6b,roughness:.45,metalness:.55,side:THREE.DoubleSide}),steel=new THREE.MeshStandardMaterial({color:0x506970,roughness:.7}),cutter=new THREE.MeshStandardMaterial({color:0xb7d1d7,metalness:.7,roughness:.3}),holder=new THREE.MeshStandardMaterial({color:0x406a6d}),mark=new THREE.LineBasicMaterial({color:0x21383e}),trace=new THREE.LineBasicMaterial({color:0x6bdfc5,transparent:true,opacity:.65});
    const rotor=new THREE.Group(),stock=new THREE.Group(),tool=new THREE.Group(),path=new THREE.Group();scene.add(rotor,tool,path);(kind==='turning'?rotor:scene).add(stock);
    objects.current={stock,tool,path,rotor,gold,cutter,holder,mark,trace};
    const box=(parent:THREE.Object3D,x:number,y:number,z:number,sx:number,sy:number,sz:number)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),steel);mesh.position.set(x,y,z);parent.add(mesh);};
    if(setup.kind==='turning'){
      const front=-setup.length+setup.clampLength,radius=Math.max(35,setup.diameter/2+10);
      const chuck=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,35,40),steel);chuck.rotation.z=Math.PI/2;chuck.position.x=front-17.5;rotor.add(chuck);
      for(let i=0;i<3;i++){const a=i*Math.PI*2/3;box(rotor,front-5,(setup.diameter/2+2)*Math.cos(a),(setup.diameter/2+2)*Math.sin(a),10,10,10);}
      box(scene,-25,-36,0,145,12,60);
    }else{const tx=Math.max(120,setup.width+20),ty=Math.max(100,setup.depth+20);box(scene,(tx-80)/2,-setup.thickness-7.5,-(ty-60)/2,tx+80,5,ty+60);box(scene,setup.width/2,-setup.thickness+(setup.jawGrip-5)/2,4,setup.width+10,setup.jawGrip+5,8);box(scene,setup.width/2,-setup.thickness+(setup.jawGrip-5)/2,-setup.depth-4,setup.width+10,setup.jawGrip+5,8);}
    const grid=new THREE.GridHelper(200,20,0x34575c,0x233e43);grid.position.y=kind==='turning'?-42:-33;scene.add(grid);
    const resize=()=>{const b=element.getBoundingClientRect();renderer.setSize(Math.max(1,b.width),Math.max(1,b.height));camera.aspect=b.width/Math.max(1,b.height);camera.updateProjectionMatrix();};
    const observer=new ResizeObserver(resize);observer.observe(element);resize();let frame=0,last=performance.now(),angle=0;
    const render=(time:number)=>{
      const dt=Math.min(.1,Math.max(0,(time-last)/1000));last=time;const current=live.current,state=current.result?.state;
      if(current.playing&&state&&state.spindle!=='off'&&state.rpm>0&&!current.result?.collision){angle+=(state.spindle==='cw'?-1:1)*state.rpm/60/20*Math.PI*2*dt*current.speed;angle%=Math.PI*2;}
      if(kind==='turning')rotor.rotation.x=angle;else tool.rotation.y=angle;
      element.dataset.rotationAngle=angle.toFixed(6);element.dataset.spindle=state?.spindle??'off';
      controls.update();renderer.render(scene,camera);frame=requestAnimationFrame(render);
    };frame=requestAnimationFrame(render);
    return ()=>{cancelAnimationFrame(frame);observer.disconnect();controls.dispose();const materials=new Set<THREE.Material>();scene.traverse(object=>{if(object instanceof THREE.Mesh||object instanceof THREE.Line){object.geometry.dispose();for(const mat of Array.isArray(object.material)?object.material:[object.material])materials.add(mat);}});for(const mat of [gold,steel,cutter,holder,mark,trace,...materials])mat.dispose();objects.current=null;renderer.dispose();renderer.forceContextLoss();element.replaceChildren();};
  },[kind,setup]);
  useEffect(()=>{
    const o=objects.current;if(!o)return;
    clearGeometry(o.stock);clearGeometry(o.tool);clearGeometry(o.path);
    const material=result?.material??createMaterial(kind,.25,setup);o.stock.add(new THREE.Mesh(materialGeometry(material),o.gold));
    if(material.kind==='turning'){
      const positions:number[]=[];for(let iz=0;iz<material.nz;iz++){let radius=0;for(let ir=material.nr-1;ir>=0;ir--)if(material.occupied[iz*material.nr+ir]){radius=(ir+1)*material.resolution;break;}if(radius>0)positions.push(material.zMin+(iz+.5)*material.length/material.nz,radius+.025,0);}
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));o.stock.add(new THREE.Line(g,o.mark));
    }
    const p=result?.state.position??(kind==='turning'?{x:25,y:0,z:5}:{x:-10,y:-10,z:10});o.tool.position.set(kind==='turning'?p.z:p.x,kind==='turning'?p.x:p.z,kind==='turning'?0:-p.y);
    o.holder.color.set(result?.collision?0xdc715d:0x406a6d);
    if(result?.state.tool!=null){
      if(kind==='turning'){
        const width=result.state.tool===2?3:2;
        for(const [x,y,z,sx,sy,sz,mat] of [[width/2,3,0,width,6,2,o.cutter],[5.5,8,0,5,4,4,o.cutter],[9,15,0,10,10,8,o.holder]] as const){const mesh=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),mat);mesh.position.set(x,y,z);o.tool.add(mesh);}
      }else{
        const radius=result.state.tool===2?3:5;
        for(const [r,h,y,mat] of [[radius,12,6,o.cutter],[radius*.8,12,18,o.cutter],[12,15,31.5,o.holder]] as const){const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,28),mat);mesh.position.y=y;o.tool.add(mesh);}
        for(let flute=0;flute<3;flute++){const points=[];for(let i=0;i<=32;i++){const a=i/32*Math.PI+flute*Math.PI*2/3;points.push(new THREE.Vector3(Math.cos(a)*(radius+.03),i/32*12,Math.sin(a)*(radius+.03)));}o.tool.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),o.mark));}
      }
    }
    if(program&&result){const positions:number[]=[];for(const e of program.events.slice(0,result.completed))for(let i=1;i<e.points.length;i++)for(const p of [e.points[i-1]!,e.points[i]!])positions.push(...(kind==='turning'?[p.z,p.x,0]:[p.x,p.z,-p.y]));const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));o.path.add(new THREE.LineSegments(g,o.trace));}
  },[kind,setup,result,program,offset]);
  return <div className="scene-wrap"><div className="scene" ref={host}/>{error?<div className="scene-error">{validateSetup(setup).length?validateSetup(setup).join(' '):'3D недоступно. Переключитесь на 2D: расчёт и обучение продолжают работать.'}</div>:<><button className="scene-reset" onClick={()=>reset.current()}>К детали ↺</button><span className="scene-hint">ЛКМ — камера · колесо — масштаб</span><span className="spindle-readout">{result?.state.spindle&&result.state.spindle!=='off'?`${result.state.spindle==='cw'?'M3':'M4'} · ${result.state.rpm} об/мин · ${playing?'вращение замедлено 20×':'пауза показа'}`:'Шпиндель остановлен'}</span></>}</div>;
}
