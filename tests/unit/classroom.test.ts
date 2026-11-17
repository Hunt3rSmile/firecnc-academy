import {it,expect} from 'vitest';
import {existsSync} from 'node:fs';
import {classroomTasks,classroomPhotos,classroomCatalog,assessClassroom,classroomContext} from '@firecnc/learning';
const task=(id:string)=>classroomTasks.find(t=>t.id===id)!;
it('содержит все 60 исходных снимков и 14 письменных задач со связанными локальными изображениями',()=>{
  expect(classroomPhotos).toHaveLength(60);expect(new Set(classroomPhotos.map(p=>p.file)).size).toBe(60);expect(classroomTasks).toHaveLength(14);
  for(const photo of classroomPhotos)for(const suffix of ['.webp','.thumb.webp'])expect(existsSync('apps/ui/public/classroom/photos/'+photo.file.replace('.jpg',suffix))).toBe(true);
  for(const t of classroomTasks)for(const file of t.photoFiles)expect(classroomPhotos.some(p=>p.file===file)).toBe(true);
  for(const t of classroomCatalog().tasks){expect(t).not.toHaveProperty('solution');expect(t).not.toHaveProperty('assessment');expect(['numbers','program']).toContain(t.type);}
});
it('проверяет все эталонные решения, включая полную 25-кадровую программу PAL',()=>{
  for(const t of classroomTasks){const grade=assessClassroom(t,t.solution);expect(grade.checks.filter(c=>!c.passed),t.id).toEqual([]);expect(grade.score,t.id).toBe(100);expect(grade.passed,t.id).toBe(true);}
});
it('принимает форматирование, номера кадров, комментарии, десятичную запятую и модальные координаты',()=>{
  const t=task('pal-facing');
  const grade=assessClassroom(t,'(Торец)\nN10 g00 x82.0 z0\nN20 g01 x-1,6 m08\nN30 g00 z1 ; отвод');
  expect(grade.passed).toBe(true);
});
it('вычисляет координаты, поэтому принимает эквивалентный фрагмент в G91',()=>{
  const t=task('pal-groove');
  expect(assessClassroom(t,'G91\nG0 X-69 Z-182\nG1 X-5 M8\nG0 X5').passed).toBe(true);
  expect(assessClassroom(t,'G91\nG0 X81 Z-32\nG1 X76 M8\nG0 X81').passed).toBe(false);
});
it('находит неверный режим оборотов, направление шпинделя, диаметр, подачу и пропущенный возврат',()=>{
  for(const [id,from,to] of [
    ['pal-header','G96','G97'],['pal-header','S3000','S300'],['pal-header','M4','M3'],
    ['pal-facing','X82','X81'],['pal-groove','G1','G0'],['pal-drilling','F0.1','F100'],
    ['pal-rough-passes','G0 Z1','G0 Z-20']
  ]){
    const t=task(id!);const result=assessClassroom(t,t.solution.replace(from!,to!));
    expect(result.passed,`${id}: ${from} → ${to}`).toBe(false);expect(result.checks.some(c=>!c.passed)).toBe(true);
  }
  const t=task('pal-header');expect(assessClassroom(t,'G94\n'+t.solution).passed).toBe(false);
});
it('не засчитывает конфликтующие, неизвестные или лишние команды и незакрытые комментарии',()=>{
  const t=task('pal-groove');
  for(const code of [t.solution.replace('X81 Z-32','X81 X0 Z-32'),t.solution.replace('G1','G500'),t.solution.replace('M8','M8 M9'),t.solution+'\nG0 X0 Z0','(незакрытый\n'+t.solution])expect(assessClassroom(t,code).passed,code).toBe(false);
  const full=task('pal-complete-part');const afterEnd=assessClassroom(full,full.solution+'\nG0 X0');expect(afterEnd.score).toBe(0);
});
it('различает радиус и диаметр, поддерживает несколько подписанных числовых ответов',()=>{
  const t=task('pal-rough-diameters');expect(assessClassroom(t,'d1=75\nD2=70\na=5,0').passed).toBe(true);
  expect(assessClassroom(t,'D1=77.5\nD2=75\na=10').passed).toBe(false);
  const rpm=task('pal-drill-rpm');expect(assessClassroom(rpm,'954,93').passed).toBe(true);expect(assessClassroom(rpm,'n=1910').passed).toBe(false);expect(assessClassroom(rpm,'n=955\nn=1200').passed).toBe(false);
  expect(assessClassroom(task('pal-tangent-point'),'Х=50\nZ=−47').passed).toBe(true);
});
it('контекст помощника содержит условие и независимую проверку текущего решения',()=>{
  const context=classroomContext('pal-header','G54\nG92 S3000\nG97 S200 F0.25 T1 M3');
  expect(context).toContain('PAL');expect(context).toContain('Не выполнено');expect(context).toContain('G96');expect(()=>classroomContext('missing','')).toThrow('не найдено');
});
