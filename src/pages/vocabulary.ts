import { createElement, escapeHtml } from '../lib/utils';
import { getAllWords, addWord, deleteWord, updateWord, searchWords, parseCSV, importWords, exportWordsToCSV, downloadCSV, type CSVSkip } from '../db/vocabulary';
import { initNewWordReview } from '../db/review';
import { showSuccess, showError } from '../components/toast';
import { showWordDetail } from '../components/word-detail';
import { TONES, normalizeToneId } from '../lib/tones';
import type { Word } from '../db/index';

export async function renderVocabularyPage(container: HTMLElement): Promise<void> {
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `<h1>词库管理</h1>`;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  content.innerHTML = `
    <div class="search-bar">
      <span class="search-icon">🔍</span>
      <input type="text" id="vocab-search" placeholder="搜索泰文、中文、标签..." />
    </div>

    <div style="display:flex; gap:8px; margin-bottom:16px;">
      <button class="btn btn-primary btn-sm" id="btn-add-word" style="flex:1">+ 添加单词</button>
      <button class="btn btn-secondary btn-sm" id="btn-import-csv" style="flex:1">📋 批量导入</button>
      <button class="btn btn-outline btn-sm" id="btn-export-csv">⬇️</button>
    </div>

    <div id="word-list"></div>
  `;

  const wordListEl = content.querySelector('#word-list') as HTMLElement;
  const searchInput = content.querySelector('#vocab-search') as HTMLInputElement;

  async function loadWords(query?: string) {
    const words = query ? await searchWords(query) : await getAllWords();
    renderWordList(wordListEl, words, () => loadWords(searchInput.value.trim()));
  }

  let searchTimer: ReturnType<typeof setTimeout>;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadWords(searchInput.value.trim()), 300);
  });

  content.querySelector('#btn-add-word')!.addEventListener('click', () => showWordFormModal(null, () => loadWords(searchInput.value.trim())));
  content.querySelector('#btn-import-csv')!.addEventListener('click', () => showImportModal(loadWords));
  content.querySelector('#btn-export-csv')!.addEventListener('click', async () => {
    const words = await getAllWords();
    if (words.length === 0) {
      showError('词库为空');
      return;
    }
    const csv = exportWordsToCSV(words);
    downloadCSV(csv, `thai-vocab-${new Date().toISOString().slice(0, 10)}.csv`);
    showSuccess('导出成功');
  });

  await loadWords();
}

