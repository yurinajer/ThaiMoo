import { createElement, $ } from '../lib/utils';

interface NavItem {
  id: string;
  icon: string;
  label: string;
  route: string;
}

const navItems: NavItem[] = [
  { id: 'home', icon: '🏠', label: '首页', route: '#/' },
  { id: 'vocab', icon: '📚', label: '词库', route: '#/vocabulary' },
  { id: 'review', icon: '✏️', label: '复习', route: '#/review' },
  { id: 'progress', icon: '📊', label: '进度', route: '#/progress' },
  { id: 'more', icon: '🍊', label: '更多', route: '#/more' },
];

export function createBottomNav(): HTMLElement {
  const nav = createElement('nav', { className: 'bottom-nav' });

  for (const item of navItems) {
    const btn = createElement('button', {
      className: 'nav-item',
      'data-route': item.route,
    });
    btn.innerHTML = `
      <span class="nav-icon">${item.icon}</span>
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
