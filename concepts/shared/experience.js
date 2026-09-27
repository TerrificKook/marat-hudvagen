'use strict';
(() => {
  const assetRoot=new URL('../../site-final/assets/',document.currentScript.src).href;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const maxDialog = document.querySelector('#max-dialog');
  let maxOpener;
  document.querySelectorAll('[data-max]').forEach(button => button.addEventListener('click', () => {
    if (!maxDialog?.showModal) { document.querySelector('.max-fallback').open = true; document.querySelector('.max-fallback').scrollIntoView(); return; }
    maxOpener = button;
    maxDialog.querySelector('.copy-status').textContent = '';
    maxDialog.showModal();
  }));
  maxDialog?.querySelector('.close-dialog').addEventListener('click', () => maxDialog.close());
  maxDialog?.addEventListener('close', () => maxOpener?.focus({preventScroll:true}));
  maxDialog?.addEventListener('click', event => { if (event.target === maxDialog) { const r=maxDialog.getBoundingClientRect(); if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom) maxDialog.close(); } });
  document.querySelector('#copy-phone')?.addEventListener('click', async () => {
    const input=document.querySelector('#max-phone');
    const status=maxDialog.querySelector('.copy-status');
    try { await navigator.clipboard.writeText(input.value); status.textContent='Номер скопирован. Откройте MAX и вставьте его в поиск.'; }
    catch { input.focus(); input.select(); status.textContent='Номер выделен. Скопируйте его вручную и вставьте в поиск MAX.'; }
  });
  if ('IntersectionObserver' in window) {
    const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('in');observer.unobserve(entry.target);}}),{threshold:.08});
    document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));
  } else document.querySelectorAll('.reveal').forEach(el=>el.classList.add('in'));

  // A: an editorial contact sheet. Controls remain native buttons.
  const editImage=document.querySelector('#edit-photo');
  if(editImage){
    const frames=[
      {photo:'van-city',title:'Встречайте.<br>Наш транспорт.',copy:'Mercedes Sprinter 2019 года. Одна машина и её владелец. Без диспетчерской цепочки.',alt:'Машина на локации'},
      {photo:'tail-lift',title:'Двери открыты.<br>Можно грузить.',copy:'Задняя погрузка и гидроборт. Размеры, вес и помощь при погрузке согласуем под задачу.',alt:'Кузов открыт, гидроборт опущен'},
      {photo:'interior',title:'Всё своё.<br>Всё под рукой.',copy:'Стеллажи и рабочая организация внутри. Материалы и конкретный инструмент обсуждаем перед проектом.',alt:'Стеллажи внутри худвагена'},
      {photo:'van-autumn',title:'Локация меняется.<br>Свои остаются.',copy:'Город, павильон или выезд. Маршрут и условия согласуем заранее. На связи и за рулём - Марат.',alt:'Худваген на осенней локации'}
    ];
    let current=0;
    const showFrame=i=>{current=(i+frames.length)%frames.length;const f=frames[current];editImage.src=`${assetRoot}${f.photo}-1280.webp`;editImage.alt=f.alt;document.querySelector('#edit-title').innerHTML=f.title;document.querySelector('#edit-description').textContent=f.copy;document.querySelector('.edit-counter').textContent=`0${current+1} / 04`;document.querySelectorAll('[data-edit]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.edit)===current)));};
    document.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>showFrame(Number(b.dataset.edit))));
    document.querySelector('[data-edit-prev]').addEventListener('click',()=>showFrame(current-1));
    document.querySelector('[data-edit-next]').addEventListener('click',()=>showFrame(current+1));
    document.querySelector('#motor').addEventListener('click',()=>{
      if(reduce.matches){document.querySelector('#edit').scrollIntoView();return;}
      const shutter=document.querySelector('.a-shutter');
      shutter.classList.remove('run');void shutter.offsetWidth;shutter.classList.add('run');
      setTimeout(()=>document.querySelector('#edit').scrollIntoView({behavior:'instant'}),470);
    });
    const strip=document.querySelector('.a-marquee div');
    let waiting=false;
    const shift=()=>{waiting=false;strip.style.setProperty('--strip-shift',`${-3-(scrollY/innerHeight)*2}%`);};
    addEventListener('scroll',()=>{if(!waiting&&!reduce.matches){waiting=true;requestAnimationFrame(shift);}},{passive:true});
  }

  // B: route choice drives the van along the drawn road, never a live map.
  const mapVan=document.querySelector('#map-van');
  if(mapVan){
    const stops=[
      {point:[260,370],title:'01 / Забираем реквизит.',copy:'Начало истории - собрать нужное по городу. Адреса и график согласуем заранее.'},
      {point:[573,170],title:'02 / Готовимся к смене.',copy:'Материалы на месте. Обсуждаем загрузку, инструмент и помощь с подготовкой.'},
      {point:[884,350],title:'03 / Работаем на точке.',copy:'Кузов становится рабочей базой. Марат рядом с машиной и в ритме команды.'},
      {point:[558,536],title:'04 / Собираемся обратно.',copy:'Возвращаем реквизит или готовимся к следующему дню. По согласованному плану.'}
    ];
    let current=0,position=stops[0].point.slice(),runId=0;
    const render=()=>mapVan.setAttribute('transform',`translate(${position[0]} ${position[1]})`);
    mapVan.style.transition='none';render();
    const moveTo=target=>{
      if(target===current)return;
      const route=[];let next=current;
      while(next!==target){next=(next+1)%4;route.push(stops[next].point);}
      current=target;const id=++runId;
      const stop=stops[target];document.querySelector('#map-status-title').textContent=stop.title;document.querySelector('#map-status-copy').textContent=stop.copy;
      document.querySelectorAll('[data-stop]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.stop)===target)));
      if(reduce.matches){position=stop.point.slice();render();mapVan.classList.remove('moving');return;}
      mapVan.classList.add('moving');
      let segment=0,start=null,from=position.slice();
      const step=time=>{if(id!==runId)return;if(start===null)start=time;const t=Math.min((time-start)/580,1),q=t*t*(3-2*t);const to=route[segment];position=[from[0]+(to[0]-from[0])*q,from[1]+(to[1]-from[1])*q];render();if(t<1)requestAnimationFrame(step);else if(++segment<route.length){start=null;from=position.slice();requestAnimationFrame(step);}else mapVan.classList.remove('moving');};
      requestAnimationFrame(step);
    };
    document.querySelectorAll('[data-stop]').forEach(b=>{const act=()=>moveTo(Number(b.dataset.stop));b.addEventListener('click',act);if(b.tagName.toLowerCase()==='g')b.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();act();}});});
    reduce.addEventListener('change',()=>{if(reduce.matches){++runId;position=stops[current].point.slice();render();mapVan.classList.remove('moving');}});
  }
})();
