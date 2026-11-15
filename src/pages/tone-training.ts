import { createElement, escapeHtml, shuffleArray } from '../lib/utils';
import { deriveTone, getToneOptions, type ToneDerivation } from '../lib/tone-engine';
import { getAllWords, type Word } from '../db/vocabulary';
import { addErrorRecord } from '../db/errors';
import { normalizeToneSeq, toneDef, toneSeqToStorage, type ToneId, type ToneDef } from '../lib/tones';

interface ToneQuestion {
  word: Word;
  // 按朗读顺序逐音节排列，至少一项；词库标注 mid-high 就是两问。
  answers: ToneId[];
  source: 'stored' | 'derived';
  conflict: boolean;
  derivation: ToneDerivation | null;
}

export interface SyllableVerdict {
  index: number;
  answer: ToneId;
  picked: ToneId | null;
  correct: boolean;
}

// 题干的正确项、判定、反馈文案和错题记录全部出自这一份逐音节结果，
// 避免出现「按 A 判分、按 B 显示」那类自相矛盾的反馈。
export function gradeToneSeq(answers: ToneId[], picks: (ToneId | null)[]): SyllableVerdict[] {
  return answers.map((answer, i) => {
    const picked = picks[i] ?? null;
    return { index: i + 1, answer, picked, correct: picked === answer };
  });
}

// 罗马音按项目转写方案逐音节用 - 连接（sà-wàt-dii）。段数与标注音节数一致时才能
// 拿它当题干的音节提示；对不上就只显示序号，不能把一种错误的切分教给用户。
export function toneSyllableHints(romanization: string | null | undefined, count: number): string[] | null {
  const parts = (romanization ?? '').split(/[-–—_/／\s]+/).map(s => s.trim()).filter(s => s !== '');
  return parts.length === count ? parts : null;
}

