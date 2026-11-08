import { createElement, escapeHtml, shuffleArray } from '../lib/utils';
import { showSuccess, showError } from '../components/toast';

interface SpellingRule {
  written?: string;
  pronounced?: string;
  pattern?: string;
  pronunciation?: string;
  description?: string;
  effect?: string;
  examples?: { word: string; reading: string; meaning: string; detail?: string }[];
}

interface SpellingData {
  silentLetters?: { rules: SpellingRule[] };
  finalConsonantConversion?: { rules: SpellingRule[] };
  initialConsonantClusters?: { rules: SpellingRule[] };
  leadingHo?: { rules: SpellingRule[] };
}

let spellingData: SpellingData | null = null;

async function loadSpellingData(): Promise<SpellingData> {
  if (!spellingData) {
    const resp = await fetch('/data/spelling-rules.json');
    spellingData = await resp.json();
  }
  return spellingData!;
}

export async function renderSpellingPage(container: HTMLElement): Promise<void> {
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `
    <button class="back-btn" onclick="window.location.hash='/more'">←</button>
    <h1>拼写读音对照</h1>
  `;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  const data = await loadSpellingData();

  content.innerHTML = `
    <div class="tabs" id="spelling-tabs">
      <button class="tab active" data-tab="finals">尾辅音转换</button>
      <button class="tab" data-tab="silent">不发音字母</button>
      <button class="tab" data-tab="clusters">辅音连缀</button>
    </div>

    <div id="spelling-content"></div>

    <div style="margin-top:24px;">
      <button class="btn btn-primary btn-block" id="btn-quiz">开始测验</button>
    </div>
  `;

  const spellingContent = content.querySelector('#spelling-content') as HTMLElement;

  function renderFinals() {
    const rules = data.finalConsonantConversion?.rules || [];
    spellingContent.innerHTML = rules.map(rule => `
      <div class="card" style="margin-bottom:8px;">
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
          <span style="font-family:var(--font-thai); font-size:1.5rem; font-weight:700; color:var(--orange-500);">${rule.written}</span>
          <span style="font-size:1.2rem;">→</span>
          <span style="font-size:1.2rem; font-weight:600; color:var(--green-600);">/${rule.pronounced}/</span>
        </div>
        <div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:8px;">${escapeHtml(rule.description || '')}</div>
        ${(rule.examples || []).map(ex => `
          <div style="display:flex; align-items:center; gap:8px; padding:4px 0; font-size:0.85rem;">
            <span style="font-family:var(--font-thai); font-weight:500;">${escapeHtml(ex.word)}</span>
            <span style="color:var(--text-muted);">[${escapeHtml(ex.reading)}]</span>
            <span style="color:var(--text-secondary);">${escapeHtml(ex.meaning)}</span>
          </div>
        `).join('')}
      </div>
    `).join('');
  }

  function renderSilent() {
    const rules = data.silentLetters?.rules || [];
    spellingContent.innerHTML = rules.map(rule => `
      <div class="card" style="margin-bottom:8px;">
        <div style="font-weight:600; margin-bottom:8px;">${escapeHtml(rule.pattern || '')}</div>
        <div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:8px;">发音：${escapeHtml(rule.pronunciation || '')}</div>
        ${(rule.examples || []).map(ex => `
          <div style="display:flex; align-items:center; gap:8px; padding:4px 0; font-size:0.85rem;">
            <span style="font-family:var(--font-thai); font-weight:500;">${escapeHtml(ex.word)}</span>
            <span style="color:var(--text-muted);">[${escapeHtml(ex.reading)}]</span>
            <span style="color:var(--text-secondary);">${escapeHtml(ex.meaning)}</span>
          </div>
        `).join('')}
      </div>
    `).join('');
  }

  function renderClusters() {
    const rules = data.initialConsonantClusters?.rules || [];
    spellingContent.innerHTML = rules.map(rule => `
      <div class="card" style="margin-bottom:8px;">
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
          <span style="font-family:var(--font-thai); font-size:1.3rem; font-weight:700; color:var(--orange-500);">${rule.pattern}</span>
          <span style="font-size:0.85rem; color:var(--text-muted);">→ /${rule.pronunciation}/</span>
        </div>
        ${(rule.examples || []).map(ex => `
          <div style="display:flex; align-items:center; gap:8px; padding:4px 0; font-size:0.85rem;">
            <span style="font-family:var(--font-thai); font-weight:500;">${escapeHtml(ex.word)}</span>
            <span style="color:var(--text-muted);">[${escapeHtml(ex.reading)}]</span>
            <span style="color:var(--text-secondary);">${escapeHtml(ex.meaning)}</span>
          </div>
        `).join('')}
      </div>
    `).join('');
  }

  content.querySelectorAll('#spelling-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      content.querySelectorAll('#spelling-tabs .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const tabName = tab.getAttribute('data-tab');
      if (tabName === 'finals') renderFinals();
      else if (tabName === 'silent') renderSilent();
      else renderClusters();
    });
  });

  renderFinals();

  content.querySelector('#btn-quiz')!.addEventListener('click', () => {
    startSpellingQuiz(content, data);
  });
}

