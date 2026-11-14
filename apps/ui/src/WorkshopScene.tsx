import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {MachineScheme} from './MachineScheme';
import type {MachineKind} from '@firecnc/core';
export const PARTS={
  turning:[{id:'bed',name:'Станина',about:'Основание станка и направляющие. Обеспечивает взаимное положение шпинделя и суппорта.'},{id:'spindle',name:'Шпиндельная бабка',about:'Вращает патрон вокруг оси Z. При точении вращается заготовка.'},{id:'chuck',name:'Патрон',about:'Три кулачка зажимают цилиндр. Вылет отсчитывается от передней плоскости кулачков.'},{id:'workpiece',name:'Заготовка',about:'Цилиндр Ø40 × 60 мм. X задаёт диаметр; движение к патрону уменьшает Z.'},{id:'turret',name:'Револьверная головка',about:'Несёт резцы и перемещается по X/Z. В базовом наборе позиция 1 — наружный резец, 2 — канавочный.'}],
  milling:[{id:'column',name:'Колонна',about:'Опора шпиндельного узла и вертикальных направляющих Z.'},{id:'spindle',name:'Шпиндель',about:'Вращает фрезу. Движение Z задаёт положение торца инструмента над поверхностью.'},{id:'tool',name:'Фреза',about:'Плоская концевая фреза Ø10 мм, режущая длина 12 мм. Координаты X/Y относятся к её центру.'},{id:'workpiece',name:'Заготовка',about:'Плита 60 × 40 × 15 мм. Верхняя поверхность — рабочая Z0.'},{id:'vise',name:'Тиски',about:'Губки удерживают плиту. Учебный захват не меньше 5 мм; проверяется геометрия, а не сила зажима.'},{id:'table',name:'Стол',about:'Поддерживает тиски и перемещает деталь относительно шпинделя по X/Y.'}]
} as const;
export function WorkshopScene({kind,selected,onSelect,exploded,axes}:{kind:MachineKind;selected:string;onSelect:(id:string)=>void;exploded:boolean;axes:boolean}) {
  const host=useRef<HTMLDivElement>(null),live=useRef({onSelect,selected,exploded,axes}),view=useRef<(name:string)=>void>(()=>{}),[failed,setFailed]=useState(false);
  live.current={onSelect,selected,exploded,axes};
  useEffect(()=>{
    const element=host.current;if(!element)return;setFailed(false);let renderer:THREE.WebGLRenderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true});}catch{setFailed(true);return;}
    renderer.setPixelRatio(Math.min(2,devicePixelRatio));renderer.setClearColor(0x112128);element.replaceChildren(renderer.domElement);
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.1,2000),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=70;controls.maxDistance=700;
    camera.position.set(kind==='turning'?150:180,140,kind==='turning'?210:190);controls.target.set(kind==='turning'?-15:25,25,0);
    scene.add(new THREE.HemisphereLight(0xe2faff,0x243138,2));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(60,180,80);scene.add(light);
    const groups=new Map<string,THREE.Group>(),positions=new Map<string,THREE.Vector3>(),materials=new Map<string,THREE.MeshStandardMaterial>(),displacement:Record<string,THREE.Vector3>={};
    const part=(id:string,color:number,dx:number,dy:number,dz:number)=>{const group=new THREE.Group();scene.add(group);groups.set(id,group);positions.set(id,group.position.clone());materials.set(id,new THREE.MeshStandardMaterial({color,metalness:.5,roughness:.5}));displacement[id]=new THREE.Vector3(dx,dy,dz);return group;};
    const box=(id:string,x:number,y:number,z:number,w:number,h:number,d:number)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),materials.get(id));mesh.position.set(x,y,z);mesh.userData.part=id;groups.get(id)!.add(mesh);return mesh;};
    const cylinder=(id:string,x:number,y:number,z:number,r:number,h:number,horizontal=false)=>{const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,40),materials.get(id));if(horizontal)mesh.rotation.z=Math.PI/2;mesh.position.set(x,y,z);mesh.userData.part=id;groups.get(id)!.add(mesh);return mesh;};
    if(kind==='turning'){
      part('bed',0x315460,0,-35,0);box('bed',-10,-34,0,180,16,76);box('bed',-45,-55,0,18,30,60);box('bed',55,-55,0,18,30,60);
      part('spindle',0x4a6b75,-40,0,0);box('spindle',-88,3,0,40,85,70);cylinder('spindle',-61,3,0,22,25,true);
      part('chuck',0x96a6ab,-22,0,0);cylinder('chuck',-55,3,0,31,20,true);for(let i=0;i<3;i++){const a=i*Math.PI*2/3;box('chuck',-45,3+24*Math.cos(a),24*Math.sin(a),10,11,11);}
      part('workpiece',0xc99e58,12,45,0);cylinder('workpiece',-30,3,0,20,60,true);
      part('turret',0x468a84,28,0,35);cylinder('turret',36,3,18,20,25,true);box('turret',26,24,10,30,8,8);box('turret',11,20,10,5,6,5);
    }else{
      part('table',0x416874,0,-30,20);box('table',25,-30,-10,150,12,100);for(let z=-45;z<=25;z+=23)box('table',25,-23,z,130,2,3);
      part('column',0x355562,-40,0,-45);box('column',-47,35,-68,36,145,40);box('column',0,97,-52,100,20,45);
      part('vise',0x748d96,0,0,35);box('vise',30,-15,-20,85,10,65);box('vise',30,-5,4,70,15,9);box('vise',30,-5,-44,70,15,9);
      part('workpiece',0xc99e58,30,18,0);box('workpiece',30,-7.5,-20,60,15,40);
      part('spindle',0x7f999f,0,40,0);cylinder('spindle',30,65,-20,19,40);cylinder('spindle',30,42,-20,12,15);
      part('tool',0x87ddc1,0,25,30);cylinder('tool',30,23,-20,5,24);
    }
    const grid=new THREE.GridHelper(260,26,0x34515c,0x1d3540);grid.position.y=-72;scene.add(grid);
    const axesGroup=new THREE.Group();scene.add(axesGroup);const origin=new THREE.Vector3(0,kind==='turning'?3:0,0),directions=kind==='turning'?[new THREE.Vector3(0,1,0),new THREE.Vector3(1,0,0)]:[new THREE.Vector3(1,0,0),new THREE.Vector3(0,0,-1),new THREE.Vector3(0,1,0)];
    directions.forEach((direction,i)=>axesGroup.add(new THREE.ArrowHelper(direction,origin,42,[0xf49b7e,kind==='turning'?0x82a9ff:0x80dec7,0x82a9ff][i],6,3)));
    const labels=directions.map((direction,i)=>{const label=document.createElement('span');label.className='workshop-axis';label.textContent=kind==='turning'?['+X / Ø','+Z'][i]!:['+X','+Y','+Z'][i]!;element.append(label);return {label,position:origin.clone().addScaledVector(direction,48)};});
    const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();let down={x:0,y:0};
    const pointerDown=(e:PointerEvent)=>{down={x:e.clientX,y:e.clientY};};
    const click=(e:PointerEvent)=>{if(Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;const rect=element.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);const object=ray.intersectObjects([...groups.values()],true).find(hit=>typeof hit.object.userData.part==='string');if(object)live.current.onSelect(object.object.userData.part as string);};
    renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointerup',click);
    view.current=name=>{if(name==='part'){const group=groups.get(live.current.selected)??groups.get('workpiece')!;controls.target.copy(new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3()));camera.position.copy(controls.target).add(new THREE.Vector3(70,55,90));}else{controls.target.set(kind==='turning'?-15:25,20,-10);camera.position.copy(controls.target).add(name==='front'?new THREE.Vector3(0,0,260):name==='top'?new THREE.Vector3(.01,260,0):new THREE.Vector3(160,135,200));}controls.update();};
    const resize=()=>{const r=element.getBoundingClientRect();renderer.setSize(Math.max(1,r.width),Math.max(1,r.height));camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix();};const observer=new ResizeObserver(resize);observer.observe(element);resize();let frame=0;
    const render=()=>{
      for(const [id,group] of groups){group.position.copy(positions.get(id)!).addScaledVector(displacement[id]!,live.current.exploded?1:0);materials.get(id)!.emissive.set(id===live.current.selected?0x285e51:0);}
      axesGroup.visible=live.current.axes;controls.update();renderer.render(scene,camera);
      for(const {label,position} of labels){const p=position.clone().project(camera);label.style.display=live.current.axes&&p.z<1?'block':'none';label.style.left=`${(p.x+1)/2*element.clientWidth}px`;label.style.top=`${(1-p.y)/2*element.clientHeight}px`;}
      frame=requestAnimationFrame(render);
    };render();
    return ()=>{cancelAnimationFrame(frame);observer.disconnect();renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointerup',click);controls.dispose();scene.traverse(o=>{const m=o as THREE.Mesh;if(m.geometry)m.geometry.dispose();const material=m.material;if(material)for(const v of Array.isArray(material)?material:[material])v.dispose();});renderer.dispose();renderer.forceContextLoss();element.replaceChildren();};
  },[kind]);
  return <div className="workshop-scene"><div className="workshop-views">{[['iso','Общий вид'],['front','Спереди'],['top','Сверху'],['part','К узлу']] .map(([id,name])=><button key={id} onClick={()=>view.current(id!)}>{name}</button>)}</div><div className="workshop-canvas" ref={host}/>{failed&&<div className="workshop-fallback"><p>3D недоступно. Схема и наладка продолжают работать.</p><MachineScheme kind={kind} selected={selected} onSelect={onSelect}/></div>}<p className="micro">Нажмите на узел · ЛКМ — вращение камеры · колесо — масштаб</p></div>;
}
