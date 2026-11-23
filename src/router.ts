import { updateActiveNav, initBottomNav } from './components/bottom-nav';
import { allowLeave } from './lib/route-guard';
import { renderHomePage } from './pages/home';
import { renderVocabularyPage } from './pages/vocabulary';
import { renderReviewPage } from './pages/review';
import { renderProgressPage } from './pages/progress';
import { renderMorePage } from './pages/more';
import { renderErrorBookPage } from './pages/error-book';
import { renderToneTrainingPage } from './pages/tone-training';
import { renderConsonantsPage } from './pages/consonants';
import { renderSpellingPage } from './pages/spelling';
import { renderMinimalPairsPage } from './pages/minimal-pairs';
import { renderGrammarPage } from './pages/grammar';
import { renderColloquialPage } from './pages/colloquial';
import { renderReferencePage } from './pages/reference';
import { renderSpeedbrushPage } from './pages/speedbrush';

type RouteHandler = (container: HTMLElement) => void | Promise<void>;

const routes: Record<string, RouteHandler> = {
  '/': renderHomePage,
  '/vocabulary': renderVocabularyPage,
  '/review': renderReviewPage,
  '/progress': renderProgressPage,
  '/more': renderMorePage,
  '/error-book': renderErrorBookPage,
  '/tone-training': renderToneTrainingPage,
  '/consonants': renderConsonantsPage,
  '/spelling': renderSpellingPage,
  '/minimal-pairs': renderMinimalPairsPage,
  '/grammar': renderGrammarPage,
  '/colloquial': renderColloquialPage,
  '/reference': renderReferencePage,
  '/speedbrush': renderSpeedbrushPage,
};

function getRoute(): string {
  const hash = window.location.hash.slice(1) || '/';
  return hash;
}

// 守卫问的是「从哪离开」，所以路由自己记住上一次真正渲染出来的路由。
let lastRoute: string | null = null;

async function navigate(): Promise<void> {
  const route = getRoute();
  const container = document.getElementById('app');
  if (!container) return;

  // 离开确认必须发生在清空容器之前：hash 已经变了，被拒绝时用 replaceState 静默改回，
  // 既不触发第二次 hashchange，也不额外压一条历史记录。
  if (lastRoute !== null && route !== lastRoute && !allowLeave(lastRoute, route)) {
    history.replaceState(null, '', `#${lastRoute}`);
    return;
  }
  lastRoute = route;

  const handler = routes[route];
  if (handler) {
    container.innerHTML = '';
    container.className = 'page-container';
    await handler(container);
    updateActiveNav(route === '/' ? '#/' : `#${route}`);
  } else {
    container.innerHTML = `
      <div class="page-header">
        <h1>页面未找到</h1>
      </div>
      <div class="page-content">
        <div class="empty-state">
          <span class="emoji">🍊</span>
          <p>找不到该页面</p>
          <a href="#/" class="btn btn-primary" style="margin-top:16px">返回首页</a>
        </div>
      </div>
    `;
  }

  window.scrollTo(0, 0);
}

export function initRouter(): void {
  initBottomNav();
  window.addEventListener('hashchange', navigate);
  navigate();
}

export function navigateTo(route: string): void {
  window.location.hash = route;
}
