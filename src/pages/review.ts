import { createElement, escapeHtml, toneTagsHtml } from '../lib/utils';
import {
  gradeReview, initNewWordReview, planReviewSession, planSessionCounts,
  getDueCount, getNewWordCount, getGraduatedCount, getGraduatedReviewStates, ungraduateWord,
  GRADE_TABLE, type ReviewGrade,
} from '../db/review';
import { getWord, type Word } from '../db/vocabulary';
import { addErrorRecord } from '../db/errors';
import { bindSpeakButton, speakButtonHtml } from '../components/card-speak';
import { showSuccess } from '../components/toast';
import type { ReviewState } from '../db/index';

type ReviewMode = 'thai-to-cn' | 'cn-to-thai';

// 按钮配色沿用原 4 档的类名，第 5、6 档在 components.css 里补
const GRADE_BTN_CLASS: Record<ReviewGrade, string> = {
  1: 'fsrs-btn-again',
  2: 'fsrs-btn-hard',
  3: 'fsrs-btn-good',
  4: 'fsrs-btn-easy',
  5: 'fsrs-btn-learned',
  6: 'fsrs-btn-mastered',
};

interface ReviewItem {
  word: Word;
  isNew: boolean;
}

export async function renderReviewPage(container: HTMLElement): Promise<void> {
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `<h1>间隔复习</h1>`;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  const [dueCount, newCount, graduatedCount] = await Promise.all([getDueCount(), getNewWordCount(), getGraduatedCount()]);

  const queueIsEmpty = dueCount + newCount === 0;
  const cap = planSessionCounts(dueCount, newCount);

  if (queueIsEmpty && graduatedCount === 0) {
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

  // 队列暂时为空也要留着开始复习的入口：下面「取消毕业」会把词放回队列，
  // 入口常驻就不必为了补一个按钮而整页重绘。空队列点它只会提示，不会开一轮空气复习。
  content.innerHTML = `
    <div class="card" style="text-align:center; margin-bottom:16px;">
      <div style="display:flex; justify-content:space-around;">
        <div>
          <div style="font-size:0.8rem; color:var(--text-muted);">待复习</div>
          <div style="font-size:1.5rem; font-weight:700; color:var(--orange-500);" id="stat-due">${dueCount}</div>
        </div>
        <div>
          <div style="font-size:0.8rem; color:var(--text-muted);">新词</div>
          <div style="font-size:1.5rem; font-weight:700; color:var(--green-500);" id="stat-new">${newCount}</div>
        </div>
        <div>
          <div style="font-size:0.8rem; color:var(--text-muted);">已牢记</div>
          <div style="font-size:1.5rem; font-weight:700; color:var(--text-secondary);" id="stat-graduated">${graduatedCount}</div>
        </div>
      </div>
    </div>

    ${queueIsEmpty ? `
      <div class="card" style="text-align:center;">
        <p>今天没有需要复习的词</p>
        <p style="font-size:0.85rem; color:var(--text-muted); margin-top:8px;">去词库添加新单词吧</p>
        <a href="#/vocabulary" class="btn btn-primary" style="margin-top:16px;">去添加</a>
      </div>
    ` : ''}

    <div class="tabs" id="mode-tabs" style="margin-top:16px;">
      <button class="tab active" data-mode="thai-to-cn">泰文 → 中文</button>
      <button class="tab" data-mode="cn-to-thai">中文 → 泰文 · 默写</button>
    </div>

    <button class="btn btn-primary btn-block btn-lg" id="btn-start-review">${queueIsEmpty ? '开始复习' : `开始复习（本轮 ${cap.planned} 张）`}</button>
    ${cap.dueOmitted + cap.newOmitted > 0 ? `<p class="review-cap-notice">剩余 到期 ${cap.dueOmitted} · 新词 ${cap.newOmitted}，下一轮继续</p>` : ''}

    ${graduatedCount > 0 ? `
      <div class="card" style="margin-top:16px;">
        <button class="graduated-toggle" id="btn-graduated-toggle" aria-expanded="false">
          <span class="row-icon-dot"></span>
          <span>已牢记 ${graduatedCount} 词 · 查看并取消</span>
        </button>
        <div id="graduated-panel" hidden></div>
      </div>
    ` : ''}
  `;

  if (graduatedCount > 0) {
    mountGraduatedSection(content);
  }

  let currentMode: ReviewMode = 'thai-to-cn';

  content.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      content.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentMode = tab.getAttribute('data-mode') as ReviewMode;
    });
  });

  content.querySelector('#btn-start-review')?.addEventListener('click', async () => {
    const items = await buildReviewQueue();
    if (items.length === 0) {
      showSuccess('没有需要复习的词');
      return;
    }
    startReviewSession(container, items, currentMode);
  });
}

