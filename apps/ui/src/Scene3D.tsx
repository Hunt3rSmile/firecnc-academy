import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import type {Program,Vec3} from '@firecnc/core';
import {createMaterial,type Material,type SimulationResult} from '@firecnc/simulation';
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
export function Scene3D({kind,result,program,offset}:{kind:'turning'|'milling';result:SimulationResult|null;program:Program|null;offset:Vec3}) {
  const host=useRef<HTMLDivElement>(null),reset=useRef<()=>void>(()=>{}),[error,setError]=useState(false);
  useEffect(()=>{
    const element=host.current!;let renderer:THREE.WebGLRenderer;
    try {renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});}catch{setError(true);return;}
    setError(false);renderer.setPixelRatio(Math.min(2,window.devicePixelRatio));element.appendChild(renderer.domElement);
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,1,0.1,2000),controls=new OrbitControls(camera,renderer.domElement);
    const target=kind==='turning'?new THREE.Vector3(-22,3,0):new THREE.Vector3(30,0,-20);
    const standard=()=>{camera.position.copy(target).add(kind==='turning'?new THREE.Vector3(70,80,120):new THREE.Vector3(85,105,95));controls.target.copy(target);controls.update();};reset.current=standard;standard();
    controls.enableDamping=true;controls.minDistance=30;controls.maxDistance=400;
    scene.add(new THREE.HemisphereLight(0xd5f6ff,0x263b3d,2.5));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(20,100,60);scene.add(light);
    const gold=new THREE.MeshStandardMaterial({color:0xd5ad6b,roughness:.45,metalness:.55,side:THREE.DoubleSide}),steel=new THREE.MeshStandardMaterial({color:0x506970,roughness:.7}),cutter=new THREE.MeshStandardMaterial({color:0xb7d1d7,metalness:.7,roughness:.3}),holder=new THREE.MeshStandardMaterial({color:result?.collision?0xdc715d:0x406a6d});
    const addBox=(x:number,y:number,z:number,sx:number,sy:number,sz:number,mat:THREE.Material)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),mat);mesh.position.set(x,y,z);scene.add(mesh);};
    const stock=new THREE.Mesh(materialGeometry(result?.material??createMaterial(kind)),gold);scene.add(stock);
    const p=result?.state.position??(kind==='turning'?{x:25,y:0,z:5}:{x:-10,y:-10,z:10});const x=p.x,y=p.y,z=p.z;
    if(kind==='turning') {
      const chuck=new THREE.Mesh(new THREE.CylinderGeometry(35,35,30,40),steel);chuck.rotation.z=Math.PI/2;chuck.position.x=-65;scene.add(chuck);
      for(let i=0;i<3;i++){const angle=i*Math.PI*2/3;addBox(-50,22*Math.cos(angle),22*Math.sin(angle),10,10,10,steel);}
      addBox(-25,-36,0,145,12,60,steel);
      if(result?.state.tool!=null){const width=result?.state.tool===2?3:2;addBox(z+width/2,x+3,0,width,6,2,cutter);addBox(z+5.5,x+8,0,5,4,4,cutter);addBox(z+9,x+15,0,10,10,8,holder);}
    } else {
      addBox(20,-22.5,-20,200,5,160,steel);addBox(30,-12.5,4,70,15,8,holder);addBox(30,-12.5,-44,70,15,8,holder);
      if(result?.state.tool!=null) {
        const radius=result?.state.tool===2?3:5;
        for(const [r,h,center,mat] of [[radius,12,z+6,cutter],[radius*.8,12,z+18,cutter],[12,15,z+31.5,holder]] as const){const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,28),mat);mesh.position.set(x,center,-y);scene.add(mesh);}
      }
    }
    if(program&&result) {
      const positions:number[]=[];
      for(const e of program.events.slice(0,result.completed))for(let i=1;i<e.points.length;i++)for(const p of [e.points[i-1]!,e.points[i]!])positions.push(...(kind==='turning'?[p.z,p.x,0]:[p.x,p.z,-p.y]));
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));scene.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0x6bdfc5,transparent:true,opacity:.65})));
    }
    const grid=new THREE.GridHelper(200,20,0x34575c,0x233e43);grid.position.y=kind==='turning'?-42:-33;scene.add(grid);
    const resize=()=>{const b=element.getBoundingClientRect();renderer.setSize(b.width,b.height);camera.aspect=b.width/Math.max(1,b.height);camera.updateProjectionMatrix();};
    const observer=new ResizeObserver(resize);observer.observe(element);resize();let frame=0;
    const render=()=>{controls.update();renderer.render(scene,camera);frame=requestAnimationFrame(render);};render();
    return ()=>{cancelAnimationFrame(frame);observer.disconnect();controls.dispose();scene.traverse(object=>{if(object instanceof THREE.Mesh||object instanceof THREE.LineSegments){object.geometry.dispose();const mats=Array.isArray(object.material)?object.material:[object.material];for(const mat of mats)mat.dispose();}});renderer.dispose();renderer.forceContextLoss();element.replaceChildren();};
  },[kind,result,program,offset]);
  return <div className="scene-wrap"><div className="scene" ref={host}/>{error?<div className="scene-error">3D недоступно. Переключитесь на 2D: расчёт и обучение продолжают работать.</div>:<><button className="scene-reset" onClick={()=>reset.current()}>К детали ↺</button><span className="scene-hint">ЛКМ — вращение · колесо — масштаб</span></>}</div>;
}