// 词库标注优先，deriveTone 只是无标注时的兜底启发式。规则引擎只处理单音节，
// 所以多音节词一律以标注为准，既不推导也不报“标注与推导不一致”。
async function buildQuestions(words: Word[], limit = 20): Promise<ToneQuestion[]> {
  const out: ToneQuestion[] = [];
  for (const word of shuffleArray(words)) {
    if (out.length >= limit) break;
    const stored = normalizeToneSeq(word.toneMark);
    const derivation = stored.length > 1 ? null : await deriveTone(word.thai);
    if (stored.length === 0 && !derivation) continue;
    out.push({
      word,
      answers: stored.length > 0 ? stored : [derivation!.result],
      source: stored.length > 0 ? 'stored' : 'derived',
      conflict: stored.length === 1 && !!derivation && stored[0] !== derivation.result,
      derivation,
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
  const multiSyllable = questions.filter(q => q.answers.length > 1).length;

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

    ${multiSyllable > 0 ? `
      <div class="card tone-conflict-note" style="margin-bottom:16px; padding:12px 16px;">
        本批有 ${multiSyllable} 个多音节词，会按音节<strong>逐个提问</strong>，答完最后一个音节再给出逐音节判定。
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
  let wordIndex = 0;
  let syllableIndex = 0;
  let picks: ToneId[] = [];
  let locked = false;
  let correctWords = 0;
  let correctSyllables = 0;
  let totalSyllables = 0;

  function renderSyllable(): void {
    const q = questions[wordIndex];
    const total = q.answers.length;
    const hints = toneSyllableHints(q.word.romanization, total);
    locked = false;

    const chips = q.answers.map((_, i) => {
      const label = hints ? hints[i] : `第 ${i + 1} 音节`;
      const state = i < syllableIndex ? ' done' : i === syllableIndex ? ' active' : '';
      return `<span class="tone-syllable-chip${state}">${escapeHtml(label)}</span>`;
    }).join('<span class="tone-syllable-sep">·</span>');

    host.innerHTML = `
      <div class="progress-bar" style="margin-bottom:20px;">
        <div class="progress-fill" style="width:${(wordIndex / questions.length) * 100}%"></div>
      </div>
      <div style="text-align:center; margin-bottom:8px; font-size:0.85rem; color:var(--text-muted);">
        ${wordIndex + 1} / ${questions.length}
        ${total > 1 ? ` · 第 ${syllableIndex + 1} / ${total} 音节` : ''}
      </div>

      <div class="card" style="text-align:center; padding:24px 16px; margin-bottom:16px;">
        <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:8px;">请判断以下泰文词的声调</div>
        <div class="thai-text-lg" style="margin-bottom:12px;">${escapeHtml(q.word.thai)}</div>
        ${(q.word.romanization ?? '').trim() ? `<div class="card-roman">${escapeHtml(q.word.romanization!.trim())}</div>` : ''}
        <div style="font-size:0.9rem; color:var(--text-secondary); margin-top:6px;">${escapeHtml(q.word.meaning)}</div>
        ${total > 1 ? `
          <div class="tone-syllable-row">${chips}</div>
          <div style="font-size:0.78rem; color:var(--text-muted); margin-top:8px;">
            共 ${total} 个音节，现在判断${hints ? '高亮的那一段罗马音' : `第 ${syllableIndex + 1} 个音节`}
          </div>
        ` : ''}
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
      btn.addEventListener('click', () => {
        if (locked) return;
        locked = true;
        picks.push(btn.getAttribute('data-tone') as ToneId);

        // 多音节词把每个音节问完再统一判定，中途不透露对错。
        if (syllableIndex + 1 < total) {
          syllableIndex++;
          renderSyllable();
          return;
        }
        void finishWord();
      });
    });
  }

  async function finishWord(): Promise<void> {
    const q = questions[wordIndex];
    const verdicts = gradeToneSeq(q.answers, picks);
    const allCorrect = verdicts.every(v => v.correct);
    const hints = toneSyllableHints(q.word.romanization, verdicts.length);

    totalSyllables += verdicts.length;
    correctSyllables += verdicts.filter(v => v.correct).length;
    if (allCorrect) correctWords++;
    // 一词一条记录，两个字段都是同一顺序的音节序列：错题本按序列显示，顽固词的
    // 计数仍按“答错一个词”累加，不会被音节数放大。
    else await addErrorRecord(q.word.id!, 'tone', q.word.thai, toneSeqToStorage(picks), toneSeqToStorage(q.answers));

    const rows = verdicts.map(v => {
      const key = toneDef(v.answer);
      const chosen = v.picked ? toneDef(v.picked) : null;
      return `
        <div class="tone-verdict-row${v.correct ? ' ok' : ' bad'}">
          <span class="tone-verdict-mark">${v.correct ? '✓' : '✗'}</span>
          <span class="tone-verdict-label">${escapeHtml(hints ? hints[v.index - 1] : `第 ${v.index} 音节`)}</span>
          <span class="tone-verdict-answer">${escapeHtml(`${key.zh} ${key.thai} ${key.symbol}`)}</span>
          ${v.correct || !chosen ? '' : `<span class="tone-verdict-picked">你选：${escapeHtml(chosen.zh)}</span>`}
        </div>
      `;
    }).join('');

    const resultDiv = host.querySelector('#tone-result') as HTMLElement;
    host.querySelector('#tone-options')?.remove();
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `
      <div class="card" style="background:${allCorrect ? '#e8f5e9' : '#ffebee'}; border-color:${allCorrect ? '#a5d6a7' : '#ef9a9a'};">
        <div style="font-weight:600; margin-bottom:8px; color:${allCorrect ? '#2e7d32' : '#c62828'};">
          ${allCorrect ? '✓ 全部正确！' : `✗ 有误 · 正确声调：${escapeHtml(q.answers.map(id => toneDef(id).zh).join(' → '))}`}
        </div>
        <div class="tone-verdict-list">${rows}</div>
        ${q.derivation ? `
          <div style="font-size:0.85rem; color:var(--text-secondary); margin-top:8px;">
            <div style="font-weight:500; margin-bottom:4px;">推导过程：</div>
            ${q.derivation.steps.map(s => `<div style="padding:2px 0;">${escapeHtml(s)}</div>`).join('')}
            <div style="margin-top:4px; font-weight:600; color:var(--orange-500);">
              → ${escapeHtml(q.derivation.resultName)} ${escapeHtml(q.derivation.resultThai)}
            </div>
            ${q.conflict ? `
              <div class="tone-conflict-inline">
                ⚠ 词库标注「${escapeHtml(toneDef(q.answers[0]).zh)}」与规则推导「${escapeHtml(q.derivation.resultName)}」不一致，
                本题以词库标注为准，建议复核该词的标注或首辅音分类。
              </div>
            ` : ''}
          </div>
        ` : q.answers.length > 1 ? `
          <div style="font-size:0.85rem; color:var(--text-muted); margin-top:8px;">
            多音节声调来自词库标注，规则引擎只支持单音节推导。
          </div>
        ` : `
          <div style="font-size:0.85rem; color:var(--text-muted); margin-top:8px;">
            该答案来自词库标注，规则引擎暂无法推导此词。
          </div>
        `}
      </div>
      <button class="btn btn-primary btn-block" id="btn-next" style="margin-top:12px;">
        ${wordIndex < questions.length - 1 ? '下一题 →' : '查看结果'}
      </button>
    `;

    resultDiv.querySelector('#btn-next')!.addEventListener('click', () => {
      wordIndex++;
      syllableIndex = 0;
      picks = [];
      renderQuestion();
    });
  }

  function renderQuestion(): void {
    if (wordIndex >= questions.length) {
      renderResult(pageContainer, {
        correctWords,
        totalWords: questions.length,
        correctSyllables,
        totalSyllables,
      });
      return;
    }
    renderSyllable();
  }

  renderQuestion();
}

interface ToneScore {
  correctWords: number;
  totalWords: number;
  correctSyllables: number;
  totalSyllables: number;
}

function renderResult(container: HTMLElement, score: ToneScore): void {
  const wordPercent = score.totalWords > 0 ? Math.round((score.correctWords / score.totalWords) * 100) : 0;
  const content = container.querySelector('.page-content') as HTMLElement;

  content.innerHTML = `
    <div class="card" style="text-align:center; margin-top:40px;">
      <div style="font-size:3rem; margin-bottom:16px;">🍊</div>
      <div style="font-size:1.1rem; font-weight:600;">声调训练完成！</div>
      <div style="font-size:2.5rem; font-weight:700; color:var(--orange-500); margin:16px 0;">${wordPercent}%</div>
      <div style="color:var(--text-secondary);">整词全对 ${score.correctWords} / ${score.totalWords} 个词</div>
      <div style="color:var(--text-secondary); margin-top:4px;">按音节算 ${score.correctSyllables} / ${score.totalSyllables} 个音节</div>
    </div>
    <div style="margin-top:24px; display:flex; gap:12px;">
      <a href="#/more" class="btn btn-secondary" style="flex:1;">返回</a>
      <button class="btn btn-primary" style="flex:1;" onclick="window.location.hash='/tone-training'">再来一次</button>
    </div>
  `;
}
