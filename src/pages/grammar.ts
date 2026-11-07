import { createElement, escapeHtml } from '../lib/utils';
import { db, type GrammarPoint } from '../db/index';
import { showSuccess, showError } from '../components/toast';

export async function renderGrammarPage(container: HTMLElement): Promise<void> {
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `
    <button class="back-btn" onclick="window.location.hash='/more'">←</button>
    <h1>📖 语法句型</h1>
  `;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  let points = await db.grammarPoints.orderBy('order').toArray();

  if (points.length === 0) {
    const resp = await fetch('/data/grammar-points.json');
    const data = await resp.json();
    for (let i = 0; i < data.points.length; i++) {
      const p = data.points[i];
      const point: GrammarPoint = {
        title: p.title,
        content: p.content,
        patterns: p.patterns,
        examples: p.examples,
        order: i,
      };
      await db.grammarPoints.add(point);
    }
    points = await db.grammarPoints.orderBy('order').toArray();
  }

  content.innerHTML = `
    <div id="grammar-list"></div>
  `;

  const list = content.querySelector('#grammar-list') as HTMLElement;

  list.innerHTML = points.map((p, idx) => `
    <div class="card grammar-card" data-idx="${idx}" style="margin-bottom:12px; cursor:pointer;">
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="width:32px; height:32px; border-radius:50%; background:var(--orange-400); color:white; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.85rem; flex-shrink:0;">
          ${idx + 1}
        </div>
        <div style="flex:1;">
          <div style="font-weight:600; font-size:0.95rem;">${escapeHtml(p.title)}</div>
        </div>
        <span style="color:var(--text-muted);">›</span>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.grammar-card').forEach(card => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.getAttribute('data-idx')!);
      showGrammarDetail(container, points[idx]);
    });
  });
}

function showGrammarDetail(container: HTMLElement, point: GrammarPoint): void {
  container.innerHTML = '';

  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `
    <button class="back-btn" id="btn-back">←</button>
    <h1>${escapeHtml(point.title)}</h1>
  `;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  content.innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div style="font-size:0.95rem; line-height:1.8; color:var(--text-primary);">
        ${escapeHtml(point.content)}
      </div>
    </div>

    ${point.patterns.length > 0 ? `
      <div class="section">
        <div class="section-title"><span class="emoji">📐</span> 句型</div>
        ${point.patterns.map(p => `
          <div class="card" style="margin-bottom:8px; padding:12px 16px; background:var(--orange-50); border-color:var(--orange-200);">
            <div style="font-family:var(--font-thai); font-size:1rem; margin-bottom:4px;">${escapeHtml(p)}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${point.examples.length > 0 ? `
      <div class="section">
        <div class="section-title"><span class="emoji">💡</span> 例句练习</div>
        <div id="exercise-area"></div>
      </div>
    ` : ''}
  `;

  header.querySelector('#btn-back')!.addEventListener('click', () => {
    window.location.hash = '/grammar';
  });

  if (point.examples.length > 0) {
    startGrammarExercise(content.querySelector('#exercise-area') as HTMLElement, point.examples);
  }
}

function startGrammarExercise(container: HTMLElement, examples: { thai: string; meaning: string; blank?: string }[]): void {
  let currentIdx = 0;
  let correct = 0;

  function renderExercise() {
    if (currentIdx >= examples.length) {
      container.innerHTML = `
        <div class="card" style="text-align:center; padding:24px;">
          <div style="font-size:2rem; margin-bottom:8px;">🎉</div>
          <div style="font-weight:600;">练习完成！</div>
          <div style="font-size:1.5rem; font-weight:700; color:var(--orange-500); margin:8px 0;">
            ${correct} / ${examples.length}
          </div>
          <button class="btn btn-primary btn-sm" id="btn-retry" style="margin-top:12px;">再来一次</button>
        </div>
      `;
      container.querySelector('#btn-retry')!.addEventListener('click', () => {
        currentIdx = 0;
        correct = 0;
        renderExercise();
      });
      return;
    }

    const ex = examples[currentIdx];
    const blank = ex.blank || ex.thai;

    container.innerHTML = `
      <div class="card" style="margin-bottom:12px;">
        <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:4px;">第 ${currentIdx + 1} / ${examples.length} 题</div>
        <div style="font-family:var(--font-thai); font-size:1.3rem; font-weight:600; margin-bottom:8px;">${escapeHtml(blank)}</div>
        <div style="font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(ex.meaning)}</div>
      </div>
      <div class="input-group">
        <input class="input" id="answer-input" placeholder="填写完整句子..." style="font-family:var(--font-thai);" />
      </div>
      <button class="btn btn-primary btn-block" id="btn-check">检查答案</button>
      <div id="answer-result" style="margin-top:12px; display:none;"></div>
    `;

    const input = container.querySelector('#answer-input') as HTMLInputElement;
    const result = container.querySelector('#answer-result') as HTMLElement;

    container.querySelector('#btn-check')!.addEventListener('click', () => {
      const answer = input.value.trim();
      const isCorrect = answer === ex.thai;

      result.style.display = 'block';
      result.innerHTML = `
        <div class="card" style="background:${isCorrect ? '#e8f5e9' : '#ffebee'}; border-color:${isCorrect ? '#a5d6a7' : '#ef9a9a'};">
          <div style="font-weight:600; color:${isCorrect ? '#2e7d32' : '#c62828'};">
            ${isCorrect ? '✓ 正确！' : '✗ 答案不正确'}
          </div>
          <div style="font-family:var(--font-thai); margin-top:8px; font-size:1.1rem;">${escapeHtml(ex.thai)}</div>
        </div>
        <button class="btn btn-primary btn-block" id="btn-next" style="margin-top:8px;">
          ${currentIdx < examples.length - 1 ? '下一题 →' : '查看结果'}
        </button>
      `;

      if (isCorrect) correct++;

      result.querySelector('#btn-next')!.addEventListener('click', () => {
        currentIdx++;
        renderExercise();
      });
    });

    input.focus();
  }

  renderExercise();
}
