import { createElement, escapeHtml } from '../lib/utils';
import {
  loadGrammarPoints,
  createGrammarPoint,
  updateGrammarPoint,
  deleteGrammarPoint,
  getGrammarPoint,
  normalizeGrammarPoint,
  type GrammarPoint,
  type GrammarExample,
} from '../db/grammar';
import { showSuccess, showError } from '../components/toast';

export async function renderGrammarPage(container: HTMLElement): Promise<void> {
  // Also used as the post-CRUD refresh callback, where the container still
  // holds the detail view.
  container.innerHTML = '';

  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `<h1>语法句型</h1>`;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  const points = (await loadGrammarPoints()).map(normalizeGrammarPoint);
  const userCount = points.filter(p => p.isUserCreated).length;

  content.innerHTML = `
    <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:12px;">
      共 ${points.length} 条句型，其中自建 ${userCount} 条
    </div>
    <div id="grammar-list"></div>
    <button class="fab" id="btn-add-grammar" aria-label="新增句型">＋</button>
  `;

  const list = content.querySelector('#grammar-list') as HTMLElement;

  if (points.length === 0) {
    list.innerHTML = `
      <div class="empty-state" style="margin-top:40px;">
        <span class="emoji">📐</span>
        <p>还没有语法句型</p>
        <p style="font-size:0.8rem; color:var(--text-muted); margin-top:8px;">点击右下角 ＋ 新增第一条</p>
      </div>
    `;
  } else {
    list.innerHTML = points.map((p, idx) => `
      <div class="card grammar-card" data-idx="${idx}" style="margin-bottom:12px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="width:32px; height:32px; border-radius:50%; background:var(--orange-400); color:white; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.85rem; flex-shrink:0;">
            ${idx + 1}
          </div>
          <div style="flex:1; min-width:0;">
            <div style="font-weight:600; font-size:0.95rem;">${escapeHtml(p.title)}</div>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">
              ${p.patterns.length} 个句型 · ${p.examples.length} 个例句
              ${p.isUserCreated ? '<span class="chip" style="margin-left:6px;">自建</span>' : ''}
            </div>
          </div>
          <span style="color:var(--text-muted);">›</span>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.grammar-card').forEach(card => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.getAttribute('data-idx')!);
        showGrammarDetail(container, points[idx], () => renderGrammarPage(container));
      });
    });
  }

  content.querySelector('#btn-add-grammar')!.addEventListener('click', () => {
    showGrammarFormModal(null, () => renderGrammarPage(container));
  });
}

function showGrammarDetail(
  container: HTMLElement,
  point: GrammarPoint,
  onChanged: () => void
): void {
  container.innerHTML = '';

  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `
    <button class="back-btn" id="btn-back">←</button>
    <h1>${escapeHtml(point.title)}</h1>
    <div style="display:flex; gap:4px; margin-left:auto;">
      <button class="btn btn-sm btn-outline" id="btn-edit-grammar">编辑</button>
      <button class="btn btn-sm btn-danger" id="btn-del-grammar">删除</button>
    </div>
  `;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  const practice = point.examples.filter(ex => ex.blank);

  content.innerHTML = `
    ${point.isUserCreated ? '' : '<div class="grammar-origin-tip">内置句型，编辑或删除只影响本机数据</div>'}

    <div class="card" style="margin-bottom:16px;">
      <div style="font-size:0.95rem; line-height:1.8; color:var(--text-primary);">
        ${escapeHtml(point.content)}
      </div>
    </div>

    ${point.patterns.length > 0 ? `
      <div class="section">
        <div class="section-title"><span class="emoji">📐</span> 泰语句型结构</div>
        ${point.patterns.map(p => `
          <div class="card" style="margin-bottom:8px; padding:12px 16px; background:var(--orange-50); border-color:var(--orange-200);">
            <div style="font-family:var(--font-thai); font-size:1rem; margin-bottom:4px;">${escapeHtml(p)}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${point.examples.length > 0 ? `
      <div class="section">
        <div class="section-title"><span class="emoji">💡</span> 例句</div>
        ${point.examples.map(ex => `
          <div class="card" style="margin-bottom:8px; padding:12px 16px;">
            <div style="font-family:var(--font-thai); font-size:1.05rem; font-weight:600;">${escapeHtml(ex.thai)}</div>
            ${(ex.roman ?? '').trim() ? `<div class="grammar-example-roman">${escapeHtml(ex.roman!.trim())}</div>` : ''}
            <div style="font-size:0.85rem; color:var(--text-secondary); margin-top:4px;">${escapeHtml(ex.meaning)}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${(point.note ?? '').trim() ? `
      <div class="section">
        <div class="section-title"><span class="emoji">📝</span> 补充说明</div>
        <div class="card" style="padding:12px 16px;">
          <div style="font-size:0.9rem; line-height:1.7; color:var(--text-secondary);">${escapeHtml(point.note!.trim())}</div>
        </div>
      </div>
    ` : ''}

    ${practice.length > 0 ? `
      <div class="section">
        <div class="section-title"><span class="emoji">✏️</span> 填空练习</div>
        <div id="exercise-area"></div>
      </div>
    ` : ''}
  `;

  header.querySelector('#btn-back')!.addEventListener('click', () => {
    // The list and the detail share the #/grammar route, so setting the hash
    // would fire no hashchange event.
    renderGrammarPage(container);
  });

  header.querySelector('#btn-edit-grammar')!.addEventListener('click', () => {
    showGrammarFormModal(point, async (id) => {
      const fresh = await getGrammarPoint(id);
      if (fresh) showGrammarDetail(container, fresh, onChanged);
      else onChanged();
    });
  });

  header.querySelector('#btn-del-grammar')!.addEventListener('click', async () => {
    if (!confirm(`确定删除句型「${point.title}」吗？`)) return;
    await deleteGrammarPoint(point.id!);
    showSuccess('已删除');
    onChanged();
  });

  if (practice.length > 0) {
    startGrammarExercise(content.querySelector('#exercise-area') as HTMLElement, practice);
  }
}

function exampleRowHtml(ex?: GrammarExample): string {
  const e = ex ?? { thai: '', meaning: '', roman: '', blank: '' };
  return `
    <div class="grammar-example-edit">
      <div class="input-group">
        <label class="input-label">泰语例句</label>
        <input class="input ge-thai" style="font-family:var(--font-thai);" placeholder="如：ฉันกินข้าว" value="${escapeHtml(e.thai)}" />
      </div>
      <div class="input-group">
        <label class="input-label">罗马音</label>
        <input class="input ge-roman" placeholder="如：chǎn gin kâao" value="${escapeHtml(e.roman ?? '')}" />
      </div>
      <div class="input-group">
        <label class="input-label">中文翻译</label>
        <input class="input ge-meaning" placeholder="如：我吃饭" value="${escapeHtml(e.meaning)}" />
      </div>
      <div class="input-group">
        <label class="input-label">填空形式（可选，留空则不参与填空练习）</label>
        <input class="input ge-blank" style="font-family:var(--font-thai);" placeholder="如：ฉัน___ข้าว" value="${escapeHtml(e.blank ?? '')}" />
      </div>
      <button class="btn btn-sm btn-danger ge-remove">删除该例句</button>
    </div>
  `;
}

function showGrammarFormModal(existing: GrammarPoint | null, onSaved: (id: number) => void): void {
  const isEdit = !!existing?.id;
  const point = existing;

  const overlay = createElement('div', { className: 'modal-overlay' });
  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>${isEdit ? '编辑句型' : '新增句型'}</h2>
        <button class="modal-close">&times;</button>
      </div>

      <div class="input-group">
        <label class="input-label">语法名称 *</label>
        <input class="input" id="g-title" placeholder="如：了 — แล้ว (lɛ́ɛo)" value="${escapeHtml(point?.title ?? '')}" />
      </div>

      <div class="input-group">
        <label class="input-label">中文解释 *</label>
        <textarea class="textarea" id="g-content" rows="3" placeholder="用中文说明这个句型的用法">${escapeHtml(point?.content ?? '')}</textarea>
      </div>

      <div class="input-group">
        <label class="input-label">泰语句型结构（每行一条）</label>
        <textarea class="textarea" id="g-patterns" rows="3" style="font-family:var(--font-thai);" placeholder="ฉัน กิน ข้าว (我 吃 饭)">${escapeHtml((point?.patterns ?? []).join('\n'))}</textarea>
      </div>

      <div class="divider"></div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <label class="input-label" style="margin:0;">例句</label>
        <button class="btn btn-sm btn-secondary" id="btn-add-example">+ 添加例句</button>
      </div>
      <div id="examples-wrap">${(point?.examples?.length ? point.examples : [undefined]).map(e => exampleRowHtml(e)).join('')}</div>

      <div class="input-group" style="margin-top:16px;">
        <label class="input-label">补充说明</label>
        <textarea class="textarea" id="g-note" rows="2" placeholder="易错点、口语用法、与中文的差异等">${escapeHtml(point?.note ?? '')}</textarea>
      </div>

      <button class="btn btn-primary btn-block" id="btn-save-grammar">${isEdit ? '保存修改' : '新增句型'}</button>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('.modal-close')!.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const wrap = overlay.querySelector('#examples-wrap') as HTMLElement;

  wrap.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('.ge-remove');
    if (btn) btn.closest('.grammar-example-edit')!.remove();
  });

  overlay.querySelector('#btn-add-example')!.addEventListener('click', () => {
    wrap.insertAdjacentHTML('beforeend', exampleRowHtml());
  });

  overlay.querySelector('#btn-save-grammar')!.addEventListener('click', async () => {
    const title = (overlay.querySelector('#g-title') as HTMLInputElement).value.trim();
    const content = (overlay.querySelector('#g-content') as HTMLTextAreaElement).value.trim();

    if (!title || !content) {
      showError('语法名称和中文解释不能为空');
      return;
    }

    const patterns = (overlay.querySelector('#g-patterns') as HTMLTextAreaElement).value
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);

    const examples: GrammarExample[] = [];
    wrap.querySelectorAll('.grammar-example-edit').forEach(block => {
      const thai = (block.querySelector('.ge-thai') as HTMLInputElement).value.trim();
      const meaning = (block.querySelector('.ge-meaning') as HTMLInputElement).value.trim();
      if (!thai || !meaning) return;
      const roman = (block.querySelector('.ge-roman') as HTMLInputElement).value.trim();
      const blank = (block.querySelector('.ge-blank') as HTMLInputElement).value.trim();
      examples.push(blank ? { thai, meaning, roman, blank } : { thai, meaning, roman });
    });

    const note = (overlay.querySelector('#g-note') as HTMLTextAreaElement).value.trim();
    const payload = { title, content, patterns, examples, note };

    let savedId: number;
    if (isEdit) {
      savedId = existing!.id!;
      await updateGrammarPoint(savedId, payload);
      showSuccess('句型已更新');
    } else {
      savedId = await createGrammarPoint(payload);
      showSuccess('句型已新增');
    }

    overlay.remove();
    onSaved(savedId);
  });
}

function startGrammarExercise(
  container: HTMLElement,
  examples: GrammarExample[]
): void {
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

    container.innerHTML = `
      <div class="card" style="margin-bottom:12px;">
        <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:4px;">第 ${currentIdx + 1} / ${examples.length} 题</div>
        <div style="font-family:var(--font-thai); font-size:1.3rem; font-weight:600; margin-bottom:8px;">${escapeHtml(ex.blank ?? ex.thai)}</div>
        <div style="font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(ex.meaning)}</div>
        ${(ex.roman ?? '').trim() ? `<div class="grammar-example-roman">${escapeHtml(ex.roman!.trim())}</div>` : ''}
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
      const isCorrect = input.value.trim() === ex.thai;

      result.style.display = 'block';
      result.innerHTML = `
        <div class="card" style="background:${isCorrect ? '#e8f5e9' : '#ffebee'}; border-color:${isCorrect ? '#a5d6a7' : '#ef9a9a'};">
          <div style="font-weight:600; color:${isCorrect ? '#2e7d32' : '#c62828'};">
            ${isCorrect ? '✓ 正确！' : '✗ 答案不正确'}
          </div>
          <div style="font-family:var(--font-thai); margin-top:8px; font-size:1.1rem;">${escapeHtml(ex.thai)}</div>
          ${(ex.roman ?? '').trim() ? `<div class="grammar-example-roman">${escapeHtml(ex.roman!.trim())}</div>` : ''}
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
