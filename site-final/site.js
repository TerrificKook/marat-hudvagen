'use strict';
(() => {
  const gallery=[...document.querySelectorAll('[data-photo]')];
  const dialog=document.querySelector('#photo-dialog');
  let current=0,opener;
  const showPhoto=index=>{
    current=(index+gallery.length)%gallery.length;
    const link=gallery[current],image=document.querySelector('#photo-large');
    image.src=link.href;image.alt=link.querySelector('img').alt;
    document.querySelector('#photo-caption').textContent=image.alt;
    document.querySelector('#photo-counter').textContent=`${current+1} / ${gallery.length}`;
  };
  if(dialog?.showModal){
    gallery.forEach((link,index)=>link.addEventListener('click',event=>{event.preventDefault();opener=link;showPhoto(index);dialog.showModal();}));
    document.querySelector('#photo-close').addEventListener('click',()=>dialog.close());
    document.querySelector('#photo-prev').addEventListener('click',()=>showPhoto(current-1));
    document.querySelector('#photo-next').addEventListener('click',()=>showPhoto(current+1));
    dialog.addEventListener('keydown',event=>{if(event.key==='ArrowRight'){event.preventDefault();showPhoto(current+1);}if(event.key==='ArrowLeft'){event.preventDefault();showPhoto(current-1);}});
    dialog.addEventListener('close',()=>opener?.focus({preventScroll:true}));
  }
  const builder=document.querySelector('.request-builder');
  if(!builder)return;
  const message=document.querySelector('#request-message'),status=document.querySelector('#request-status');
  document.querySelector('#request-form').addEventListener('submit',event=>{
    event.preventDefault();
    const intent=document.querySelector('#request-intent').value;
    const dates=document.querySelector('#request-dates').value.trim();
    const task=document.querySelector('#request-task').value.trim();
    message.value=['Марат, здравствуйте!',`Хочу ${intent.toLowerCase()}.`,`Даты: ${dates||'нужно согласовать'}.`,`Задача и маршрут: ${task||'расскажу при общении'}.`,'Подскажите, пожалуйста, доступность машины, комплект и условия.'].join('\n\n');
    document.querySelector('#request-result').hidden=false;
    status.textContent='Текст готов. Сообщение не отправлено.';
    message.focus();
  });
  document.querySelector('#request-copy').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(message.value);status.textContent='Скопировано. Откройте мессенджер и вставьте текст Марату.';}
    catch{message.focus();message.select();status.textContent='Текст выделен. Скопируйте его через меню или Ctrl+C / ⌘C.';}
  });
  builder.hidden=false;
})();
