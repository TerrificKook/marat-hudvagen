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
})();
