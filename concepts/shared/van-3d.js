'use strict';
// A small, dependency-free polygon renderer. The model is an illustration,
// not a dimensional or mechanical specification of the actual vehicle.
(() => {
  const canvases=[...document.querySelectorAll('[data-van]')];
  if(!canvases.length)return;
  const assetRoot=new URL('../../site-final/assets/',document.currentScript.src).href;
  const reduce=matchMedia('(prefers-reduced-motion: reduce)');
  const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
  const ease=v=>{v=clamp(v);return v*v*(3-2*v);};
  const stages=[
    {title:'Приехали.',copy:'Марат за рулём. Жёлтый Sprinter на точке. Дальше начинается работа художественного цеха.',word:'ПРИЕХАЛИ.',photo:'van-city',alt:'Настоящий Sprinter на точке',bg:'#ff653c',ink:'#232127'},
    {title:'Открываем<br>целый мир.',copy:'Внутри - стеллажи, материалы и рабочая организация. Комплект собираем под вашу задачу.',word:'ВНУТРИ.',photo:'interior',alt:'Стеллажи и рабочее пространство кузова',bg:'#d9d6e6',ink:'#232127'},
    {title:'Грузим.<br>Без суеты.',copy:'Задняя погрузка и гидроборт. Размеры, вес и помощь при погрузке согласуем заранее.',word:'ПОГРУЗКА.',photo:'tail-lift',alt:'Открытый кузов с опущенным гидробортом',bg:'#e8ff4f',ink:'#232127'},
    {title:'Цех<br>на колёсах.',copy:'Машина и человек, который может подключиться к работе руками. Объём помощи обсуждаем отдельно.',word:'В РАБОТЕ.',photo:'van-autumn',alt:'Худваген Марата на осенней локации',bg:'#24212c',ink:'#efebdf'}
  ];
  const story=document.querySelector('.story-scroll'),stage=document.querySelector('.story-stage');
  let progress=0,active=-1,queued=false;
  const views=canvases.map(canvas=>({canvas,ctx:canvas.getContext('2d'),w:0,h:0,visible:true}));
  if(views.some(v=>!v.ctx)){document.documentElement.classList.add('no-canvas');return;}
  const light=[-.25,.8,.55];
  function shade(hex,normal){
    const factor=.72+.28*Math.max(0,normal[0]*light[0]+normal[1]*light[1]+normal[2]*light[2]);
    const n=parseInt(hex.slice(1),16);return `rgb(${Math.round(((n>>16)&255)*factor)},${Math.round(((n>>8)&255)*factor)},${Math.round((n&255)*factor)})`;
  }
  function draw(v,p){
    const {ctx,w,h}=v;if(!w||!h)return;
    ctx.clearRect(0,0,w,h);
    const isHero=v.canvas.dataset.van==='hero';
    const open=isHero?0:ease((p-.11)/.3),lift=isHero?0:ease((p-.42)/.26),work=isHero?0:ease((p-.7)/.3);
    const yaw=isHero?.72:.72-p*1.1;
    const cy=Math.cos(yaw),sy=Math.sin(yaw),pitch=isHero?.27:.27+open*.07;
    const cp=Math.cos(pitch),sp=Math.sin(pitch);
    const scale=Math.min(w/(isHero?8.6:10.5),h/(isHero?4.1:5.7));
    const midX=w*.51,midY=h*(isHero?.7:.74);
    const project=([x,y,z])=>{const depth=x*sy+z*cy;return [midX+(x*cy-z*sy)*scale,midY+(-y*cp+depth*sp)*scale,depth*cp+y*sp];};
    // Soft grounding shadow keeps the exploded object anchored to the stage.
    const shadow=project([0,0,0]);ctx.save();ctx.translate(shadow[0],shadow[1]);ctx.scale(1,.25);const gradient=ctx.createRadialGradient(0,0,scale*.2,0,0,scale*3.6);gradient.addColorStop(0,'rgba(20,17,26,.23)');gradient.addColorStop(1,'rgba(20,17,26,0)');ctx.fillStyle=gradient;ctx.beginPath();ctx.ellipse(0,0,scale*3.8,scale*1.5,0,0,Math.PI*2);ctx.fill();ctx.restore();
    const faces=[];
    function face(points,color,normal=[0,1,0],alpha=1,label=''){
      const pts=points.map(project),depth=pts.reduce((s,q)=>s+q[2],0)/pts.length;
      faces.push({pts,color:shade(color,normal),alpha,depth,label});
    }
    function box(x,y,z,sx,sz,sySize,color,transform){
      // sx length, sz width, sySize height; origin is lower rear-left.
      const pts=[[x,y,z],[x+sx,y,z],[x+sx,y,z+sz],[x,y,z+sz],[x,y+sySize,z],[x+sx,y+sySize,z],[x+sx,y+sySize,z+sz],[x,y+sySize,z+sz]].map(pt=>transform?transform(pt):pt);
      face([pts[0],pts[1],pts[5],pts[4]],color,[0,0,-1]);
      face([pts[0],pts[4],pts[7],pts[3]],color,[-1,0,0]);
      face([pts[1],pts[2],pts[6],pts[5]],color,[1,0,0]);
      face([pts[3],pts[7],pts[6],pts[2]],color,[0,0,1]);
      face([pts[4],pts[5],pts[6],pts[7]],color,[0,1,0]);
      face([pts[0],pts[3],pts[2],pts[1]],color,[0,-1,0]);
    }
    // Chassis, raised floor and black underbody.
    box(-2.6,.42,-.91,5.3,1.82,.24,'#292c30');
    box(-2.62,.72,-1.05,3.65,2.1,.13,'#b6ada0');
    box(-2.55,.55,-.95,3.5,1.9,.15,'#464950');
    // Back wall is fixed; the near wall and roof float away to reveal the workspace.
    box(-2.6,.86,-1.04,3.58,.065,2.02,'#ffc42a');
    box(.9,.86,-1.04,.09,2.08,2.02,'#efb322');
    const roofY=2.9+open*.9,roofX=-2.62-open*.12;
    box(roofX,roofY,-1.08,3.7,2.16,.085,'#ffe065');
    const panelZ=1.025+open*.95;
    const panelShift=pt=>[pt[0]-open*2.65,pt[1]+open*.1,pt[2]];
    box(-2.6,.86+open*.28,panelZ,3.58,.065,2.02,'#ffc42a',panelShift);
    // Cargo wall rails.
    for(const x of [-2.57,.88])box(x,.84+open*.28,panelZ+.067,.055,.027,2.1,'#c4c5b9',panelShift);
    box(-2.6,2.82+open*.28,panelZ+.067,3.58,.027,.055,'#c4c5b9',panelShift);
    box(-2.6,.86+open*.28,panelZ+.067,3.58,.027,.055,'#c4c5b9',panelShift);
    const textY=1.7+open*.28;
    face([[-2.18,textY+.58,panelZ+.097],[.37,textY+.58,panelZ+.097],[.37,textY+.08,panelZ+.097],[-2.18,textY+.08,panelZ+.097]].map(panelShift),'#ffc42a',[0,0,1],1,'МАРАТ');
    // Rear doors split outward as the concept opens.
    const rear=-2.635-open*.52;
    box(rear,.88,-1.04-open*.28,.065,1.02,1.99,'#e7bc35');
    box(rear,.88,open*.7,.065,1.02,1.99,'#f5ca3d');
    for(const z of [-.9,.91+open*.7])box(rear-.02,1.05,z,.027,.035,1.45,'#c1c4bc');
    // Shelves: visible once the near wall floats out of the way.
    if(open>.32){
    for(const y of [1.0,1.61,2.2])box(-2.37,y,-.93,2.94,.72,.055,'#c5b99a');
    for(const x of [-2.37,-.94,.53])box(x,.9,-.31,.045,.045,1.91,'#767c79');
    for(const x of [-2.3,-1.56,-.81]){box(x,1.66,-.89,.57,.5,.4,'#b0a48a');box(x,2.25,-.89,.57,.48,.32,'#e5d4a4');}
    box(-2.14,1.05,-.82,.7,.46,.39,'#353c3f');
    box(-1.26,1.05,-.82,.82,.46,.39,'#e67b46');
    }
    // Hydraulic platform unfolds around the back sill.
    const angle=(1-lift)*Math.PI/2;
    const platform=pt=>{const [x,y,z]=pt;return [-2.7-x*Math.cos(angle),.74+x*Math.sin(angle)+y,z];};
    box(0,0,-.96,1.25,1.92,.065,'#939a9c',platform);
    for(let i=0;i<8;i++)box(i*.15,.066,-.95,.018,1.9,.007,'#b8bfc0',platform);
    // A low rolling case, a plywood panel and a small workbench emerge in the final scene.
    if(open>.4){
    const shift=work*1.6;
    box(-1.2,.88,.08+shift,.88,.7,.64,'#727a82');
    box(-1.23,1.47,.05+shift,.94,.76,.08,'#41494c');
    for(const x of [-1.16,-.42])box(x,.85,.12+shift,.06,.58,.61,'#b9c3c6');
    box(.02,.88,.0+shift*.65,.52,.52,.54,'#d99752');
    box(-.08,1.12,.42+shift*1.1,1.22,.62,.08,'#d7b574');
    for(const x of [-.02,.98])for(const z of [.47,.92])box(x,.86,z+shift*1.1,.045,.045,.29,'#494e4c');
    }
    // Sprinter-inspired cab: an extruded silhouette, sloped windshield, white hood.
    const cabShape=[[.94,.64],[2.72,.64],[2.76,1.04],[2.62,1.37],[2.15,1.62],[1.92,2.24],[1.04,2.28],[.94,2.14]];
    const near=cabShape.map(([x,y])=>[x,y,.88]),far=cabShape.map(([x,y])=>[x,y,-.88]);
    face(near,'#ffcc2e',[0,0,1]);face([...far].reverse(),'#f5bc25',[0,0,-1]);
    cabShape.forEach((xy,i)=>{const j=(i+1)%cabShape.length;face([far[i],near[i],near[j],far[j]],i===4?'#273c46':i===2||i===3?'#e8edec':'#f9c839',[i<5?1:-1,i>4?1:0,0]);});
    // Windshield sits on the sloped front upper plane.
    face([[1.94,2.19,-.76],[1.94,2.19,.76],[2.145,1.64,.76],[2.145,1.64,-.76]],'#38515c',[1,.3,0]);
    face([[1.962,2.15,-.63],[1.962,2.15,.57],[2.055,1.91,.64],[2.055,1.91,-.7]],'#76949b',[1,.5,0],.55);
    // Side window and door seams.
    face([[1.1,2.15,.894],[1.81,2.12,.894],[2.03,1.61,.894],[1.1,1.62,.894]],'#34505b',[0,0,1]);
    face([[1.14,2.11,.897],[1.37,2.1,.897],[1.84,1.66,.897],[1.6,1.66,.897]],'#71949f',[0,0,1],.6);
    box(1.09,.77,.896,.018,.012,.83,'#cf9d25');
    box(1.89,.88,.896,.018,.012,.7,'#c99a28');
    box(1.13,1.48,.91,.18,.036,.04,'#333c3e');
    box(1.99,1.7,.91,.12,.27,.18,'#282f36');
    // Aerodynamic fairing on the cab roof.
    face([[.96,2.3,-.94],[.96,2.3,.94],[1.67,2.35,.82],[1.67,2.35,-.82]],'#f5be28',[0,1,0]);
    face([[.96,2.3,.94],[.96,2.87,.94],[1.31,2.76,.9],[1.67,2.35,.82]],'#ffcf43',[0,0,1]);
    face([[.96,2.87,-.94],[.96,2.87,.94],[1.31,2.76,.9],[1.31,2.76,-.9]],'#ffe06a',[0,1,0]);
    face([[1.31,2.76,-.9],[1.31,2.76,.9],[1.67,2.35,.82],[1.67,2.35,-.82]],'#ffd147',[1,1,0]);
    // Hood, radiator, lights and bumpers.
    face([[2.18,1.59,-.86],[2.18,1.59,.86],[2.62,1.37,.87],[2.62,1.37,-.87]],'#eff1e7',[1,1,0]);
    face([[2.626,1.32,-.62],[2.626,1.32,.62],[2.755,1.02,.59],[2.755,1.02,-.59]],'#283339',[1,0,0]);
    for(const y of [1.08,1.18,1.28])face([[2.67+(1.28-y)*.38,y,-.57],[2.67+(1.28-y)*.38,y,.57],[2.682+(1.28-y)*.38,y-.018,.57],[2.682+(1.28-y)*.38,y-.018,-.57]],'#859194',[1,0,0]);
    for(const z of [-.84,.6])face([[2.61,1.37,z],[2.61,1.37,z+.24],[2.738,1.09,z+.24],[2.738,1.09,z]],'#e5e9d2',[1,0,0]);
    box(2.65,.68,-.93,.18,1.86,.28,'#30363b');
    box(2.838,.73,-.28,.015,.56,.13,'#eaeee2');
    // Wheels: real volume and small radial hubs, no external textures.
    function wheel(x,z){
      const n=24,r=.44,hub=.225,y=.45,z2=z+(z>0?.2:-.2);
      const ring=(rad,zz)=>Array.from({length:n},(_,i)=>[x+Math.cos(i/n*Math.PI*2)*rad,y+Math.sin(i/n*Math.PI*2)*rad,zz]);
      const a=ring(r,z),b=ring(r,z2);for(let i=0;i<n;i++)face([a[i],a[(i+1)%n],b[(i+1)%n],b[i]],'#292d32',[Math.cos(i/n*Math.PI*2),Math.sin(i/n*Math.PI*2),0]);
      face(b,'#262b30',[0,0,z>0?1:-1]);face(ring(hub,z2+(z>0?.006:-.006)),'#a5adae',[0,0,z>0?1:-1]);
      face(ring(.084,z2+(z>0?.012:-.012)),'#4e575d',[0,0,z>0?1:-1]);
      for(let i=0;i<6;i++){const t=i*Math.PI/3;const hx=x+Math.cos(t)*.147,hy=y+Math.sin(t)*.147;const pts=Array.from({length:8},(_,j)=>[hx+Math.cos(j*Math.PI/4)*.031,hy+Math.sin(j*Math.PI/4)*.031,z2+(z>0?.014:-.014)]);face(pts,'#374147',[0,0,z>0?1:-1]);}
    }
    for(const x of [-1.72,2.02])for(const z of [-.89,.89])wheel(x,z);
    faces.sort((a,b)=>a.depth-b.depth);
    for(const f of faces){
      ctx.globalAlpha=f.alpha;ctx.fillStyle=f.color;ctx.beginPath();f.pts.forEach((q,i)=>i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]));ctx.closePath();ctx.fill();
      // Matching stroke removes subpixel cracks between faces.
      ctx.strokeStyle=f.color;ctx.lineWidth=.45;ctx.stroke();
      if(f.label){const a=f.pts[0],b=f.pts[1],d=f.pts[3];ctx.save();ctx.transform((b[0]-a[0])/300,(b[1]-a[1])/300,(d[0]-a[0])/65,(d[1]-a[1])/65,a[0],a[1]);ctx.fillStyle='#303130';ctx.font='900 49px Inter, Arial';ctx.fillText(f.label,0,49);ctx.restore();}
    }
    ctx.globalAlpha=1;
  }
  function resize(){for(const v of views){const r=v.canvas.getBoundingClientRect();v.w=r.width;v.h=r.height;const dpr=Math.min(devicePixelRatio||1,2);v.canvas.width=Math.round(v.w*dpr);v.canvas.height=Math.round(v.h*dpr);v.ctx.setTransform(dpr,0,0,dpr,0,0);}schedule();}
  function update(){
    queued=false;const r=story.getBoundingClientRect();progress=reduce.matches?.82:clamp(-r.top/Math.max(1,story.offsetHeight-innerHeight));
    const index=reduce.matches?3:Math.min(3,Math.floor(progress*4.001));
    if(index!==active){active=index;const s=stages[index];stage.style.setProperty('--story-bg',s.bg);stage.style.setProperty('--story-ink',s.ink);document.querySelector('#story-title').innerHTML=s.title;document.querySelector('#story-description').textContent=s.copy;document.querySelector('.story-word').textContent=s.word;document.querySelector('#story-count').textContent=`0${index+1} / 04`;const image=document.querySelector('#story-photo');image.src=`${assetRoot}${s.photo}-640.webp`;image.alt=s.alt;document.querySelectorAll('[data-stage]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.stage)===index)));}
    for(const v of views)if(v.visible)draw(v,progress);
  }
  function schedule(){if(!queued){queued=true;requestAnimationFrame(update);}}
  document.querySelectorAll('[data-stage]').forEach(button=>button.addEventListener('click',()=>{
    const index=Number(button.dataset.stage);const top=scrollY+story.getBoundingClientRect().top;const travel=story.offsetHeight-innerHeight;
    scrollTo({top:top+travel*(index===0?.02:index/4+.08),behavior:reduce.matches?'instant':'smooth'});
  }));
  addEventListener('scroll',schedule,{passive:true});addEventListener('resize',resize,{passive:true});reduce.addEventListener('change',resize);
  if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>{for(const e of entries){const v=views.find(v=>v.canvas===e.target);if(v)v.visible=e.isIntersecting;}schedule();});views.forEach(v=>observer.observe(v.canvas));}
  if('ResizeObserver'in window)new ResizeObserver(resize).observe(document.querySelector('.hero-vehicle'));
  document.fonts?.ready.then(schedule);resize();
})();