function startSpellingQuiz(content: HTMLElement, data: SpellingData) {
  const questions: { written: string; pronounced: string; word: string; meaning: string }[] = [];

  for (const rule of data.finalConsonantConversion?.rules || []) {
    if (rule.written && rule.pronounced && rule.examples) {
      for (const ex of rule.examples) {
        questions.push({
          written: rule.written,
          pronounced: rule.pronounced,
          word: ex.word,
          meaning: ex.meaning,
        });
      }
    }
  }

  const shuffled = shuffleArray(questions).slice(0, Math.min(10, questions.length));
  let currentQ = 0;
  let correct = 0;

  function renderQuizQuestion() {
    if (currentQ >= shuffled.length) {
      content.innerHTML = `
        <div class="card" style="text-align:center; margin-top:40px;">
          <div style="font-size:3rem; margin-bottom:16px;">📝</div>
          <div style="font-size:1.1rem; font-weight:600;">测验完成！</div>
          <div style="font-size:2.5rem; font-weight:700; color:var(--orange-500); margin:16px 0;">
            ${Math.round((correct / shuffled.length) * 100)}%
          </div>
          <div style="color:var(--text-secondary);">答对 ${correct} / ${shuffled.length}</div>
        </div>
        <div style="margin-top:24px;">
          <a href="#/more" class="btn btn-secondary btn-block" style="margin-bottom:8px;">返回</a>
          <button class="btn btn-primary btn-block" onclick="window.location.hash='/spelling'">再来一次</button>
        </div>
      `;
      return;
    }

    const q = shuffled[currentQ];
    const options = shuffleArray([
      { label: q.pronounced, correct: true },
      ...generateWrongOptions(q.pronounced, data).map(p => ({ label: p, correct: false })),
    ]);

    content.innerHTML = `
      <div class="progress-bar" style="margin-bottom:20px;">
        <div class="progress-fill" style="width:${(currentQ / shuffled.length) * 100}%"></div>
      </div>
      <div style="text-align:center; margin-bottom:8px; font-size:0.85rem; color:var(--text-muted);">
        ${currentQ + 1} / ${shuffled.length}
      </div>

      <div class="card" style="text-align:center; padding:24px 16px; margin-bottom:20px;">
        <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:8px;">这个词中，尾辅音的实际发音是？</div>
        <div style="font-family:var(--font-thai); font-size:2rem; font-weight:700; margin-bottom:8px;">${escapeHtml(q.word)}</div>
        <div style="font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(q.meaning)}</div>
      </div>

      <div class="quiz-options" id="quiz-options">
        ${options.map((opt, i) => `
          <button class="quiz-option" data-idx="${i}" data-correct="${opt.correct}">
            <span style="font-family:var(--font-thai); font-size:1.1rem;">/${escapeHtml(opt.label)}/</span>
          </button>
        `).join('')}
      </div>
    `;

    content.querySelectorAll('.quiz-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const isCorrect = btn.getAttribute('data-correct') === 'true';

        content.querySelectorAll('.quiz-option').forEach(b => {
          (b as HTMLElement).style.pointerEvents = 'none';
          if (b.getAttribute('data-correct') === 'true') b.classList.add('correct');
        });

        if (!isCorrect) {
          btn.classList.add('wrong');
        } else {
          correct++;
        }

        setTimeout(() => {
          currentQ++;
          renderQuizQuestion();
        }, 1200);
      });
    });
  }

  renderQuizQuestion();
}

function generateWrongOptions(correct: string, data: SpellingData): string[] {
  const all = new Set<string>();
  for (const rule of data.finalConsonantConversion?.rules || []) {
    if (rule.pronounced) all.add(rule.pronounced);
  }
  all.delete(correct);
  return shuffleArray(Array.from(all)).slice(0, 3);
}
