import { createElement, escapeHtml } from '../lib/utils';
import { getTodayErrors, getStubbornWordIds, markStubbornMastered } from '../db/errors';
import { getWord, type Word } from '../db/vocabulary';
import { showSuccess } from '../components/toast';

export async function renderErrorBookPage(container: HTMLElement): Promise<void> {
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `
    <button class="back-btn" onclick="window.location.hash='/'">←</button>
    <h1>📕 错词本</h1>
  `;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  content.innerHTML = `
    <div class="tabs" id="error-tabs">
      <button class="tab active" data-tab="today">今日错词</button>
      <button class="tab" data-tab="stubborn">顽固词</button>
    </div>
    <div id="error-content"></div>
  `;

  const errorContent = content.querySelector('#error-content') as HTMLElement;

  async function loadTodayErrors() {
    const errors = await getTodayErrors();
    if (errors.length === 0) {
      errorContent.innerHTML = `
        <div class="empty-state">
          <span class="emoji">🍊</span>
          <p>今天还没有错词</p>
          <p style="font-size:0.85rem; color:var(--text-muted); margin-top:8px;">继续保持！</p>
        </div>
      `;
      return;
    }

    const wordMap = new Map<number, Word>();
    for (const err of errors) {
      if (!wordMap.has(err.wordId)) {
        const word = await getWord(err.wordId);
        if (word) wordMap.set(err.wordId, word);
      }
    }

    errorContent.innerHTML = errors.map(err => {
      const word = wordMap.get(err.wordId);
      return `
        <div class="card" style="margin-bottom:8px; padding:12px 16px;">
          <div style="display:flex; justify-content:space-between; align-items:start;">
            <div>
              <div style="font-family:var(--font-thai); font-size:1.2rem; font-weight:600;">${word ? escapeHtml(word.thai) : '未知'}</div>
              <div style="font-size:0.85rem; color:var(--text-secondary); margin-top:2px;">${word ? escapeHtml(word.meaning) : ''}</div>
            </div>
            <span class="tag tag-error">${err.errorType}</span>
          </div>
          <div style="margin-top:8px; font-size:0.8rem; color:var(--text-muted);">
            你的答案: <span style="color:var(--red-400);">${escapeHtml(err.userAnswer)}</span>
            → 正确: <span style="color:var(--green-600);">${escapeHtml(err.correctAnswer)}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  async function loadStubbornWords() {
    const ids = await getStubbornWordIds();
    if (ids.length === 0) {
      errorContent.innerHTML = `
        <div class="empty-state">
          <span class="emoji">🎉</span>
          <p>没有顽固词</p>
          <p style="font-size:0.85rem; color:var(--text-muted); margin-top:8px;">太棒了！</p>
        </div>
      `;
      return;
    }

    const words: Word[] = [];
    for (const id of ids) {
      const word = await getWord(id);
      if (word) words.push(word);
    }

    errorContent.innerHTML = `
      <div style="margin-bottom:12px; font-size:0.85rem; color:var(--text-secondary);">
        累计错误≥3次的单词，需要重点复习
      </div>
      ${words.map(w => `
        <div class="card" style="margin-bottom:8px; padding:12px 16px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-family:var(--font-thai); font-size:1.2rem; font-weight:600;">${escapeHtml(w.thai)}</div>
              <div style="font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(w.meaning)}</div>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="btn btn-sm btn-success" data-master="${w.id}">已掌握</button>
              <a href="#/review" class="btn btn-sm btn-primary">复习</a>
            </div>
          </div>
        </div>
      `).join('')}
    `;

    errorContent.querySelectorAll('[data-master]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.getAttribute('data-master')!);
        await markStubbornMastered(id);
        showSuccess('已标记为掌握');
        loadStubbornWords();
      });
    });
  }

  content.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      content.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const tabName = tab.getAttribute('data-tab');
      if (tabName === 'today') loadTodayErrors();
      else loadStubbornWords();
    });
  });

  await loadTodayErrors();
}
