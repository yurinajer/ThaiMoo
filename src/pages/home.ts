import { createElement } from '../lib/utils';
import { getProgressSummary, type ProgressSummary } from '../db/progress';
import { getDueCount, getNewWordCount } from '../db/review';
import { getTodayErrorCount } from '../db/errors';
import { recordDailyActivity } from '../db/progress';
import { navigateTo } from '../router';

export async function renderHomePage(container: HTMLElement): Promise<void> {
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `<h1>🍊 萨瓦迪卡·泰语学习</h1>`;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  const [summary, dueCount, newCount, todayErrors] = await Promise.all([
    getProgressSummary(),
    getDueCount(),
    getNewWordCount(),
    getTodayErrorCount(),
  ]);

  await recordDailyActivity();

  content.innerHTML = `
    <div class="section animate-fade-in">
      <div class="card" style="text-align:center; background: linear-gradient(135deg, var(--orange-100), var(--orange-200)); border-color: var(--orange-300);">
        <div style="font-size:2rem; margin-bottom:8px;">🍊</div>
        <div style="font-size:0.85rem; color:var(--text-secondary);">连续打卡</div>
        <div style="font-size:2.5rem; font-weight:700; color:var(--orange-500);">${summary.streakDays}</div>
        <div style="font-size:0.85rem; color:var(--text-secondary);">天</div>
      </div>
    </div>

    <div class="section animate-fade-in" style="animation-delay: 0.1s;">
      <div class="section-title"><span class="emoji">📋</span> 今日任务</div>
      <div class="grid-2">
        <div class="card" style="cursor:pointer" onclick="window.location.hash='/review'">
          <div class="card-title">待复习</div>
          <div class="card-value">${dueCount}</div>
        </div>
        <div class="card" style="cursor:pointer" onclick="window.location.hash='/review'">
          <div class="card-title">新词</div>
          <div class="card-value">${newCount}</div>
        </div>
        <div class="card" style="cursor:pointer" onclick="window.location.hash='/error-book'">
          <div class="card-title">今日错词</div>
          <div class="card-value" style="color:var(--red-400)">${todayErrors}</div>
        </div>
        <div class="card" style="cursor:pointer" onclick="window.location.hash='/error-book'">
          <div class="card-title">顽固词</div>
          <div class="card-value" style="color:var(--orange-600)">${summary.stubbornCount}</div>
        </div>
      </div>
    </div>

    <div class="section animate-fade-in" style="animation-delay: 0.2s;">
      <div class="section-title"><span class="emoji">⚡</span> 快速入口</div>
      <div class="quick-grid">
        <div class="quick-item" data-route="/tone-training">
          <span class="icon">🍊</span>
          <span class="label">声调训练</span>
        </div>
        <div class="quick-item" data-route="/consonants">
          <span class="icon">🔤</span>
          <span class="label">辅音分类</span>
        </div>
        <div class="quick-item" data-route="/spelling">
          <span class="icon">📝</span>
          <span class="label">拼读对照</span>
        </div>
        <div class="quick-item" data-route="/minimal-pairs">
          <span class="icon">👂</span>
          <span class="label">辨析练习</span>
        </div>
        <div class="quick-item" data-route="/grammar">
          <span class="icon">📖</span>
          <span class="label">语法句型</span>
        </div>
        <div class="quick-item" data-route="/colloquial">
          <span class="icon">💬</span>
          <span class="label">口语笔记</span>
        </div>
      </div>
    </div>

    <div class="section animate-fade-in" style="animation-delay: 0.3s;">
      <div class="section-title"><span class="emoji">📊</span> 学习概况</div>
      <div class="card">
        <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
          <span style="color:var(--text-secondary); font-size:0.85rem;">累计词汇</span>
          <span style="font-weight:600; color:var(--orange-500);">${summary.totalWords}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
          <span style="color:var(--text-secondary); font-size:0.85rem;">累计复习</span>
          <span style="font-weight:600; color:var(--orange-500);">${summary.totalReviews}</span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span style="color:var(--text-secondary); font-size:0.85rem;">今日新学</span>
          <span style="font-weight:600; color:var(--green-500);">${summary.todayNewWords}</span>
        </div>
      </div>
    </div>
  `;

  content.querySelectorAll('.quick-item').forEach(item => {
    item.addEventListener('click', () => {
      const route = item.getAttribute('data-route');
      if (route) navigateTo(route);
    });
  });
}
