import { createElement, $ } from '../lib/utils';

interface NavItem {
  id: string;
  icon: string;
  label: string;
  route: string;
}

const navItems: NavItem[] = [
  { id: 'home', icon: '/icons/1.png', label: '首页', route: '#/' },
  { id: 'vocab', icon: '/icons/2.png', label: '词库', route: '#/vocabulary' },
  { id: 'review', icon: '/icons/3.png', label: '复习', route: '#/review' },
  { id: 'grammar', icon: '/icons/4.png', label: '语法', route: '#/grammar' },
  { id: 'more', icon: '/icons/5.png', label: '我的', route: '#/more' },
];

export function createBottomNav(): HTMLElement {
  const nav = createElement('nav', { className: 'bottom-nav' });

  for (const item of navItems) {
    const btn = createElement('button', {
      className: 'nav-item',
      'data-route': item.route,
    });
    btn.innerHTML = `
      <span class="nav-icon"><img class="nav-icon-img" src="${item.icon}" alt="" decoding="async"></span>
      <span class="nav-label">${item.label}</span>
    `;
    btn.addEventListener('click', () => {
      window.location.hash = item.route.replace('#', '');
    });
    nav.appendChild(btn);
  }

  return nav;
}

export function updateActiveNav(route: string): void {
  const items = document.querySelectorAll('.nav-item');
  items.forEach(item => {
    const itemRoute = item.getAttribute('data-route');
    if (itemRoute === route || (route === '#/' && itemRoute === '#/')) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

export function initBottomNav(): void {
  const existingNav = $('.bottom-nav');
  if (existingNav) existingNav.remove();

  const nav = createBottomNav();
  document.body.appendChild(nav);
}
