import { createElement, escapeHtml, shuffleArray } from '../lib/utils';
import { getTodayErrors, getStubbornWordIds, markStubbornMastered, getWordErrors } from '../db/errors';
import { getWord, getAllWords, type Word } from '../db/vocabulary';
import { showSuccess } from '../components/toast';
import { showWordDetail } from '../components/word-detail';
import { showWordFormModal } from './vocabulary';
import { getStubbornThreshold } from '../db/index';
import { toneZh } from '../lib/tones';
import type { ErrorRecord } from '../db/index';

const ERROR_TYPE_LABELS: Record<string, string> = {
  tone: '声调',
  spelling: '拼写读音',
  consonant: '辅音分类',
  'minimal-pair': '易混淆词',
  review: '复习',
};

// Legacy tone records stored raw ids ('mid') or old labels ('高升'); both are
// unreadable in the list, so run them through the tone table before display.
function prettyAnswer(errorType: string, raw: string): string {
  if (errorType !== 'tone') return raw;
  return toneZh(raw) || raw;
}

function buildErrorHistoryHtml(errors: ErrorRecord[]): string {
  if (errors.length === 0) return '';
  const items = errors.slice(0, 8).map(err => `
    <div class="detail-extra-item">
      <div>
        <span class="tag tag-error">${escapeHtml(ERROR_TYPE_LABELS[err.errorType] || err.errorType)}</span>
        <span style="margin-left:6px; color:var(--text-muted); font-size:0.75rem;">${escapeHtml(err.date)}</span>
      </div>
      <div style="margin-top:4px;">
        作答 <span style="color:var(--red-400);">${escapeHtml(prettyAnswer(err.errorType, err.userAnswer))}</span>
        → 正确 <span style="color:var(--green-600);">${escapeHtml(prettyAnswer(err.errorType, err.correctAnswer))}</span>
      </div>
    </div>
  `).join('');

  return `
    <div class="detail-extra-title">错题记录（共 ${errors.length} 条${errors.length > 8 ? '，显示最近 8 条' : ''}）</div>
    ${items}
  `;
}

