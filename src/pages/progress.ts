import { createElement } from '../lib/utils';
import { getProgressSummary, getRecentStats } from '../db/progress';
import { getWordCount } from '../db/vocabulary';
import { getStubbornCount } from '../db/errors';

export async function renderProgressPage(container: HTMLElement): Promise<void> {
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `<h1>📊 学习进度</h1>`;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  const [summary, recentStats, wordCount, stubbornCount] = await Promise.all([
    getProgressSummary(),
    getRecentStats(7),
    getWordCount(),
    getStubbornCount(),
  ]);

  const maxReviews = Math.max(...recentStats.map(s => s.reviewsDone), 1);

  content.innerHTML = `
    <div class="section animate-fade-in">
      <div class="card" style="text-align:center; background: linear-gradient(135deg, var(--orange-100), var(--orange-200));">
        <div style="font-size:2rem;">🔥</div>
        <div style="font-size:2.5rem; font-weight:700; color:var(--orange-500); margin:8px 0;">${summary.streakDays}</div>
        <div style="font-size:0.85rem; color:var(--text-secondary);">连续打卡天数</div>
      </div>
    </div>

    <div class="section animate-fade-in" style="animation-delay:0.1s;">
      <div class="section-title"><span class="emoji">📈</span> 总体统计</div>
      <div class="grid-2">
        <div class="card">
          <div class="card-title">累计词汇</div>
          <div class="card-value">${wordCount}</div>
        </div>
        <div class="card">
          <div class="card-title">累计复习</div>
          <div class="card-value">${summary.totalReviews}</div>
        </div>
        <div class="card">
          <div class="card-title">今日新学</div>
          <div class="card-value" style="color:var(--green-500)">${summary.todayNewWords}</div>
        </div>
        <div class="card">
          <div class="card-title">顽固词</div>
          <div class="card-value" style="color:var(--red-400)">${stubbornCount}</div>
        </div>
      </div>
    </div>

    <div class="section animate-fade-in" style="animation-delay:0.2s;">
      <div class="section-title"><span class="emoji">📅</span> 近7天复习量</div>
      <div class="card">
        ${recentStats.length === 0 ? `
          <div class="empty-state" style="padding:20px;">
            <p style="color:var(--text-muted); font-size:0.85rem;">暂无数据</p>
          </div>
        ` : recentStats.map(stat => {
          const height = Math.max((stat.reviewsDone / maxReviews) * 60, 4);
          const d = new Date(stat.date);
          const dayLabel = `${d.getMonth() + 1}/${d.getDate()}`;
          return `
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
              <span style="font-size:0.75rem; color:var(--text-muted); width:36px;">${dayLabel}</span>
              <div style="flex:1; height:${height}px; background:var(--orange-400); border-radius:4px; min-width:4px; transition: height 0.3s;"></div>
              <span style="font-size:0.75rem; color:var(--text-secondary); width:24px; text-align:right;">${stat.reviewsDone}</span>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <div class="section animate-fade-in" style="animation-delay:0.3s;">
      <div class="section-title"><span class="emoji">🏆</span> 成就</div>
      <div class="card">
        ${getAchievements(wordCount, summary.totalReviews, summary.streakDays, stubbornCount)}
      </div>
    </div>
  `;
}

function getAchievements(words: number, reviews: number, streak: number, stubborn: number): string {
  const achievements = [
    { icon: '🌱', name: '初学者', desc: '添加第一个单词', done: words >= 1 },
    { icon: '📚', name: '小有积累', desc: '累计10个单词', done: words >= 10 },
    { icon: '📖', name: '词汇达人', desc: '累计50个单词', done: words >= 50 },
    { icon: '🔥', name: '三天打鱼', desc: '连续打卡3天', done: streak >= 3 },
    { icon: '💪', name: '一周坚持', desc: '连续打卡7天', done: streak >= 7 },
    { icon: '🏅', name: '月度学霸', desc: '连续打卡30天', done: streak >= 30 },
    { icon: '✏️', name: '初次复习', desc: '完成第一次复习', done: reviews >= 1 },
    { icon: '🎯', name: '百次复习', desc: '累计复习100次', done: reviews >= 100 },
    { icon: '🍊', name: '橘子加油', desc: '克服第一个顽固词', done: stubborn === 0 && reviews > 0 },
  ];

  return achievements.map(a => `
    <div style="display:flex; align-items:center; gap:12px; padding:8px 0; border-bottom:1px solid var(--border-light); ${a.done ? '' : 'opacity:0.4;'}">
      <span style="font-size:1.5rem;">${a.icon}</span>
      <div style="flex:1;">
        <div style="font-weight:600; font-size:0.9rem;">${a.name}</div>
        <div style="font-size:0.75rem; color:var(--text-muted);">${a.desc}</div>
      </div>
      ${a.done ? '<span style="color:var(--green-500);">✓</span>' : '<span style="color:var(--text-muted);">🔒</span>'}
    </div>
  `).join('');
}