// 「已牢记」的词排到时间轴尽头，不再自动回来，所以这里给它一个名单和出口。
// 名单点开才查库，折叠时不付出遍历代价。
function mountGraduatedSection(content: HTMLElement): void {
  const toggle = content.querySelector('#btn-graduated-toggle') as HTMLButtonElement;
  const panel = content.querySelector('#graduated-panel') as HTMLElement;
  const statGraduated = content.querySelector('#stat-graduated') as HTMLElement;
  const statDue = content.querySelector('#stat-due') as HTMLElement;
  let rows: { state: ReviewState; word: Word }[] | null = null;

  toggle.addEventListener('click', async () => {
    if (panel.hidden) {
      if (!rows) {
        const states = await getGraduatedReviewStates();
        const words = await Promise.all(states.map(s => getWord(s.wordId)));
        rows = states
          .map((state, i) => ({ state, word: words[i] }))
          .filter((row): row is { state: ReviewState; word: Word } => !!row.word);
      }
      panel.innerHTML = rows.length === 0
        ? `<div class="graduated-empty">名单已空</div>`
        : rows.map(({ word }) => `
          <div class="list-item" data-word-id="${word.id}">
            <div class="list-item-content">
              <div class="list-item-title" style="font-family:var(--font-thai);">${escapeHtml(word.thai)}</div>
              <div class="list-item-subtitle">${escapeHtml(word.meaning)}</div>
            </div>
            <div class="list-item-action">
              <button class="btn btn-secondary btn-sm" data-ungraduate>取消毕业</button>
            </div>
          </div>
        `).join('');
      panel.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
    } else {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  panel.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest?.('[data-ungraduate]') as HTMLElement | null;
    if (!btn) return;
    const rowEl = btn.closest('.list-item') as HTMLElement;
    const wordId = parseInt(rowEl.getAttribute('data-word-id')!, 10);
    await ungraduateWord(wordId);
    rows = rows?.filter(r => r.state.wordId !== wordId) ?? null;
    rowEl.remove();
    statGraduated.textContent = String(Math.max(0, parseInt(statGraduated.textContent!, 10) - 1));
    statDue.textContent = String(parseInt(statDue.textContent!, 10) + 1);
    toggle.querySelector('span:last-child')!.textContent = `已牢记 ${statGraduated.textContent} 词 · 查看并取消`;
    if (rows && rows.length === 0) panel.innerHTML = `<div class="graduated-empty">名单已空</div>`;
  });
}

// 一轮 = 最先到期的 SESSION_DUE_LIMIT 张 + 入库最早的 SESSION_NEW_LIMIT 张新词，
// 新词一律排在到期词之后。上限之外的词库里状态不动，下一轮从头续。
async function buildReviewQueue(): Promise<ReviewItem[]> {
  const plan = await planReviewSession();

  // plan.due 已按 nextReview 升序，Promise.all 保序，所以这里不需要再排一次
  const dueWords = await Promise.all(plan.due.map(s => getWord(s.wordId)));
  const dueItems: ReviewItem[] = [];
  for (const word of dueWords) {
    if (word) dueItems.push({ word, isNew: false });
  }

  const newItems: ReviewItem[] = [];
  for (const id of plan.newIds) {
    const word = await getWord(id);
    if (!word) continue;
    // 抽中才落排期行：此刻起它算「已排期」，中途退出下一轮会以最先到期的身份回到队首
    await initNewWordReview(id);
    newItems.push({ word, isNew: true });
  }

  return [...dueItems, ...newItems];
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

    const card = createElement('div', {});
    const toneTags = toneTagsHtml(item.word.toneMark);

    if (mode === 'thai-to-cn') {
      card.className = 'flashcard review-card';
      card.id = 'flashcard';
      card.innerHTML = `
        <div class="flashcard-inner">
          <div class="flashcard-front">
            <div class="thai-text-lg" style="font-weight:500;">${escapeHtml(item.word.thai)}</div>
            ${(item.word.romanization ?? '').trim() ? `<div class="card-roman">${escapeHtml(item.word.romanization!.trim())}</div>` : ''}
            ${toneTags ? `<div style="margin-top:8px;">${toneTags}</div>` : ''}
            <div class="flashcard-hint">点击翻转查看释义</div>
          </div>
          <div class="flashcard-back">
            <div style="font-size:1.3rem; font-weight:600; margin-bottom:8px;">${escapeHtml(item.word.meaning)}</div>
            ${item.word.pos ? `<div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:4px;">${escapeHtml(item.word.pos)}</div>` : ''}
            ${item.word.example ? `<div style="font-size:0.85rem; color:var(--text-muted); font-family:var(--font-thai); margin-top:8px;">${escapeHtml(item.word.example)}</div>` : ''}
            ${(item.word.exampleRoman ?? '').trim() ? `<div style="font-size:0.8rem; color:var(--orange-700); margin-top:2px;">${escapeHtml(item.word.exampleRoman!.trim())}</div>` : ''}
            ${(item.word.exampleMeaning ?? '').trim() ? `<div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">${escapeHtml(item.word.exampleMeaning!.trim())}</div>` : ''}
            ${item.word.note ? `<div style="font-size:0.8rem; color:var(--text-muted); margin-top:8px;">📝 ${escapeHtml(item.word.note)}</div>` : ''}
            <div class="flashcard-hint">点击返回泰文</div>
          </div>
        </div>
        ${speakButtonHtml()}
      `;
    } else {
      card.className = 'dictation-card';
      card.id = 'dictation-card';
      card.innerHTML = dictationCardHtml(item.word);
    }

    content.appendChild(card);

    // 泰→中 的卡面本来就写着泰文，朗读喇叭直接长在卡片里；
    // 中→泰 默写的喇叭要等提交后随正确答案一起出现，否则一听读音就等于给了答案。
    if (mode === 'thai-to-cn') bindSpeakButton(card, item.word.thai);

    const fsrsButtons = createElement('div', { className: 'fsrs-buttons', style: 'display:none;', id: 'fsrs-buttons' });
    fsrsButtons.innerHTML = GRADE_TABLE.map(spec => `
      <button class="fsrs-btn ${GRADE_BTN_CLASS[spec.grade]}" data-grade="${spec.grade}">
        <span>${spec.label}</span>
        <span class="interval">${spec.interval}</span>
      </button>
    `).join('');
    content.appendChild(fsrsButtons);

    if (mode === 'thai-to-cn') {
      card.addEventListener('click', () => {
        isFlipped = !isFlipped;
        card.classList.toggle('flipped', isFlipped);
        // 评分按钮一旦露出就常驻：翻回泰文只是收起释义，不能把评分入口一起收掉
        if (isFlipped) {
          document.getElementById('fsrs-buttons')!.style.display = 'grid';
        }
      });
    } else {
      const input = card.querySelector('#dictation-input') as HTMLInputElement;
      const submitBtn = card.querySelector('#btn-submit-dictation') as HTMLButtonElement;
      let submitted = false;

      input.addEventListener('input', () => {
        submitBtn.disabled = submitted || !canSubmitDictation(input.value);
      });

      const submitAnswer = () => {
        if (submitted || !canSubmitDictation(input.value)) return;
        submitted = true;
        input.blur();
        submitBtn.style.display = 'none';
        const userAnswer = createElement('div', { className: 'dictation-user-answer' }, input.value);
        input.replaceWith(userAnswer);
        (card.querySelector('#dictation-user-label') as HTMLElement).style.display = 'block';
        const reveal = card.querySelector('#dictation-reveal') as HTMLElement;
        reveal.innerHTML = dictationRevealHtml(item.word);
        reveal.style.display = 'block';
        document.getElementById('fsrs-buttons')!.style.display = 'grid';
        bindSpeakButton(reveal, item.word.thai);
      };

      submitBtn.addEventListener('click', submitAnswer);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitAnswer();
        }
      });
    }

    header.querySelector('#btn-back')!.addEventListener('click', () => {
      if (confirm('确定退出复习？进度将保留。')) {
        window.location.hash = '/';
      }
    });

    fsrsButtons.querySelectorAll('.fsrs-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const grade = parseInt(btn.getAttribute('data-grade')!, 10) as ReviewGrade;
        await gradeReview(item.word.id!, grade);

        if (grade === 1) {
          await addErrorRecord(
            item.word.id!,
            'review',
            mode === 'thai-to-cn' ? item.word.thai : item.word.meaning,
            '(复习中跳过)',
            mode === 'thai-to-cn' ? item.word.meaning : item.word.thai
          );
          // 队列是开始复习时的一次性快照，排到 10 分钟后本轮不会再见到它，
          // 所以在队尾补一份，这一轮当场再过一遍。
          items.push({ word: item.word, isNew: false });
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

export function canSubmitDictation(value: string): boolean {
  return value.trim().length > 0;
}

export function dictationCardHtml(word: Word): string {
  return `
    <div class="dictation-meaning">${escapeHtml(word.meaning)}</div>
    ${word.pos ? `<div class="dictation-pos">${escapeHtml(word.pos)}</div>` : ''}
    <div class="dictation-user-label" id="dictation-user-label" style="display:none;">你的答案</div>
    <input id="dictation-input" class="input dictation-input" type="text" lang="th"
      placeholder="凭记忆输入泰文拼写" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done">
    <button class="btn btn-primary btn-block btn-lg dictation-submit" id="btn-submit-dictation" disabled>提交答案</button>
    <div class="dictation-reveal" id="dictation-reveal" style="display:none;"></div>
  `;
}

export function dictationRevealHtml(word: Word): string {
  const toneTags = toneTagsHtml(word.toneMark);
  return `
    <div class="dictation-reveal-top">
      <div class="dictation-reveal-label">正确答案</div>
      ${speakButtonHtml()}
    </div>
    <div class="thai-text-lg" style="font-weight:500;">${escapeHtml(word.thai)}</div>
    ${(word.romanization ?? '').trim() ? `<div class="card-roman">${escapeHtml(word.romanization!.trim())}</div>` : ''}
    ${toneTags ? `<div style="margin-top:8px;">${toneTags}</div>` : ''}
    ${word.example ? `<div style="font-size:0.85rem; color:var(--text-muted); font-family:var(--font-thai); margin-top:8px;">${escapeHtml(word.example)}</div>` : ''}
    <div class="dictation-hint">对照上方你的答案，自行评分</div>
  `;
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
