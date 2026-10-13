'use strict';
(() => {
  // Open linked FAQ answers on direct entry and in-page navigation.
  const openLinkedAnswer = () => {
    let id;
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
    const target = id && document.getElementById(id);
    const answer = target && target.closest('details');
    if (answer) {
      answer.open = true;
      requestAnimationFrame(() => answer.scrollIntoView({ block: 'start' }));
    }
  };
  openLinkedAnswer();
  window.addEventListener('hashchange', openLinkedAnswer);
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
