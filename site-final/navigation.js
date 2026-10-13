'use strict';
(() => {
  const header = document.querySelector('#top');
  const backToTop = document.querySelector('.back-to-top');
  if (!header || !backToTop) return;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      backToTop.hidden = entry.isIntersecting;
    }).observe(header);
  } else {
    const update = () => { backToTop.hidden = window.scrollY <= header.offsetHeight; };
    window.addEventListener('scroll', update, { passive: true });
    update();
  }
  backToTop.addEventListener('click', () => header.focus({ preventScroll: true }));
})();
