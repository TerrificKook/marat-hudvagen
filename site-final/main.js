"use strict";

document.documentElement.classList.add("js-enabled");

const menuToggle = document.querySelector(".menu-toggle");
const navigation = document.querySelector(".navigation");
if (menuToggle && navigation) {
  menuToggle.hidden = false;
  const closeMenu = () => {
    menuToggle.setAttribute("aria-expanded", "false");
    navigation.classList.remove("is-open");
  };
  menuToggle.addEventListener("click", () => {
    const open = menuToggle.getAttribute("aria-expanded") !== "true";
    menuToggle.setAttribute("aria-expanded", String(open));
    navigation.classList.toggle("is-open", open);
  });
  navigation.addEventListener("click", event => { if (event.target.closest("a")) closeMenu(); });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && menuToggle.getAttribute("aria-expanded") === "true") {
      closeMenu();
      menuToggle.focus();
    }
  });
}

const viewSwitch = document.querySelector(".view-switch");
if (viewSwitch) {
  const buttons = [...viewSwitch.querySelectorAll("button")];
  const activate = button => {
    buttons.forEach(item => {
      const active = item === button;
      item.setAttribute("aria-pressed", String(active));
      document.getElementById(item.dataset.view).hidden = !active;
    });
  };
  buttons.forEach(button => button.addEventListener("click", () => activate(button)));
  activate(buttons[0]);
  viewSwitch.hidden = false;
}

const lightbox = document.querySelector("#lightbox");
const gallery = [...document.querySelectorAll(".gallery-item")];
if (lightbox && typeof lightbox.showModal === "function") {
  let current = 0;
  let opener = null;
  const showPhoto = index => {
    current = (index + gallery.length) % gallery.length;
    const item = gallery[current];
    const image = lightbox.querySelector("img");
    image.src = item.href;
    image.alt = item.dataset.caption;
    document.querySelector("#lightbox-caption").textContent = item.dataset.caption;
    document.querySelector("#photo-count").textContent = `${current + 1} / ${gallery.length}`;
  };
  gallery.forEach((item, index) => item.addEventListener("click", event => {
    event.preventDefault();
    opener = item;
    showPhoto(index);
    lightbox.showModal();
    document.body.classList.add("modal-open");
  }));
  document.querySelector("#close-lightbox").addEventListener("click", () => lightbox.close());
  document.querySelector("#previous-photo").addEventListener("click", () => showPhoto(current - 1));
  document.querySelector("#next-photo").addEventListener("click", () => showPhoto(current + 1));
  lightbox.addEventListener("keydown", event => {
    if (event.key === "ArrowRight") { event.preventDefault(); showPhoto(current + 1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); showPhoto(current - 1); }
  });
  lightbox.addEventListener("click", event => {
    const rect = lightbox.getBoundingClientRect();
    if (event.target === lightbox && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) lightbox.close();
  });
  lightbox.addEventListener("close", () => {
    document.body.classList.remove("modal-open");
    if (opener) opener.focus({ preventScroll: true });
  });
}

const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
if ("IntersectionObserver" in window && !motionPreference.matches) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("reveal-ready");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  document.querySelectorAll(".section-heading, .benefits article, .timeline li").forEach(element => observer.observe(element));
  motionPreference.addEventListener("change", event => { if (event.matches) observer.disconnect(); });
}
