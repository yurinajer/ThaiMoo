import { createElement, escapeHtml } from '../lib/utils';
import { getAllWords, addWord, deleteWord, updateWord, searchWords, parseCSV, importWords, exportWordsToCSV, downloadCSV } from '../db/vocabulary';
import { initNewWordReview } from '../db/review';
import { showSuccess, showError } from '../components/toast';
import type { Word } from '../db/index';

export async function renderVocabularyPage(container: HTMLElement): Promise<void> {
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `<h1>📚 词库管理</h1>`;
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
    renderWordList(wordListEl, words);
  }

  let searchTimer: ReturnType<typeof setTimeout>;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadWords(searchInput.value.trim()), 300);
  });

  content.querySelector('#btn-add-word')!.addEventListener('click', () => showAddWordModal(loadWords));
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

function renderWordList(container: HTMLElement, words: Word[]): void {
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
    const item = createElement('div', { className: 'card', style: 'margin-bottom:8px; padding:12px 16px;' });
    item.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <div style="flex:1; min-width:0;">
          <div style="font-family:var(--font-thai); font-size:1.3rem; font-weight:600;">${escapeHtml(word.thai)}</div>
          <div style="font-size:0.85rem; color:var(--text-secondary); margin-top:2px;">${escapeHtml(word.meaning)}</div>
          ${word.toneMark ? `<span class="tag tag-tone" style="margin-top:4px;">${escapeHtml(word.toneMark)}</span>` : ''}
          ${word.pos ? `<span class="tag" style="margin-top:4px; margin-left:4px;">${escapeHtml(word.pos)}</span>` : ''}
        </div>
        <button class="btn btn-icon" data-id="${word.id}" title="删除" style="color:var(--red-400); font-size:1.2rem;">✕</button>
      </div>
    `;

    item.querySelector('button')!.addEventListener('click', async (e) => {
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

function showAddWordModal(onSaved: () => void): void {
  const overlay = createElement('div', { className: 'modal-overlay' });
  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>添加单词</h2>
        <button class="modal-close">&times;</button>
      </div>
      <div class="input-group">
        <label class="input-label">泰文 *</label>
        <input class="input" id="new-thai" placeholder="如：สวัสดี" />
      </div>
      <div class="input-group">
        <label class="input-label">中文释义 *</label>
        <input class="input" id="new-meaning" placeholder="如：你好" />
      </div>
      <div class="input-group">
        <label class="input-label">声调标注</label>
        <select class="select" id="new-tone">
          <option value="">无</option>
          <option value="中平">中平</option>
          <option value="低平">低平</option>
          <option value="降调">降调</option>
          <option value="高升">高升</option>
          <option value="低升">低升</option>
        </select>
      </div>
      <div class="input-group">
        <label class="input-label">词性</label>
        <input class="input" id="new-pos" placeholder="如：名词、动词" />
      </div>
      <div class="input-group">
        <label class="input-label">例句</label>
        <textarea class="textarea" id="new-example" placeholder="泰文例句"></textarea>
      </div>
      <div class="input-group">
        <label class="input-label">备注</label>
        <input class="input" id="new-note" placeholder="易混淆、记忆技巧等" />
      </div>
      <div class="input-group">
        <label class="input-label">标签（用分号分隔）</label>
        <input class="input" id="new-tags" placeholder="如：日常;问候" />
      </div>
      <button class="btn btn-primary btn-block" id="btn-save-word">保存</button>
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
    const tags = tagsStr ? tagsStr.split(/[;；]/).map(t => t.trim()).filter(Boolean) : [];

    const wordData = {
      thai,
      meaning,
      toneMark: (overlay.querySelector('#new-tone') as HTMLSelectElement).value,
      pos: (overlay.querySelector('#new-pos') as HTMLInputElement).value.trim(),
      example: (overlay.querySelector('#new-example') as HTMLTextAreaElement).value.trim(),
      note: (overlay.querySelector('#new-note') as HTMLInputElement).value.trim(),
      tags,
      groupId: undefined,
    };

    const id = await addWord(wordData);
    await initNewWordReview(id);
    overlay.remove();
    showSuccess('添加成功');
    onSaved();
  });
}

function showImportModal(onSaved: () => void): void {
  const overlay = createElement('div', { className: 'modal-overlay' });
  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>批量导入 CSV</h2>
        <button class="modal-close">&times;</button>
      </div>
      <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:12px;">
        每行一个单词，格式：泰文,中文,声调,词性,例句,备注,标签<br>
        至少需要：泰文,中文
      </p>
      <div class="input-group">
        <textarea class="textarea" id="csv-input" rows="8" placeholder="สวัสดี,你好,中平,感叹词,,问候语,日常;问候
กิน,吃,中平,动词,กินข้าว,吃饭,,"></textarea>
      </div>
      <div id="csv-preview" style="margin-bottom:12px;"></div>
      <button class="btn btn-secondary btn-block" id="btn-preview-csv" style="margin-bottom:8px;">预览</button>
      <button class="btn btn-primary btn-block" id="btn-do-import">确认导入</button>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('.modal-close')!.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#btn-preview-csv')!.addEventListener('click', () => {
    const text = (overlay.querySelector('#csv-input') as HTMLTextAreaElement).value;
    const words = parseCSV(text);
    const preview = overlay.querySelector('#csv-preview') as HTMLElement;

    if (words.length === 0) {
      preview.innerHTML = '<p style="color:var(--red-400); font-size:0.85rem;">未解析到有效数据</p>';
      return;
    }

    preview.innerHTML = `
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
      </div>
    `;
  });

  overlay.querySelector('#btn-do-import')!.addEventListener('click', async () => {
    const text = (overlay.querySelector('#csv-input') as HTMLTextAreaElement).value;
    const words = parseCSV(text);

    if (words.length === 0) {
      showError('未解析到有效数据');
      return;
    }

    const result = await importWords(words);

    for (let i = 0; i < result.imported; i++) {
      const word = await (await import('../db/vocabulary')).getAllWords();
      const latest = word[0];
      if (latest?.id) await initNewWordReview(latest.id);
    }

    overlay.remove();
    showSuccess(`导入成功 ${result.imported} 个${result.duplicates > 0 ? `，跳过重复 ${result.duplicates} 个` : ''}`);
    onSaved();
  });
}
