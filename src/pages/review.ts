import { createElement, escapeHtml, shuffleArray } from '../lib/utils';
import { getDueReviewStates, getNewWordsWithoutReview, gradeReview, initNewWordReview, getDueCount, getNewWordCount } from '../db/review';
import { getWord, type Word } from '../db/vocabulary';
import { addErrorRecord } from '../db/errors';
import { showSuccess } from '../components/toast';
import type { Grade } from 'ts-fsrs';

type ReviewMode = 'thai-to-cn' | 'cn-to-thai';

interface ReviewItem {
  word: Word;
  isNew: boolean;
}

export async function renderReviewPage(container: HTMLElement): Promise<void> {
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `<h1>✏️ 间隔复习</h1>`;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  const [dueCount, newCount] = await Promise.all([getDueCount(), getNewWordCount()]);

  if (dueCount === 0 && newCount === 0) {
    content.innerHTML = `
      <div class="empty-state" style="margin-top:60px;">
        <span class="emoji">🍊</span>
        <p>今天没有需要复习的词</p>
        <p style="font-size:0.85rem; color:var(--text-muted); margin-top:8px;">去词库添加新单词吧</p>
        <a href="#/vocabulary" class="btn btn-primary" style="margin-top:16px;">去添加</a>
      </div>
    `;
    return;
  }

  content.innerHTML = `
    <div class="card" style="text-align:center; margin-bottom:16px;">
      <div style="display:flex; justify-content:space-around;">
        <div>
          <div style="font-size:0.8rem; color:var(--text-muted);">待复习</div>
          <div style="font-size:1.5rem; font-weight:700; color:var(--orange-500);">${dueCount}</div>
        </div>
        <div>
          <div style="font-size:0.8rem; color:var(--text-muted);">新词</div>
          <div style="font-size:1.5rem; font-weight:700; color:var(--green-500);">${newCount}</div>
        </div>
      </div>
    </div>

    <div class="tabs" id="mode-tabs">
      <button class="tab active" data-mode="thai-to-cn">泰文 → 中文</button>
      <button class="tab" data-mode="cn-to-thai">中文 → 泰文</button>
    </div>

    <button class="btn btn-primary btn-block btn-lg" id="btn-start-review">开始复习</button>
  `;

  let currentMode: ReviewMode = 'thai-to-cn';

  content.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      content.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentMode = tab.getAttribute('data-mode') as ReviewMode;
    });
  });

  content.querySelector('#btn-start-review')!.addEventListener('click', async () => {
    const items = await buildReviewQueue();
    if (items.length === 0) {
      showSuccess('没有需要复习的词');
      return;
    }
    startReviewSession(container, items, currentMode);
  });
}

async function buildReviewQueue(): Promise<ReviewItem[]> {
  const items: ReviewItem[] = [];

  const dueStates = await getDueReviewStates();
  for (const state of dueStates) {
    const word = await getWord(state.wordId);
    if (word) items.push({ word, isNew: false });
  }

  const newIds = await getNewWordsWithoutReview(20);
  for (const id of newIds) {
    const word = await getWord(id);
    if (word) {
      await initNewWordReview(id);
      items.push({ word, isNew: true });
    }
  }

  return shuffleArray(items);
}