export async function renderErrorBookPage(container: HTMLElement): Promise<void> {
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `
    <button class="back-btn" onclick="window.location.hash='/'">←</button>
    <h1>错词本</h1>
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
      if (err.wordId > 0 && !wordMap.has(err.wordId)) {
        const word = await getWord(err.wordId);
        if (word) wordMap.set(err.wordId, word);
      }
    }

    const errorTypeLabels: Record<string, string> = {
      'tone': '声调',
      'spelling': '拼写读音',
      'consonant': '辅音分类',
      'minimal-pair': '易混淆词',
      'review': '复习',
    };

    errorContent.innerHTML = errors.map((err, i) => {
      const word = err.wordId > 0 ? wordMap.get(err.wordId) : undefined;
      const typeLabel = ERROR_TYPE_LABELS[err.errorType] || err.errorType;
      const displayTitle = word
        ? `<span style="font-family:var(--font-thai); font-size:1.2rem; font-weight:600;">${escapeHtml(word.thai)}</span>
           <span style="font-size:0.85rem; color:var(--text-secondary); margin-left:8px;">${escapeHtml(word.meaning)}</span>`
        : `<span style="font-family:var(--font-thai); font-size:1.2rem; font-weight:600;">${escapeHtml(err.question)}</span>`;

      return `
        <div class="card word-card" data-err-idx="${i}" style="margin-bottom:8px; padding:12px 16px;">
          <div style="display:flex; justify-content:space-between; align-items:start;">
            <div style="min-width:0; flex:1;">${displayTitle}</div>
            <span class="tag tag-error" style="flex-shrink:0; margin-left:8px;">${escapeHtml(typeLabel)}</span>
          </div>
          <div style="margin-top:8px; font-size:0.8rem; color:var(--text-muted);">
            你的答案: <span style="color:var(--red-400);">${escapeHtml(prettyAnswer(err.errorType, err.userAnswer))}</span>
            → 正确: <span style="color:var(--green-600);">${escapeHtml(prettyAnswer(err.errorType, err.correctAnswer))}</span>
          </div>
          <div style="margin-top:6px; font-size:0.75rem; color:var(--text-muted);">点击查看详情 ›</div>
        </div>
      `;
    }).join('');

    errorContent.querySelectorAll<HTMLElement>('.word-card').forEach(card => {
      card.addEventListener('click', async () => {
        const err = errors[parseInt(card.getAttribute('data-err-idx')!)];
        const history = err.wordId > 0 ? await getWordErrors(err.wordId) : [err];
        const extra = buildErrorHistoryHtml(history);

        if (err.wordId > 0) {
          const word = await getWord(err.wordId);
          if (word) {
            showWordDetail(word, {
              extraHtml: extra,
              onEdit: w => showWordFormModal(w, () => loadTodayErrors()),
            });
            return;
          }
        }

        showRuleErrorDetail(err, extra);
      });
    });
  }

  function showRuleErrorDetail(err: ErrorRecord, extra: string): void {
    const overlay = createElement('div', { className: 'sheet-overlay' });
    overlay.innerHTML = `
      <div class="sheet" role="dialog" aria-modal="true" aria-label="知识点详情">
        <div class="sheet-header">
          <div class="sheet-handle"></div>
          <h2>知识点详情</h2>
          <button class="modal-close" aria-label="关闭">&times;</button>
        </div>
        <div class="sheet-body">
          <div class="detail-head">
            <div class="detail-head-main">
              <div class="detail-thai">${escapeHtml(err.question)}</div>
              <div class="detail-meaning">${escapeHtml(ERROR_TYPE_LABELS[err.errorType] || err.errorType)}</div>
            </div>
          </div>
          <div class="detail-row">
            <div class="detail-label">类型</div>
            <div class="detail-value">非词库知识点，详情来自${escapeHtml(ERROR_TYPE_LABELS[err.errorType] || err.errorType)}测验本身</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">正确项</div>
            <div class="detail-value"><span style="color:var(--green-600);">${escapeHtml(prettyAnswer(err.errorType, err.correctAnswer))}</span></div>
          </div>
          ${extra ? `<div class="detail-extra">${extra}</div>` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => { overlay.classList.add('closing'); setTimeout(() => overlay.remove(), 180); };
    overlay.querySelector('.modal-close')!.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
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

    const threshold = await getStubbornThreshold();

    errorContent.innerHTML = `
      <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
        <div style="font-size:0.85rem; color:var(--text-secondary);">
          累计错误≥${threshold}次的单词，需要重点复习
        </div>
        <button class="btn btn-primary btn-sm" id="btn-stubborn-practice">强化练习</button>
      </div>
      ${words.map(w => `
        <div class="card word-card" data-stub-born="${w.id}" style="margin-bottom:8px; padding:12px 16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <div style="min-width:0; flex:1;">
              <div style="font-family:var(--font-thai); font-size:1.2rem; font-weight:600;">${escapeHtml(w.thai)}</div>
              ${(w.romanization ?? '').trim() ? `<div class="word-card-roman">${escapeHtml(w.romanization!.trim())}</div>` : ''}
              <div style="font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(w.meaning)}</div>
            </div>
            <button class="btn btn-sm btn-success" data-master="${w.id}">已掌握</button>
          </div>
        </div>
      `).join('')}
    `;

    errorContent.querySelectorAll('[data-master]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.getAttribute('data-master')!);
        await markStubbornMastered(id);
        showSuccess('已标记为掌握');
        loadStubbornWords();
      });
    });

    errorContent.querySelectorAll<HTMLElement>('[data-stub-born]').forEach(card => {
      card.addEventListener('click', async () => {
        const id = parseInt(card.getAttribute('data-stub-born')!);
        const word = words.find(w => w.id === id);
        if (!word) return;
        const history = await getWordErrors(id);
        showWordDetail(word, {
          extraHtml: `
            <div class="detail-extra-title">顽固词信息</div>
            <div class="detail-extra-item">累计错误 ${history.length} 次，达到阈值 ${threshold} 次后被标记</div>
            ${buildErrorHistoryHtml(history)}
          `,
          onEdit: w => showWordFormModal(w, () => loadStubbornWords()),
        });
      });
    });

    errorContent.querySelector('#btn-stubborn-practice')!.addEventListener('click', () => {
      startStubbornPractice(content, words);
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

function startStubbornPractice(content: HTMLElement, stubbornWords: Word[]): void {
  const questions = shuffleArray(stubbornWords);
  let currentIndex = 0;
  let correctCount = 0;
  let answered = false;
  let allWordsCache: Word[] | null = null;

  async function renderQuestion(): Promise<void> {
    if (currentIndex >= questions.length) {
      const percent = Math.round((correctCount / questions.length) * 100);
      content.innerHTML = `
        <div class="card" style="text-align:center; margin-top:40px;">
          <div style="font-size:3rem; margin-bottom:16px;">💪</div>
          <div style="font-size:1.1rem; font-weight:600;">强化练习完成！</div>
          <div style="font-size:2.5rem; font-weight:700; color:var(--orange-500); margin:16px 0;">${percent}%</div>
          <div style="color:var(--text-secondary);">答对 ${correctCount} / ${questions.length}</div>
        </div>
        <div style="margin-top:24px; display:flex; gap:12px;">
          <button class="btn btn-primary" style="flex:1;" id="btn-practice-again">再来一次</button>
          <a href="#/error-book" class="btn btn-secondary" style="flex:1;">返回错词本</a>
        </div>
      `;
      content.querySelector('#btn-practice-again')!.addEventListener('click', () => {
        startStubbornPractice(content, stubbornWords);
      });
      return;
    }

    answered = false;
    const word = questions[currentIndex];

    if (!allWordsCache) {
      allWordsCache = await getAllWords();
    }

    const distractors = shuffleArray(
      allWordsCache.filter(w => w.id !== word.id && w.meaning !== word.meaning)
    ).slice(0, 3);

    if (distractors.length < 3) {
      const fallback = shuffleArray(
        stubbornWords.filter(w => w.id !== word.id)
      ).slice(0, 3 - distractors.length);
      distractors.push(...fallback);
    }

    const options = shuffleArray([
      { meaning: word.meaning, correct: true },
      ...distractors.map(d => ({ meaning: d.meaning, correct: false })),
    ]);

    content.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <button class="btn btn-sm btn-secondary" id="btn-quit-practice">退出练习</button>
        <span style="font-size:0.85rem; color:var(--text-muted);">顽固词强化</span>
      </div>
      <div class="progress-bar" style="margin-bottom:16px;">
        <div class="progress-fill" style="width:${(currentIndex / questions.length) * 100}%"></div>
      </div>
      <div style="text-align:center; margin-bottom:8px; font-size:0.85rem; color:var(--text-muted);">
        ${currentIndex + 1} / ${questions.length}
      </div>
      <div class="card" style="text-align:center; padding:28px 16px; margin-bottom:20px;">
        <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:8px;">请选择正确的中文释义</div>
        <div style="font-family:var(--font-thai); font-size:2rem; font-weight:700;">${escapeHtml(word.thai)}</div>
        ${toneZh(word.toneMark) ? `<div class="tag tag-tone" style="margin-top:8px;">${escapeHtml(toneZh(word.toneMark))}</div>` : ''}
      </div>
      <div class="quiz-options" id="practice-options">
        ${options.map((opt, i) => `
          <button class="quiz-option" data-idx="${i}" data-correct="${opt.correct}">
            <span>${escapeHtml(opt.meaning)}</span>
          </button>
        `).join('')}
      </div>
      <div id="practice-feedback" style="min-height:24px; margin-top:12px; text-align:center; font-size:0.9rem;"></div>
    `;

    content.querySelector('#btn-quit-practice')!.addEventListener('click', () => {
      window.location.hash = '/error-book';
    });

    content.querySelectorAll('.quiz-option').forEach(btn => {
      btn.addEventListener('click', () => {
        if (answered) return;
        answered = true;
        const isCorrect = btn.getAttribute('data-correct') === 'true';

        content.querySelectorAll('.quiz-option').forEach(b => {
          (b as HTMLElement).style.pointerEvents = 'none';
          if (b.getAttribute('data-correct') === 'true') b.classList.add('correct');
        });

        const feedback = content.querySelector('#practice-feedback') as HTMLElement;
        if (!isCorrect) {
          btn.classList.add('wrong');
          feedback.textContent = `正确答案：${word.meaning}`;
          feedback.style.color = 'var(--red-400)';
        } else {
          correctCount++;
          feedback.textContent = '✓ 正确！';
          feedback.style.color = 'var(--green-500)';
        }

        setTimeout(() => {
          currentIndex++;
          renderQuestion();
        }, 1200);
      });
    });
  }

  renderQuestion();
}