function renderWordList(container: HTMLElement, words: Word[], onRefresh: () => void): void {
  if (words.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="emoji">🍊</span>
        <p>还没有单词</p>
        <p style="font-size:0.8rem; margin-top:8px;">点击"添加单词"或"批量导入"开始学习吧</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  for (const word of words) {
    const item = createElement('div', { className: 'card word-card', style: 'margin-bottom:8px; padding:12px 16px;' });
    const tone = normalizeToneId(word.toneMark);
    item.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <div style="flex:1; min-width:0;">
          <div style="font-family:var(--font-thai); font-size:1.3rem; font-weight:500;">${escapeHtml(word.thai)}</div>
          ${(word.romanization ?? '').trim() ? `<div class="word-card-roman">${escapeHtml(word.romanization!.trim())}</div>` : ''}
          <div style="font-size:0.85rem; color:var(--text-secondary); margin-top:2px;">${escapeHtml(word.meaning)}</div>
          <div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:4px;">
            ${tone ? `<span class="tag tag-tone">${escapeHtml(TONES.find(t => t.id === tone)!.zh)}</span>` : ''}
            ${word.pos ? `<span class="tag">${escapeHtml(word.pos)}</span>` : ''}
          </div>
        </div>
        <button class="btn btn-icon word-del-btn" data-id="${word.id}" title="删除" style="color:var(--red-400); font-size:1.2rem;">✕</button>
      </div>
    `;

    item.addEventListener('click', () => {
      showWordDetail(word, { onEdit: w => showWordFormModal(w, onRefresh) });
    });

    item.querySelector('.word-del-btn')!.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`确定删除 "${word.thai}" 吗？`)) {
        await deleteWord(word.id!);
        item.remove();
        showSuccess('已删除');
      }
    });

    container.appendChild(item);
  }
}

export function showWordFormModal(existing: Word | null, onSaved: () => void): void {
  const isEdit = !!existing?.id;
  const currentTone = normalizeToneId(existing?.toneMark) ?? '';

  const overlay = createElement('div', { className: 'modal-overlay' });
  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>${isEdit ? '编辑单词' : '添加单词'}</h2>
        <button class="modal-close">&times;</button>
      </div>
      <div class="input-group">
        <label class="input-label">泰文 *</label>
        <input class="input" id="new-thai" style="font-family:var(--font-thai); font-size:1.15rem;" placeholder="如：สวัสดี" value="${escapeHtml(existing?.thai ?? '')}" />
      </div>
      <div class="input-group">
        <label class="input-label">中文释义 *</label>
        <input class="input" id="new-meaning" placeholder="如：你好" value="${escapeHtml(existing?.meaning ?? '')}" />
      </div>
      <div class="input-group">
        <label class="input-label">罗马音</label>
        <input class="input" id="new-roman" placeholder="如：sà-wàt-dii" value="${escapeHtml(existing?.romanization ?? '')}" />
        <div class="field-hint">按项目统一转写方案填写，留空则详情页显示未填写</div>
      </div>
      <div class="input-group">
        <label class="input-label">声调</label>
        <select class="select" id="new-tone">
          <option value="">未标注</option>
          ${TONES.map(t => `
            <option value="${t.id}" ${t.id === currentTone ? 'selected' : ''}>${t.num}. ${t.zh} · ${t.thai} (${t.en})</option>
          `).join('')}
        </select>
      </div>
      <div class="input-group">
        <label class="input-label">词性</label>
        <input class="input" id="new-pos" placeholder="如：名词、动词" value="${escapeHtml(existing?.pos ?? '')}" />
      </div>
      <div class="input-group">
        <label class="input-label">泰语例句</label>
        <textarea class="textarea" id="new-example" placeholder="泰文例句">${escapeHtml(existing?.example ?? '')}</textarea>
      </div>
      <div class="input-group">
        <label class="input-label">例句罗马音</label>
        <input class="input" id="new-example-roman" placeholder="如：gin kâao" value="${escapeHtml(existing?.exampleRoman ?? '')}" />
      </div>
      <div class="input-group">
        <label class="input-label">例句中文翻译</label>
        <input class="input" id="new-example-meaning" placeholder="如：吃饭" value="${escapeHtml(existing?.exampleMeaning ?? '')}" />
      </div>
      <div class="input-group">
        <label class="input-label">备注</label>
        <input class="input" id="new-note" placeholder="易混淆、记忆技巧等" value="${escapeHtml(existing?.note ?? '')}" />
      </div>
      <div class="input-group">
        <label class="input-label">标签（用分号分隔）</label>
        <input class="input" id="new-tags" placeholder="如：日常;问候" value="${escapeHtml((existing?.tags ?? []).join(';'))}" />
      </div>
      <button class="btn btn-primary btn-block" id="btn-save-word">${isEdit ? '保存修改' : '保存'}</button>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('.modal-close')!.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#btn-save-word')!.addEventListener('click', async () => {
    const thai = (overlay.querySelector('#new-thai') as HTMLInputElement).value.trim();
    const meaning = (overlay.querySelector('#new-meaning') as HTMLInputElement).value.trim();

    if (!thai || !meaning) {
      showError('泰文和中文释义不能为空');
      return;
    }

    const tagsStr = (overlay.querySelector('#new-tags') as HTMLInputElement).value.trim();
    const tags = tagsStr ? tagsStr.split(/[;；|]/).map(t => t.trim()).filter(Boolean) : [];

    const wordData = {
      thai,
      meaning,
      toneMark: (overlay.querySelector('#new-tone') as HTMLSelectElement).value,
      romanization: (overlay.querySelector('#new-roman') as HTMLInputElement).value.trim(),
      pos: (overlay.querySelector('#new-pos') as HTMLInputElement).value.trim(),
      example: (overlay.querySelector('#new-example') as HTMLTextAreaElement).value.trim(),
      exampleRoman: (overlay.querySelector('#new-example-roman') as HTMLInputElement).value.trim(),
      exampleMeaning: (overlay.querySelector('#new-example-meaning') as HTMLInputElement).value.trim(),
      note: (overlay.querySelector('#new-note') as HTMLInputElement).value.trim(),
      tags,
    };

    if (isEdit) {
      await updateWord(existing!.id!, wordData);
      showSuccess('已保存修改');
    } else {
      const id = await addWord({ ...wordData, groupId: undefined });
      await initNewWordReview(id);
      showSuccess('添加成功');
    }

    overlay.remove();
    onSaved();
  });
}

export function showImportModal(onSaved?: () => void): void {
  const overlay = createElement('div', { className: 'modal-overlay' });
  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>批量导入 CSV</h2>
        <button class="modal-close">&times;</button>
      </div>
      <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:12px; line-height:1.7;">
        列顺序：<code>泰文,中文,声调,词性,例句,备注,标签,罗马音,例句罗马音,例句中文</code><br>
        最少两列：<code>泰文,中文</code>；分隔符可用逗号或 Tab。<br>
        有表头时按字段名对应，列顺序可调整；表头行只识别、不导入。<br>
        字段内本身含逗号或换行时，用双引号包裹（导出文件即此格式），内部双引号写成 <code>""</code>。<br>
        声调填 mid / low / falling / high / rising（旧中文标签也兼容），留空表示未标注。
      </p>
      <div class="input-group">
        <textarea class="textarea" id="csv-input" rows="8" style="font-family:var(--font-thai);" placeholder="สวัสดี,你好,mid,感叹词,,,日常;问候,sà-wàt-dii,,你好
กิน,吃,mid,动词,กินข้าว,,日常;食物,gin,gin kâao,吃饭"></textarea>
      </div>
      <div id="csv-preview" style="margin-bottom:12px;"></div>
      <button class="btn btn-secondary btn-block" id="btn-preview-csv" style="margin-bottom:8px;">预览</button>
      <button class="btn btn-primary btn-block" id="btn-do-import">确认导入</button>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('.modal-close')!.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  // 异常行只上报，不写入：预览和确认导入都走同一份 parseCSV 结果。
  const skipNotice = (skipped: CSVSkip[]) => {
    if (skipped.length === 0) return '';
    const detail = skipped.map(s => `
          <div style="padding:6px 0; border-bottom:1px solid var(--border-light);">
            <div style="color:var(--text-secondary);">第 ${s.line} 行 · ${escapeHtml(s.reason)}</div>
            <div style="font-family:var(--font-thai); color:var(--text-muted); word-break:break-all; margin-top:2px;">${escapeHtml(s.raw)}</div>
          </div>`).join('');
    return `
      <details style="font-size:0.8rem; margin-top:8px;">
        <summary style="color:var(--red-400); cursor:pointer;">已跳过 ${skipped.length} 行异常数据，点击展开全部明细</summary>
        <div style="max-height:160px; overflow-y:auto; border:1px solid var(--border-light); border-radius:8px; padding:2px 8px; margin-top:4px;">${detail}</div>
      </details>`;
  };

  const previewWords = (
    words: { thai: string; meaning: string }[],
    skipped: CSVSkip[],
  ) => `
      <div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:8px;">
        解析到 ${words.length} 个单词：
      </div>
      <div style="max-height:200px; overflow-y:auto; border:1px solid var(--border-light); border-radius:8px; padding:8px;">
        ${words.slice(0, 10).map(w => `
          <div style="padding:4px 0; border-bottom:1px solid var(--border-light);">
            <span style="font-family:var(--font-thai); font-weight:600;">${escapeHtml(w.thai)}</span>
            <span style="color:var(--text-muted); margin-left:8px;">${escapeHtml(w.meaning)}</span>
          </div>
        `).join('')}
        ${words.length > 10 ? `<div style="padding:4px 0; color:var(--text-muted); font-size:0.8rem;">...还有 ${words.length - 10} 个</div>` : ''}
      </div>${skipNotice(skipped)}
    `;

  overlay.querySelector('#btn-preview-csv')!.addEventListener('click', () => {
    const text = (overlay.querySelector('#csv-input') as HTMLTextAreaElement).value;
    const { words, skipped } = parseCSV(text);
    const preview = overlay.querySelector('#csv-preview') as HTMLElement;

    if (words.length === 0) {
      preview.innerHTML = `<p style="color:var(--red-400); font-size:0.85rem;">未解析到有效数据</p>${skipNotice(skipped)}`;
      return;
    }

    preview.innerHTML = previewWords(words, skipped);
  });

  overlay.querySelector('#btn-do-import')!.addEventListener('click', async () => {
    const text = (overlay.querySelector('#csv-input') as HTMLTextAreaElement).value;
    const { words, skipped } = parseCSV(text);

    if (words.length === 0) {
      showError(skipped.length > 0 ? `未解析到有效数据，${skipped.length} 行异常数据已跳过` : '未解析到有效数据');
      return;
    }

    const result = await importWords(words);

    for (const id of result.ids) {
      await initNewWordReview(id);
    }

    overlay.remove();
    showSuccess(`导入成功 ${result.imported} 个${result.duplicates > 0 ? `，跳过重复 ${result.duplicates} 个` : ''}${skipped.length > 0 ? `，${skipped.length} 行异常数据未导入` : ''}`);
    onSaved?.();
  });
}