function startReviewSession(container: HTMLElement, items: ReviewItem[], mode: ReviewMode): void {
  let currentIndex = 0;
  let correctCount = 0;
  let isFlipped = false;

  function renderCurrentItem(): void {
    if (currentIndex >= items.length) {
      renderSessionComplete(container, correctCount, items.length);
      return;
    }

    const item = items[currentIndex];
    isFlipped = false;

    container.innerHTML = '';

    const header = createElement('div', { className: 'page-header' });
    header.innerHTML = `
      <button class="back-btn" id="btn-back">←</button>
      <h1>复习中</h1>
      <span style="font-size:0.85rem; opacity:0.8;">${currentIndex + 1}/${items.length}</span>
    `;
    container.appendChild(header);

    const content = createElement('div', { className: 'page-content' });
    container.appendChild(content);

    const progress = createElement('div', { className: 'progress-bar', style: 'margin-bottom:20px;' });
    progress.innerHTML = `<div class="progress-fill" style="width:${((currentIndex) / items.length) * 100}%"></div>`;
    content.appendChild(progress);

    if (item.isNew) {
      const badge = createElement('div', { style: 'text-align:center; margin-bottom:12px;' });
      badge.innerHTML = `<span class="tag" style="background:var(--green-500); color:white;">新词</span>`;
      content.appendChild(badge);
    }

    const card = createElement('div', { className: 'flashcard', id: 'flashcard' });

    if (mode === 'thai-to-cn') {
      card.innerHTML = `
        <div class="flashcard-inner">
          <div class="flashcard-front">
            <div class="thai-text-lg" style="font-weight:500;">${escapeHtml(item.word.thai)}</div>
            ${item.word.toneMark ? `<div class="tag tag-tone" style="margin-top:8px;">${escapeHtml(item.word.toneMark)}</div>` : ''}
            <div class="flashcard-hint">点击翻转查看释义</div>
          </div>
          <div class="flashcard-back">
            <div style="font-size:1.3rem; font-weight:600; margin-bottom:8px;">${escapeHtml(item.word.meaning)}</div>
            ${item.word.pos ? `<div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:4px;">${escapeHtml(item.word.pos)}</div>` : ''}
            ${item.word.example ? `<div style="font-size:0.85rem; color:var(--text-muted); font-family:var(--font-thai); margin-top:8px;">${escapeHtml(item.word.example)}</div>` : ''}
            ${item.word.note ? `<div style="font-size:0.8rem; color:var(--text-muted); margin-top:8px;">📝 ${escapeHtml(item.word.note)}</div>` : ''}
          </div>
        </div>
      `;
    } else {
      card.innerHTML = `
        <div class="flashcard-inner">
          <div class="flashcard-front">
            <div style="font-size:1.3rem; font-weight:600; margin-bottom:8px;">${escapeHtml(item.word.meaning)}</div>
            ${item.word.pos ? `<div style="font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(item.word.pos)}</div>` : ''}
            <div class="flashcard-hint">点击翻转查看泰文拼写</div>
          </div>
          <div class="flashcard-back">
            <div class="thai-text-lg" style="font-weight:500;">${escapeHtml(item.word.thai)}</div>
            ${item.word.toneMark ? `<div class="tag tag-tone" style="margin-top:8px;">${escapeHtml(item.word.toneMark)}</div>` : ''}
            ${item.word.example ? `<div style="font-size:0.85rem; color:var(--text-muted); font-family:var(--font-thai); margin-top:8px;">${escapeHtml(item.word.example)}</div>` : ''}
          </div>
        </div>
      `;
    }

    content.appendChild(card);

    const fsrsButtons = createElement('div', { className: 'fsrs-buttons', style: 'display:none;', id: 'fsrs-buttons' });
    fsrsButtons.innerHTML = `
      <button class="fsrs-btn fsrs-btn-again" data-grade="1">
        <span>忘记</span>
        <span class="interval">&lt;1分钟</span>
      </button>
      <button class="fsrs-btn fsrs-btn-hard" data-grade="2">
        <span>困难</span>
        <span class="interval">&lt;10分钟</span>
      </button>
      <button class="fsrs-btn fsrs-btn-good" data-grade="3">
        <span>良好</span>
        <span class="interval">1天</span>
      </button>
      <button class="fsrs-btn fsrs-btn-easy" data-grade="4">
        <span>简单</span>
        <span class="interval">4天</span>
      </button>
    `;
    content.appendChild(fsrsButtons);

    card.addEventListener('click', () => {
      if (!isFlipped) {
        isFlipped = true;
        card.classList.add('flipped');
        document.getElementById('fsrs-buttons')!.style.display = 'grid';
      }
    });

    header.querySelector('#btn-back')!.addEventListener('click', () => {
      if (confirm('确定退出复习？进度将保留。')) {
        window.location.hash = '/';
      }
    });

    fsrsButtons.querySelectorAll('.fsrs-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const grade = parseInt(btn.getAttribute('data-grade')!) as Grade;
        await gradeReview(item.word.id!, grade);

        if (grade === 1) {
          await addErrorRecord(
            item.word.id!,
            'review',
            mode === 'thai-to-cn' ? item.word.thai : item.word.meaning,
            '(复习中跳过)',
            mode === 'thai-to-cn' ? item.word.meaning : item.word.thai
          );
        } else {
          correctCount++;
        }

        currentIndex++;
        renderCurrentItem();
      });
    });
  }

  renderCurrentItem();
}

function renderSessionComplete(container: HTMLElement, correct: number, total: number): void {
  const percent = total > 0 ? Math.round((correct / total) * 100) : 0;

  container.innerHTML = '';
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `<h1>复习完成 🎉</h1>`;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  content.innerHTML = `
    <div class="card" style="text-align:center; margin-top:40px;">
      <div style="font-size:3rem; margin-bottom:16px;">🍊</div>
      <div style="font-size:1.1rem; font-weight:600; margin-bottom:8px;">复习完成！</div>
      <div style="font-size:2.5rem; font-weight:700; color:var(--orange-500); margin:16px 0;">${percent}%</div>
      <div style="color:var(--text-secondary);">答对 ${correct} / ${total}</div>
    </div>

    <div style="margin-top:24px; display:flex; gap:12px;">
      <a href="#/" class="btn btn-primary" style="flex:1;">返回首页</a>
      <a href="#/error-book" class="btn btn-secondary" style="flex:1;">查看错词</a>
    </div>
  `;
}
