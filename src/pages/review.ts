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
      <button class="tab" data-mode="cn-to-thai">中文 → 泰文 · 可选默写</button>
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
    card.className = 'flashcard review-card';
    card.id = 'flashcard';

    // 两个方向共用同一副翻卡：正面题干、背面答案与详情。
    // 中→泰 的默写挂在正面，是可选练习，不是翻卡或评分的前置条件。
    card.innerHTML = mode === 'thai-to-cn'
      ? `
        <div class="flashcard-inner">
          <div class="flashcard-front">
            ${thaiFaceHtml(item.word)}
            <div class="flashcard-hint">点击翻转查看释义</div>
          </div>
          <div class="flashcard-back">
            <div style="font-size:1.3rem; font-weight:600; margin-bottom:8px;">${escapeHtml(item.word.meaning)}</div>
            ${wordDetailsHtml(item.word)}
            <div class="flashcard-hint">点击返回泰文</div>
          </div>
        </div>
        ${speakButtonHtml()}
      `
      : `
        <div class="flashcard-inner">
          <div class="flashcard-front">${dictationQuestionHtml(item.word)}</div>
          <div class="flashcard-back">${dictationAnswerHtml(item.word)}</div>
        </div>
        ${speakButtonHtml()}
      `;

    content.appendChild(card);

    const fsrsButtons = createElement('div', { className: 'fsrs-buttons', style: 'display:none;', id: 'fsrs-buttons' });
    fsrsButtons.innerHTML = GRADE_TABLE.map(spec => `
      <button class="fsrs-btn ${GRADE_BTN_CLASS[spec.grade]}" data-grade="${spec.grade}">
        <span>${spec.label}</span>
        <span class="interval">${spec.interval}</span>
      </button>
    `).join('');
    content.appendChild(fsrsButtons);

    // 泰→中 的正面本来就写着泰文，朗读喇叭直接长在卡片里；
    // 中→泰 一听读音等于给了答案，所以要等答案面露出（翻卡或提交默写）才亮。
    const speakBtn = card.querySelector('.card-speak') as HTMLElement;
    let answerShown = false;
    if (mode === 'thai-to-cn') {
      bindSpeakButton(card, item.word.thai);
    } else {
      speakBtn.style.display = 'none';
    }

    // 答案一旦露出就不再收回去：翻回题干只是收起答案面，评分入口和读音要留着。
    const revealAnswer = (): void => {
      if (answerShown) return;
      answerShown = true;
      fsrsButtons.style.display = 'grid';
      if (mode === 'cn-to-thai') {
        speakBtn.style.display = '';
        bindSpeakButton(card, item.word.thai);
      }
    };

    card.addEventListener('click', () => {
      isFlipped = !isFlipped;
      card.classList.toggle('flipped', isFlipped);
      if (isFlipped) revealAnswer();
    });

    if (mode === 'cn-to-thai') {
      const toggle = card.querySelector('#btn-dictation-toggle') as HTMLButtonElement;
      const panel = card.querySelector('#dictation-panel') as HTMLElement;
      const input = card.querySelector('#dictation-input') as HTMLInputElement;
      const submitBtn = card.querySelector('#btn-submit-dictation') as HTMLButtonElement;
      let submitted = false;

      // 默写区里的点击是打字用的，不能顺手把卡片翻了
      panel.addEventListener('click', (e) => e.stopPropagation());
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.hidden = !panel.hidden;
        toggle.setAttribute('aria-expanded', String(!panel.hidden));
      });

      input.addEventListener('input', () => {
        submitBtn.disabled = submitted || !canSubmitDictation(input.value);
      });

      const submitAnswer = () => {
        if (submitted || !canSubmitDictation(input.value)) return;
        submitted = true;
        input.blur();
        // 面板还能重新展开，提交入口必须跟着置灰，不能留着一个点了没反应的按钮
        submitBtn.disabled = true;
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        toggle.textContent = '已默写';
        // 「你的答案」写在背面，和「正确答案」上下相邻，方便逐字对照
        const userAnswer = card.querySelector('#dictation-user-answer') as HTMLElement;
        userAnswer.textContent = input.value;
        userAnswer.style.display = 'flex';
        (card.querySelector('#dictation-user-label') as HTMLElement).style.display = 'block';
        (card.querySelector('#dictation-score-hint') as HTMLElement).style.display = 'block';
        isFlipped = true;
        card.classList.add('flipped');
        revealAnswer();
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
          // 忘记只改排期（10 分钟后到期），本轮不补考：队列是开始复习时的一次性快照，
          // 想再过一遍就下一轮进来。
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

// 泰文侧的题面/答案头：泰文 + 罗马音 + 逐音节声调，泰→中 正面和中→泰 背面共用。
function thaiFaceHtml(word: Word): string {
  const toneTags = toneTagsHtml(word.toneMark);
  return `
    <div class="thai-text-lg" style="font-weight:500;">${escapeHtml(word.thai)}</div>
    ${(word.romanization ?? '').trim() ? `<div class="card-roman">${escapeHtml(word.romanization!.trim())}</div>` : ''}
    ${toneTags ? `<div style="margin-top:8px;">${toneTags}</div>` : ''}
  `;
}

// 题干/答案之外的词库字段，缺项直接不渲染，两个方向共用同一段。
function wordDetailsHtml(word: Word): string {
  return `
    ${word.pos ? `<div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:4px;">${escapeHtml(word.pos)}</div>` : ''}
    ${word.example ? `<div style="font-size:0.85rem; color:var(--text-muted); font-family:var(--font-thai); margin-top:8px;">${escapeHtml(word.example)}</div>` : ''}
    ${(word.exampleRoman ?? '').trim() ? `<div style="font-size:0.8rem; color:var(--orange-700); margin-top:2px;">${escapeHtml(word.exampleRoman!.trim())}</div>` : ''}
    ${(word.exampleMeaning ?? '').trim() ? `<div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">${escapeHtml(word.exampleMeaning!.trim())}</div>` : ''}
    ${word.note ? `<div style="font-size:0.8rem; color:var(--text-muted); margin-top:8px;">📝 ${escapeHtml(word.note)}</div>` : ''}
  `;
}

// 中→泰 正面：只给中文题干和可选的默写入口，绝不提前漏出泰文、罗马音或声调。
export function dictationQuestionHtml(word: Word): string {
  return `
    <div class="dictation-meaning">${escapeHtml(word.meaning)}</div>
    ${word.pos ? `<div class="dictation-pos">${escapeHtml(word.pos)}</div>` : ''}
    <div class="dictation-tools">
      <button class="btn btn-secondary btn-sm" id="btn-dictation-toggle" type="button" aria-expanded="false">默写</button>
    </div>
    <div class="dictation-panel" id="dictation-panel" hidden>
      <input id="dictation-input" class="input dictation-input" type="text" lang="th"
        placeholder="凭记忆输入泰文拼写" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done">
      <button class="btn btn-primary btn-block btn-lg dictation-submit" id="btn-submit-dictation" disabled>提交答案</button>
    </div>
    <div class="flashcard-hint">点击卡片翻转看泰文，想先写一遍就点「默写」</div>
  `;
}

// 中→泰 背面：答案加详情。「你的答案」和评分提示只有提交过默写才露出来，
// 直接翻卡时这两块保持隐藏，看起来就和泰→中 的答案面一样。
export function dictationAnswerHtml(word: Word): string {
  return `
    <div class="dictation-user-label" id="dictation-user-label" style="display:none;">你的答案</div>
    <div class="dictation-user-answer" id="dictation-user-answer" style="display:none;"></div>
    <div class="dictation-answer-label">正确答案</div>
    ${thaiFaceHtml(word)}
    ${wordDetailsHtml(word)}
    <div class="dictation-hint" id="dictation-score-hint" style="display:none;">对照上方「你的答案」自行评分，再选下面的复习档位</div>
    <div class="flashcard-hint">点击卡片可翻回中文</div>
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
