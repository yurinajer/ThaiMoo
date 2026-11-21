import { createElement, escapeHtml, toneTagsHtml } from '../lib/utils';
import { getProgressSummary } from '../db/progress';
import { getDueCount, getNewWordCount, planSessionCounts } from '../db/review';
import { getTodayErrorCount, getStubbornWordIds, getTodayErrors } from '../db/errors';
import { getWord, type Word } from '../db/vocabulary';
import { recordDailyActivity } from '../db/progress';
import { navigateTo } from '../router';

function getTodayDateLabel(): string {
  const d = new Date();
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${d.getMonth() + 1}月${d.getDate()}日 周${weekdays[d.getDay()]}`;
}

export async function renderHomePage(container: HTMLElement): Promise<void> {
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `
    <div style="flex:1;">
      <h1 style="font-size:1.1rem;">泰语学习记录</h1>
      <div style="font-size:0.75rem; opacity:0.8; margin-top:2px;">${getTodayDateLabel()}</div>
    </div>
  `;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  const [summary, dueCount, newCount, todayErrorCount, stubbornIds, todayErrors] = await Promise.all([
    getProgressSummary(),
    getDueCount(),
    getNewWordCount(),
    getTodayErrorCount(),
    getStubbornWordIds(),
    getTodayErrors(),
  ]);

  await recordDailyActivity();

  const strugglingWords: Word[] = [];
  const seenIds = new Set<number>();

  for (const err of todayErrors.slice(0, 5)) {
    if (seenIds.has(err.wordId)) continue;
    const w = await getWord(err.wordId);
    if (w) { strugglingWords.push(w); seenIds.add(err.wordId); }
  }

  if (strugglingWords.length < 3) {
    for (const id of stubbornIds) {
      if (seenIds.has(id)) continue;
      const w = await getWord(id);
      if (w) { strugglingWords.push(w); seenIds.add(id); }
      if (strugglingWords.length >= 5) break;
    }
  }

  const totalDue = dueCount + newCount;
  // 按钮上的数字是「本轮真的会考几张」，不是库里的积压量；积压量在上面两格里已经写了
  const planned = planSessionCounts(dueCount, newCount).planned;

  content.innerHTML = `
    <div class="animate-fade-in">
      <div class="card" style="text-align:center; padding:24px 16px; background:linear-gradient(135deg, var(--orange-100), var(--orange-200)); border-color:var(--orange-300); margin-bottom:16px;">
        <div style="display:flex; justify-content:center; gap:32px; margin-bottom:16px;">
          <div>
            <div style="font-size:2rem; font-weight:700; color:var(--tone-dark-coffee);">${dueCount}</div>
            <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:2px;">待复习</div>
          </div>
          <div style="width:1px; background:var(--orange-300);"></div>
          <div>
            <div style="font-size:2rem; font-weight:700; color:var(--tone-dark-coffee);">${newCount}</div>
            <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:2px;">新词</div>
          </div>
          <div style="width:1px; background:var(--orange-300);"></div>
          <div>
            <div style="font-size:2rem; font-weight:700; color:var(--tone-dark-coffee);">${summary.streakDays}</div>
            <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:2px;">连续天数</div>
          </div>
        </div>
        <button class="btn btn-primary btn-lg btn-block" id="btn-start-review" ${totalDue === 0 ? 'disabled' : ''}>
          ${totalDue > 0 ? `开始今日复习 (${planned})` : '今日暂无复习任务'}
        </button>
      </div>
    </div>

    ${strugglingWords.length > 0 ? `
    <div class="section animate-fade-in" style="animation-delay:0.1s;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <div class="section-title" style="margin-bottom:0;"><span class="emoji">⚠️</span> 需要关注</div>
        <a href="#/error-book" style="font-size:0.8rem; color:var(--orange-500);">查看全部</a>
      </div>
      <div style="display:flex; flex-direction:column; gap:6px;">
        ${strugglingWords.map(w => `
          <div class="card" style="padding:10px 14px; margin-bottom:0; display:flex; align-items:center; gap:12px;">
            <div style="flex:1; min-width:0;">
              <span style="font-family:var(--font-thai); font-size:1.1rem; font-weight:600;">${escapeHtml(w.thai)}</span>
              <span style="font-size:0.85rem; color:var(--text-secondary); margin-left:8px;">${escapeHtml(w.meaning)}</span>
            </div>
            ${toneTagsHtml(w.toneMark)}
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    <div class="section animate-fade-in" style="animation-delay:0.15s;">
      <div class="section-title"><span class="emoji">⚡</span> 快速入口</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <div class="card" style="padding:16px; margin:0; cursor:pointer; text-align:center;" data-nav="/vocabulary">
          <div style="font-weight:600; font-size:0.9rem;">词库</div>
          <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">${summary.totalWords} 个单词</div>
        </div>
        <div class="card" style="padding:16px; margin:0; cursor:pointer; text-align:center;" data-nav="/grammar">
          <div style="font-weight:600; font-size:0.9rem;">语法</div>
          <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">句型与练习</div>
        </div>
      </div>
    </div>

    <div class="section animate-fade-in" style="animation-delay:0.2s;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <div class="section-title" style="margin-bottom:0;"><span class="emoji">📖</span> 学习工具</div>
      </div>
      <div style="display:flex; flex-direction:column; gap:6px;">
        <div class="card" style="padding:12px 14px; margin:0; cursor:pointer; display:flex; align-items:center; gap:12px;" data-nav="/error-book">
          <span class="row-icon-dot"></span>
          <div style="flex:1;">
            <div style="font-weight:500; font-size:0.9rem;">错词本</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">今日 ${todayErrorCount} 个错词 · ${summary.stubbornCount} 个顽固词</div>
          </div>
          <span style="color:var(--text-muted);">›</span>
        </div>
        <div class="card" style="padding:12px 14px; margin:0; cursor:pointer; display:flex; align-items:center; gap:12px;" data-nav="/tone-training">
          <span class="row-icon-dot"></span>
          <div style="flex:1;">
            <div style="font-weight:500; font-size:0.9rem;">声调训练</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">看泰文选声调，推导步骤</div>
          </div>
          <span style="color:var(--text-muted);">›</span>
        </div>
        <div class="card" style="padding:12px 14px; margin:0; cursor:pointer; display:flex; align-items:center; gap:12px;" data-nav="/consonants">
          <span class="row-icon-dot"></span>
          <div style="flex:1;">
            <div style="font-weight:500; font-size:0.9rem;">辅音分类</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">高/中/低辅音卡片与测验</div>
          </div>
          <span style="color:var(--text-muted);">›</span>
        </div>
        <div class="card" style="padding:12px 14px; margin:0; cursor:pointer; display:flex; align-items:center; gap:12px;" data-nav="/minimal-pairs">
          <span class="row-icon-dot"></span>
          <div style="flex:1;">
            <div style="font-weight:500; font-size:0.9rem;">易混淆词</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">形近词对比练习</div>
          </div>
          <span style="color:var(--text-muted);">›</span>
        </div>
      </div>
    </div>
  `;

  content.querySelector('#btn-start-review')?.addEventListener('click', () => {
    if (totalDue > 0) navigateTo('/review');
  });

  content.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => {
      const route = el.getAttribute('data-nav');
      if (route) navigateTo(route);
    });
  });
}
