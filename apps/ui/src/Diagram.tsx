import type {Lesson} from '@firecnc/learning';
export function Diagram({type}:{type:Lesson['diagram']}) {
  return <svg className="lesson-diagram" viewBox="0 0 640 230" role="img" aria-label="Собственная схема учебных координат">
    <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3z" fill="#65d5bd"/></marker><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#264047" strokeWidth=".5"/></pattern></defs>
    <rect width="640" height="230" rx="10" fill="#14262b"/><rect width="640" height="230" fill="url(#grid)"/>
    {type==='turning'?<>
      <rect x="70" y="60" width="75" height="120" fill="#60767b" rx="4"/><rect x="145" y="80" width="270" height="80" fill="#d9ae68"/><rect x="145" y="80" width="65" height="80" fill="#d28062"/>
      <path d="M40 120H560" stroke="#91a8ac" strokeDasharray="6 5"/><path d="M415 120H570 M415 120V30" stroke="#65d5bd" strokeWidth="2" markerEnd="url(#arrow)"/>
      <path d="M415 120H570" stroke="#65d5bd" strokeWidth="2" markerEnd="url(#arrow)"/>
      <text x="575" y="124">+Z</text><text x="425" y="36">+X (диаметр)</text><text x="426" y="153">Z0 · торец</text><text x="80" y="205">Патрон</text><text x="225" y="205">Ø40 · радиус 20 мм</text><text x="151" y="55">Зона зажима</text>
    </>:type==='milling'?<>
      <path d="M165 155l100-70 210 0-100 70z" fill="#d9ae68"/><path d="M165 155v25h210v-25 M375 155l100-70v25l-100 70" fill="#967c52"/>
      <path d="M165 155H545 M165 155l115-85 M165 155V25" stroke="#65d5bd" strokeWidth="2" markerEnd="url(#arrow)"/>
      <text x="550" y="160">+X</text><text x="285" y="65">+Y</text><text x="174" y="31">+Z</text><text x="82" y="205">Z0 — верх · Z−3 — торец фрезы на глубине 3 мм</text><rect x="300" y="35" width="32" height="80" fill="#b9c7cb"/><text x="343" y="45">Ø10</text>
    </>:type==='arc'?<>
      <path d="M160 180H500 M160 180V25" stroke="#65d5bd" markerEnd="url(#arrow)"/><path d="M410 180A250 250 0 0 0 160-70" fill="none" stroke="#d9ae68" strokeWidth="3"/>
      <path d="M360 180A200 200 0 0 0 160-20" fill="none" stroke="#65d5bd" strokeWidth="4"/>
      <circle cx="160" cy="180" r="5" fill="#d9ae68"/><circle cx="360" cy="180" r="5" fill="#fff"/>
      <text x="175" y="205">Центр (0, 0)</text><text x="375" y="175">Начало (10, 0)</text><text x="270" y="48">G3 · I−10 J0</text><text x="315" y="92">R = 10 мм</text>
    </>:type==='modal'?<>
      <path d="M80 125H550" stroke="#65d5bd" strokeWidth="2" markerEnd="url(#arrow)"/>
      {[{x:160,s:'X10'},{x:310,s:'X15'},{x:460,s:'X20'}].map(p=><g key={p.s}><circle cx={p.x} cy="125" r="6" fill="#d9ae68"/><text x={p.x-12} y="160">{p.s}</text></g>)}
      <text x="192" y="93">G91 X5</text><text x="342" y="93">X5</text><text x="80" y="210">G91 сохраняется между кадрами · смещение +5 мм дважды</text>
    </>:<>
      <path d="M90 85H550" stroke="#d9ae68" strokeWidth="3" strokeDasharray="10 6"/><path d="M90 145H550" stroke="#65d5bd" strokeWidth="4" markerEnd="url(#arrow)"/>
      <text x="90" y="60">G0 · быстрый ход · только свободное пространство</text><text x="90" y="190">G1 · 100 мм / 100 мм/мин = 1 мин = 60 с</text>
    </>}
  </svg>;
}
