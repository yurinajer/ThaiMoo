import { createElement, escapeHtml, shuffleArray } from '../lib/utils';
import { deriveTone, getToneOptions } from '../lib/tone-engine';
import { getAllWords, type Word } from '../db/vocabulary';
import { addErrorRecord } from '../db/errors';
import { normalizeToneId, toneDef, toneZh, type ToneId, type ToneDef } from '../lib/tones';

interface ToneQuestion {
  word: Word;
  answer: ToneId;
  source: 'stored' | 'derived';
  conflict: boolean;
}

// The stored toneMark is authoritative; deriveTone is only a heuristic. A word
// becomes a question only when one of the two yields a tone — the previous
// version guessed 'mid' and produced wrong answer keys.
async function buildQuestions(words: Word[], limit = 20): Promise<ToneQuestion[]> {
  const out: ToneQuestion[] = [];
  for (const word of shuffleArray(words)) {
    if (out.length >= limit) break;
    const stored = normalizeToneId(word.toneMark);
    const derived = (await deriveTone(word.thai))?.result ?? null;
    const answer = stored ?? derived;
    if (!answer) continue;
    out.push({
      word,
      answer,
      source: stored ? 'stored' : 'derived',
      conflict: !!stored && !!derived && stored !== derived,
    });
  }
  return out;
}

export async function renderToneTrainingPage(container: HTMLElement): Promise<void> {
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `
    <button class="back-btn" onclick="window.location.hash='/more'">←</button>
    <h1>声调规则训练</h1>
  `;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  const words = await getAllWords();
  const toneOptions = await getToneOptions();

  if (words.length === 0) {
    content.innerHTML = `
      <div class="empty-state" style="margin-top:40px;">
        <span class="emoji">🍊</span>
        <p>词库为空，请先添加单词</p>
        <a href="#/vocabulary" class="btn btn-primary" style="margin-top:16px;">去添加</a>
      </div>
    `;
    return;
  }

  content.innerHTML = `<div class="loading-hint">正在生成声调题目…</div>`;

  const questions = await buildQuestions(words);

  if (questions.length === 0) {
    content.innerHTML = `
      <div class="empty-state" style="margin-top:40px;">
        <span class="emoji">🔊</span>
        <p>没有可判定的声调题目</p>
        <p style="font-size:0.85rem; color:var(--text-muted); margin-top:8px;">
          这些单词既没有标注声调，规则引擎也无法推导。<br>请在词库中为单词标注声调。
        </p>
        <a href="#/vocabulary" class="btn btn-primary" style="margin-top:16px;">去标注</a>
      </div>
    `;
    return;
  }

  const conflicts = questions.filter(q => q.conflict);

  content.innerHTML = `
    <div class="card" style="margin-bottom:16px; padding:12px 16px;">
      <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px;">五声调对照</div>
      ${toneOptions.map(t => `
        <div class="tone-legend-row">
          <span class="tone-legend-num">${t.num}</span>
          <span class="tone-legend-zh">${escapeHtml(t.zh)}</span>
          <span class="tone-legend-thai">${escapeHtml(t.thai)}</span>
          <span class="tone-legend-en">${escapeHtml(t.en)}</span>
          <span class="tone-legend-symbol">${escapeHtml(t.symbol)}</span>
        </div>
      `).join('')}
    </div>

    ${conflicts.length > 0 ? `
      <div class="card tone-conflict-note" style="margin-bottom:16px; padding:12px 16px;">
        本批 ${questions.length} 题中有 ${conflicts.length} 个词的<strong>已标注声调</strong>与<strong>规则推导结果</strong>不一致，
        练习以你的标注为准。可在词库中复核这些词。
      </div>
    ` : ''}

    <div id="tone-quiz"></div>
  `;

  startToneQuiz(
    content.querySelector('#tone-quiz') as HTMLElement,
    questions,
    toneOptions,
    container
  );
}

