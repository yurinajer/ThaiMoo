import { createElement, $ } from '../lib/utils';

interface NavItem {
  id: string;
  icon: string;
  label: string;
  route: string;
}

const ICONS = {
  home: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/><polyline points="9 21 9 14 15 14 15 21"/></svg>',
  book: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  review: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  grammar: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
  profile: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
};

const navItems: NavItem[] = [
  { id: 'home', icon: ICONS.home, label: '首页', route: '#/' },
  { id: 'vocab', icon: ICONS.book, label: '词库', route: '#/vocabulary' },
  { id: 'review', icon: ICONS.review, label: '复习', route: '#/review' },
  { id: 'grammar', icon: ICONS.grammar, label: '语法', route: '#/grammar' },
  { id: 'more', icon: ICONS.profile, label: '我的', route: '#/more' },
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
