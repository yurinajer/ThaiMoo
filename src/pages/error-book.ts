import { createElement, escapeHtml, shuffleArray } from '../lib/utils';
import { getTodayErrors, getStubbornWordIds, markStubbornMastered } from '../db/errors';
import { getWord, getAllWords, type Word } from '../db/vocabulary';
import { showSuccess } from '../components/toast';

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

    errorContent.innerHTML = errors.map(err => {
      const word = err.wordId > 0 ? wordMap.get(err.wordId) : undefined;
      const typeLabel = errorTypeLabels[err.errorType] || err.errorType;
      const displayTitle = word
        ? `<span style="font-family:var(--font-thai); font-size:1.2rem; font-weight:600;">${escapeHtml(word.thai)}</span>
           <span style="font-size:0.85rem; color:var(--text-secondary); margin-left:8px;">${escapeHtml(word.meaning)}</span>`
        : `<span style="font-family:var(--font-thai); font-size:1.2rem; font-weight:600;">${escapeHtml(err.question)}</span>`;

      return `
        <div class="card" style="margin-bottom:8px; padding:12px 16px;">
          <div style="display:flex; justify-content:space-between; align-items:start;">
            <div style="min-width:0; flex:1;">${displayTitle}</div>
            <span class="tag tag-error" style="flex-shrink:0; margin-left:8px;">${escapeHtml(typeLabel)}</span>
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
      <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
        <div style="font-size:0.85rem; color:var(--text-secondary);">
          累计错误≥3次的单词，需要重点复习
        </div>
        <button class="btn btn-primary btn-sm" id="btn-stubborn-practice">强化练习</button>
      </div>
      ${words.map(w => `
        <div class="card" style="margin-bottom:8px; padding:12px 16px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-family:var(--font-thai); font-size:1.2rem; font-weight:600;">${escapeHtml(w.thai)}</div>
              <div style="font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(w.meaning)}</div>
            </div>
            <button class="btn btn-sm btn-success" data-master="${w.id}">已掌握</button>
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
        ${word.toneMark ? `<div class="tag tag-tone" style="margin-top:8px;">${escapeHtml(word.toneMark)}</div>` : ''}
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