function startToneQuiz(
  host: HTMLElement,
  questions: ToneQuestion[],
  toneOptions: ToneDef[],
  pageContainer: HTMLElement
): void {
  let currentIndex = 0;
  let correctCount = 0;
  let answered = false;

  function renderQuestion(): void {
    if (currentIndex >= questions.length) {
      renderResult(pageContainer, correctCount, questions.length);
      return;
    }

    answered = false;
    const q = questions[currentIndex];
    const key = toneDef(q.answer);

    host.innerHTML = `
      <div class="progress-bar" style="margin-bottom:20px;">
        <div class="progress-fill" style="width:${(currentIndex / questions.length) * 100}%"></div>
      </div>
      <div style="text-align:center; margin-bottom:8px; font-size:0.85rem; color:var(--text-muted);">
        ${currentIndex + 1} / ${questions.length}
      </div>

      <div class="card" style="text-align:center; padding:32px 16px; margin-bottom:20px;">
        <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:8px;">请判断以下泰文词的声调</div>
        <div class="thai-text-lg" style="margin-bottom:12px;">${escapeHtml(q.word.thai)}</div>
        ${(q.word.romanization ?? '').trim() ? `<div class="card-roman">${escapeHtml(q.word.romanization!.trim())}</div>` : ''}
        <div style="font-size:0.9rem; color:var(--text-secondary); margin-top:6px;">${escapeHtml(q.word.meaning)}</div>
      </div>

      <div class="quiz-options" id="tone-options">
        ${toneOptions.map(t => `
          <button class="quiz-option" data-tone="${t.id}" style="min-height:52px;">
            <span style="width:20px; font-weight:700; color:var(--orange-600);">${t.num}</span>
            <span style="flex:1;">${escapeHtml(t.zh)}</span>
            <span style="font-family:var(--font-thai); color:var(--text-secondary);">${escapeHtml(t.thai)}</span>
            <span style="color:var(--text-muted);">${escapeHtml(t.symbol)}</span>
          </button>
        `).join('')}
      </div>

      <div id="tone-result" style="display:none; margin-top:16px;"></div>
    `;

    host.querySelectorAll('.quiz-option').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (answered) return;
        answered = true;

        const selected = btn.getAttribute('data-tone') as ToneId;
        const isCorrect = selected === q.answer;

        host.querySelectorAll('.quiz-option').forEach(b => {
          (b as HTMLElement).style.pointerEvents = 'none';
          if (b.getAttribute('data-tone') === q.answer) b.classList.add('correct');
        });

        if (!isCorrect) {
          btn.classList.add('wrong');
          await addErrorRecord(q.word.id!, 'tone', q.word.thai, toneZh(selected), toneZh(q.answer));
        } else {
          correctCount++;
        }

        const chosen = toneDef(selected);
        const derivation = await deriveTone(q.word.thai);
        const resultDiv = host.querySelector('#tone-result') as HTMLElement;
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = `
          <div class="card" style="background:${isCorrect ? '#e8f5e9' : '#ffebee'}; border-color:${isCorrect ? '#a5d6a7' : '#ef9a9a'};">
            <div style="font-weight:600; margin-bottom:8px; color:${isCorrect ? '#2e7d32' : '#c62828'};">
              ${isCorrect ? '✓ 正确！' : `✗ 错误 · 正确答案：${escapeHtml(key.zh)} ${escapeHtml(key.thai)}`}
            </div>
            ${!isCorrect ? `<div style="font-size:0.85rem; color:var(--text-secondary);">你选的：${escapeHtml(chosen.zh)} ${escapeHtml(chosen.thai)}</div>` : ''}
            ${derivation ? `
              <div style="font-size:0.85rem; color:var(--text-secondary); margin-top:8px;">
                <div style="font-weight:500; margin-bottom:4px;">推导过程：</div>
                ${derivation.steps.map(s => `<div style="padding:2px 0;">${escapeHtml(s)}</div>`).join('')}
                <div style="margin-top:4px; font-weight:600; color:var(--orange-500);">
                  → ${escapeHtml(derivation.resultName)} ${escapeHtml(derivation.resultThai)}
                </div>
                ${q.conflict ? `
                  <div class="tone-conflict-inline">
                    ⚠ 词库标注「${escapeHtml(key.zh)}」与规则推导「${escapeHtml(derivation.resultName)}」不一致，
                    本题以词库标注为准，建议复核该词的标注或首辅音分类。
                  </div>
                ` : ''}
              </div>
            ` : `
              <div style="font-size:0.85rem; color:var(--text-muted); margin-top:8px;">
                该答案来自词库标注，规则引擎暂无法推导此词。
              </div>
            `}
          </div>
          <button class="btn btn-primary btn-block" id="btn-next" style="margin-top:12px;">
            ${currentIndex < questions.length - 1 ? '下一题 →' : '查看结果'}
          </button>
        `;

        resultDiv.querySelector('#btn-next')!.addEventListener('click', () => {
          currentIndex++;
          renderQuestion();
        });
      });
    });
  }

  renderQuestion();
}

function renderResult(container: HTMLElement, correct: number, total: number): void {
  const percent = total > 0 ? Math.round((correct / total) * 100) : 0;
  const content = container.querySelector('.page-content') as HTMLElement;

  content.innerHTML = `
    <div class="card" style="text-align:center; margin-top:40px;">
      <div style="font-size:3rem; margin-bottom:16px;">🍊</div>
      <div style="font-size:1.1rem; font-weight:600;">声调训练完成！</div>
      <div style="font-size:2.5rem; font-weight:700; color:var(--orange-500); margin:16px 0;">${percent}%</div>
      <div style="color:var(--text-secondary);">答对 ${correct} / ${total}</div>
    </div>
    <div style="margin-top:24px; display:flex; gap:12px;">
      <a href="#/more" class="btn btn-secondary" style="flex:1;">返回</a>
      <button class="btn btn-primary" style="flex:1;" onclick="window.location.hash='/tone-training'">再来一次</button>
    </div>
  `;
}
