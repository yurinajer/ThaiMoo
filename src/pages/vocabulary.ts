import { createElement, escapeHtml, toneTagsHtml } from '../lib/utils';
import { getAllWords, addWord, deleteWord, deleteWords, updateWord, searchWords, parseCSV, importWords, exportWordsToCSV, downloadCSV, CSV_COLUMNS, type CSVSkip } from '../db/vocabulary';
import { showSuccess, showError } from '../components/toast';
import { showWordDetail } from '../components/word-detail';
import { TONES, MAX_TONE_SYLLABLES, normalizeToneSeq, toneSeqToStorage, type ToneDef, type ToneId } from '../lib/tones';
import type { Word } from '../db/index';

export async function renderVocabularyPage(container: HTMLElement): Promise<void> {
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `<h1>词库管理</h1>`;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  content.innerHTML = `
    <div class="search-bar">
      <span class="search-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--tone-dark-coffee)" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg></span>
      <input type="text" id="vocab-search" placeholder="搜索泰文、中文、标签..." />
    </div>

    <div style="display:flex; gap:8px; margin-bottom:16px;">
      <button class="btn btn-primary btn-sm" id="btn-add-word" style="flex:1">+ 添加单词</button>
      <button class="btn btn-secondary btn-sm" id="btn-import-csv" style="flex:1">批量导入</button>
      <button class="btn btn-outline btn-sm" id="btn-export-csv" title="导出 CSV"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--tone-deep-orange)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><line x1="12" y1="4" x2="12" y2="15"/><polyline points="6 10 12 16 18 10"/><path d="M5 19h14"/></svg></button>
      <button class="btn btn-outline btn-sm" id="btn-bulk-manage" style="flex:1">批量管理</button>
    </div>

    <div id="bulk-bar"></div>

    <details class="csv-spec">
      <summary class="csv-spec-title">CSV 自动生成规范<span class="csv-spec-sub">外部 Agent 生成数据时照这份写</span></summary>
      <div class="csv-spec-body">
        <div class="csv-spec-h">表头 · ${CSV_COLUMNS.length} 列</div>
        <div class="csv-spec-code">${escapeHtml(csvSpecHeader())}</div>
        <div class="csv-spec-note">带表头时按字段名对应，列顺序可调，但每行字段数必须等于表头列数（${CSV_COLUMNS.length}），空列也要保留逗号占位；不写表头则按上面顺序取列，最少只写泰文、中文两列。表头必须同时含「泰文」和「中文」。</div>

        <div class="csv-spec-h">声调 canonical ID</div>
        <table class="csv-spec-table">
          <thead><tr><th>声调</th><th>ID</th></tr></thead>
          <tbody>${TONES.map(t => `<tr><td>${escapeHtml(t.zh)}</td><td class="csv-spec-id">${t.id}</td></tr>`).join('')}</tbody>
        </table>

        <div class="csv-spec-h">多音节标注</div>
        <ul class="csv-spec-list">
          <li>按实际发音的音节顺序标注，最多 ${MAX_TONE_SYLLABLES} 个音节。</li>
          <li>音节之间用半角连字符 <span class="csv-spec-id">-</span> 连接；单音节只写 1 个 ID，不加连字符。</li>
          <li>示例：<span class="csv-spec-id">mid</span> · <span class="csv-spec-id">mid-high</span> · <span class="csv-spec-id">mid-low-high</span> · <span class="csv-spec-id">mid-low-high-rising</span></li>
          <li>不确定的留空，不允许猜测或自行推导；写这 5 个 ID 之外的值、或超过 ${MAX_TONE_SYLLABLES} 个音节，整行会被跳过。</li>
        </ul>

        <div class="csv-spec-h">其他字段</div>
        <ul class="csv-spec-list">
          <li>泰文、中文必填，任一为空整行跳过；其余列可留空。</li>
          <li>分隔符用半角逗号，编码 UTF-8，行尾 LF / CRLF 都可以。</li>
          <li>字段内出现逗号、换行或双引号时，整个字段用双引号包住，内部双引号写成两个双引号。</li>
          <li>多个标签用半角分号 ; 分隔；罗马音不确定就留空，不得编造。</li>
          <li>泰文与词库已有词条完全相同时按重复跳过，不会覆盖旧数据。</li>
        </ul>

        <div class="csv-spec-h">示例（可直接粘贴导入）</div>
        <pre class="csv-spec-pre">${escapeHtml(csvSpecExample())}</pre>

        <div class="csv-spec-h">Agent 指令（整段可复制）</div>
        <textarea class="textarea csv-agent-spec" id="csv-agent-spec" rows="16" readonly spellcheck="false">${escapeHtml(csvAgentSpec())}</textarea>
        <button class="btn btn-secondary btn-block" id="btn-copy-csv-spec">复制 Agent 生成规范</button>
      </div>
    </details>

    <div id="word-list"></div>
  `;

  const wordListEl = content.querySelector('#word-list') as HTMLElement;
  const searchInput = content.querySelector('#vocab-search') as HTMLInputElement;
  const bulkBarEl = content.querySelector('#bulk-bar') as HTMLElement;
  const bulkToggleBtn = content.querySelector('#btn-bulk-manage') as HTMLButtonElement;

  let managing = false;
  let shownWords: Word[] = [];
  const selected = new Set<number>();

  function renderBulkBar() {
    if (!managing) {
      bulkBarEl.innerHTML = '';
      return;
    }
    const allChecked = shownWords.length > 0 && shownWords.every(w => selected.has(w.id!));
    bulkBarEl.innerHTML = `
      <div class="bulk-bar">
        <span class="bulk-bar-count">已选 ${selected.size} / 当前结果 ${shownWords.length}</span>
        <span class="bulk-bar-actions">
          <button class="btn btn-sm btn-secondary" id="btn-bulk-all">${allChecked ? '取消全选' : '全选结果'}</button>
          <button class="btn btn-sm btn-danger" id="btn-bulk-del" ${selected.size === 0 ? 'disabled' : ''}>删除选中</button>
          <button class="btn btn-sm btn-outline" id="btn-bulk-exit">退出管理</button>
        </span>
      </div>
      <p class="bulk-bar-hint">全选只作用于当前搜索或列表结果；换关键词筛选后，之前勾选的词仍保留在已选里。</p>
    `;

    bulkBarEl.querySelector('#btn-bulk-all')!.addEventListener('click', () => {
      if (shownWords.every(w => selected.has(w.id!))) {
        for (const w of shownWords) selected.delete(w.id!);
      } else {
        for (const w of shownWords) selected.add(w.id!);
      }
      loadWords(searchInput.value.trim());
    });
    bulkBarEl.querySelector('#btn-bulk-del')!.addEventListener('click', deleteSelected);
    bulkBarEl.querySelector('#btn-bulk-exit')!.addEventListener('click', () => setManaging(false));
  }

  function setManaging(next: boolean) {
    managing = next;
    selected.clear();
    bulkToggleBtn.textContent = next ? '退出管理' : '批量管理';
    loadWords(searchInput.value.trim());
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    // 删除是行级不可逆操作，确认文案必须把连带清掉的东西列全。
    if (!confirm(
      `将删除 ${ids.length} 个单词，并连带删除它们的复习进度、错题记录、顽固词标记、对比组关联和跟读录音。\n\n` +
      `此操作无法撤销。建议先到「我的」页导出全部数据备份。\n\n确定继续？`
    )) return;

    const n = await deleteWords(ids);
    showSuccess(`已删除 ${n} 个单词`);
    setManaging(false);
  }

  async function loadWords(query?: string) {
    const words = query ? await searchWords(query) : await getAllWords();
    shownWords = words;
    renderWordList(wordListEl, words, () => loadWords(searchInput.value.trim()), {
      managing,
      selected,
      onCountChange: renderBulkBar
    });
    renderBulkBar();
  }

  let searchTimer: ReturnType<typeof setTimeout>;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadWords(searchInput.value.trim()), 300);
  });

  content.querySelector('#btn-add-word')!.addEventListener('click', () => showWordFormModal(null, () => loadWords(searchInput.value.trim())));
  content.querySelector('#btn-import-csv')!.addEventListener('click', () => showImportModal(loadWords));
  bulkToggleBtn.addEventListener('click', () => setManaging(!managing));
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

  // Clipboard API 在非安全上下文或被浏览器拒绝时会失败，退回选中文本再复制，
  // 实在不行让用户长按文本框手动全选——规范正文本来就摆在可读的文本框里。
  const copySpecBtn = content.querySelector('#btn-copy-csv-spec') as HTMLButtonElement;
  const specBox = content.querySelector('#csv-agent-spec') as HTMLTextAreaElement;
  copySpecBtn.addEventListener('click', async () => {
    const text = csvAgentSpec();
    try {
      await navigator.clipboard.writeText(text);
      showSuccess('Agent 生成规范已复制');
      return;
    } catch {
      specBox.focus();
      specBox.select();
      showSuccess(document.execCommand('copy') ? 'Agent 生成规范已复制' : '复制未成功，请长按文本框手动全选复制');
    }
  });
}

function renderWordList(
  container: HTMLElement,
  words: Word[],
  onRefresh: () => void,
  manage: { managing: boolean; selected: Set<number>; onCountChange: () => void }
): void {
  if (words.length === 0) {
    container.innerHTML = manage.managing
      ? `<div class="empty-state"><p>没有匹配的词</p><p style="font-size:0.8rem; margin-top:8px;">换个关键词，或清空搜索框看全部</p></div>`
      : `
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
    const checked = manage.selected.has(word.id!);
    const item = createElement('div', {
      className: 'card word-card' + (manage.managing ? ' word-card-select' : ''),
      style: 'margin-bottom:8px; padding:12px 16px;'
    });
    item.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
        ${manage.managing ? `<input type="checkbox" class="word-check" ${checked ? 'checked' : ''} aria-label="选中 ${escapeHtml(word.thai)}" />` : ''}
        <div style="flex:1; min-width:0;">
          <div style="font-family:var(--font-thai); font-size:1.3rem; font-weight:500;">${escapeHtml(word.thai)}</div>
          ${(word.romanization ?? '').trim() ? `<div class="word-card-roman">${escapeHtml(word.romanization!.trim())}</div>` : ''}
          <div style="font-size:0.85rem; color:var(--text-secondary); margin-top:2px;">${escapeHtml(word.meaning)}</div>
          <div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:4px;">
            ${toneTagsHtml(word.toneMark)}
            ${word.pos ? `<span class="tag">${escapeHtml(word.pos)}</span>` : ''}
          </div>
        </div>
        ${manage.managing ? '' : `<button class="btn btn-icon word-del-btn" data-id="${word.id}" title="删除" style="color:var(--red-400); font-size:1.2rem;">✕</button>`}
      </div>
    `;

    if (manage.managing) {
      const box = item.querySelector('.word-check') as HTMLInputElement;
      // 勾选框自己处理 change，卡片其余区域靠 click；阻止冒泡避免一次点击翻两次状态。
      const toggle = () => {
        if (manage.selected.has(word.id!)) manage.selected.delete(word.id!);
        else manage.selected.add(word.id!);
        box.checked = manage.selected.has(word.id!);
        manage.onCountChange();
      };
      box.addEventListener('click', e => e.stopPropagation());
      box.addEventListener('change', toggle);
      item.addEventListener('click', toggle);
      container.appendChild(item);
      continue;
    }

    item.addEventListener('click', () => {
      showWordDetail(word, { onEdit: w => showWordFormModal(w, onRefresh) });
    });

    item.querySelector('.word-del-btn')!.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`确定删除 "${word.thai}" 吗？它的复习进度、错题记录、对比组关联和跟读录音会一并删除。`)) {
        await deleteWord(word.id!);
        item.remove();
        showSuccess('已删除');
      }
    });

    container.appendChild(item);
  }
}

// 表单按钮、保存校验和测试都调用这两个函数，上限规则只有一份。
// 空行也占额度：否则连点未标注的行能存出 5 行以上，而 CSV 导入侧拒收这种值，导出后再导入会自锁。
export function canAddToneSyllable(slots: (ToneId | '')[]): boolean {
  return slots.length < MAX_TONE_SYLLABLES;
}

export function validateToneSlots(slots: (ToneId | '')[]): string | null {
  if (slots.length > MAX_TONE_SYLLABLES) {
    return `声调最多标注 ${MAX_TONE_SYLLABLES} 个音节，当前有 ${slots.length} 行。请删除多余的音节行后再保存。`;
  }
  // 尾部空行是“没标完”，直接丢掉；中间空行会让后面的音节整体错位，必须问清楚。
  const blankIndex = slots.findIndex(t => t === '');
  if (blankIndex >= 0 && slots.slice(blankIndex + 1).some(t => t !== '')) {
    return `第 ${blankIndex + 1} 个音节没有选声调，但它后面还有音节。请补齐或删除这一行。`;
  }
  return null;
}

// 320px 下 select 可见文本区只有约 140px，再带泰文调类和括号说明就会裁掉调名。
export function toneOptionLabel(t: ToneDef): string {
  return `${t.num}. ${t.zh} ${t.en}`;
}

export function showWordFormModal(existing: Word | null, onSaved: () => void): void {
  const isEdit = !!existing?.id;
  // 一个音节一格，顺序即存储顺序；至少留一格，才能区分“未标注”和“只标了单音节”。
  // 不裁剪历史数据：万一某条记录存了 5 个音节，也照原样显示，只是不能再加。
  const storedTones = normalizeToneSeq(existing?.toneMark);
  const slots: (ToneId | '')[] = storedTones.length > 0 ? [...storedTones] : [''];

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
        <label class="input-label">声调（按音节顺序）</label>
        <div id="tone-slots"></div>
        <button type="button" class="btn btn-outline btn-sm" id="btn-add-tone-syllable" style="margin-top:8px;">+ 添加音节</button>
        <div class="field-hint">单音节词只留一行；多音节词按朗读顺序逐格选择，最多 ${MAX_TONE_SYLLABLES} 个音节，留空的行视为未标注。</div>
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

  const slotsHost = overlay.querySelector('#tone-slots') as HTMLElement;
  const addSyllableBtn = overlay.querySelector('#btn-add-tone-syllable') as HTMLButtonElement;

  function syncAddButton(): void {
    const full = !canAddToneSyllable(slots);
    addSyllableBtn.disabled = full;
    addSyllableBtn.textContent = full ? `最多 ${MAX_TONE_SYLLABLES} 个音节` : '+ 添加音节';
  }

  function renderToneSlots(): void {
    slotsHost.innerHTML = slots.map((tone, i) => `
      <div class="tone-slot-row">
        <span class="tone-slot-label">${slots.length > 1 ? `第 ${i + 1} 音节` : '音节'}</span>
        <select class="select" data-slot="${i}">
          <option value="" ${tone === '' ? 'selected' : ''}>未标注</option>
          ${TONES.map(t => `
            <option value="${t.id}" ${t.id === tone ? 'selected' : ''}>${toneOptionLabel(t)}</option>
          `).join('')}
        </select>
        <button type="button" class="btn btn-icon" data-del="${i}" title="删除该音节"
          style="color:var(--red-400);" ${slots.length === 1 ? 'disabled' : ''}>✕</button>
      </div>
    `).join('');

    slotsHost.querySelectorAll<HTMLSelectElement>('select[data-slot]').forEach(sel => {
      sel.addEventListener('change', () => {
        slots[Number(sel.dataset.slot)] = (sel.value || '') as ToneId | '';
        syncAddButton();
      });
    });
    slotsHost.querySelectorAll<HTMLButtonElement>('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        slots.splice(Number(btn.dataset.del), 1);
        renderToneSlots();
      });
    });
    syncAddButton();
  }

  addSyllableBtn.addEventListener('click', () => {
    // 上限由这里判定，disabled 只是提示。
    if (!canAddToneSyllable(slots)) return;
    slots.push('');
    renderToneSlots();
  });

  renderToneSlots();

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

    // 保存这一路再判一次：表单之外写进来的历史超长数据也走这里。
    const slotsError = validateToneSlots(slots);
    if (slotsError) {
      showError(slotsError);
      return;
    }
    const tones = slots.filter((t): t is ToneId => t !== '');

    const wordData = {
      thai,
      meaning,
      toneMark: toneSeqToStorage(tones),
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
      // 只入词库，不写排期行：新词进「新词池」，由复习页每轮抽 SESSION_NEW_LIMIT 个激活
      await addWord({ ...wordData, groupId: undefined });
      showSuccess('添加成功');
    }

    overlay.remove();
    onSaved();
  });
}

// 说明文案的三条真源：列名取自导入解析器（CSV_COLUMNS），声调 ID 与音节上限取自 tones.ts。
// 页面文字和 Agent 指令都由它们拼出来，改了格式规则不用回头改两处说明。
export function csvSpecHeader(): string {
  return CSV_COLUMNS.join(',');
}

// 前两行沿用导入框占位符里既有的词条，第三行演示「不确定就留空」。
export function csvSpecExample(): string {
  return [
    csvSpecHeader(),
    'สวัสดี,你好,low-low-mid,感叹词,,,日常;问候,sà-wàt-dii,,你好',
    'กิน,吃,mid,动词,กินข้าว,,日常;食物,gin,gin kâao,吃饭',
    'โรงเรียน,学校,,名词,,,,,,',
  ].join('\n');
}

export function csvAgentSpec(): string {
  const toneIds = TONES.map(t => `${t.id}（${t.zh}）`).join(' / ');
  return [
    '你是泰语学习词库的数据生成助手。请按本规范生成 CSV，我会直接粘贴到网站的「批量导入」文本框。',
    '',
    '【一、表头与字段数】',
    '1. 第一行固定输出表头，字段名必须与下面完全一致：不增列、不删列、不改名、不翻译、不加英文别名。',
    csvSpecHeader(),
    '2. 表头必须同时包含「泰文」和「中文」。出现任何未知字段名都会让表头失效，后续所有行改按默认列位解析，列一旦错位数据就错了。',
    `3. 每个数据行的字段数必须等于表头列数（${CSV_COLUMNS.length} 个）。没有内容的列也要保留逗号占位，不能省略末尾字段——字段数不符的行整行跳过。网站另接受「无表头、只写泰文和中文两列」的简版，但本规范一律按上面的完整表头输出。`,
    '4. 字段分隔符用半角逗号 , ；编码 UTF-8（可带 BOM）；行尾 LF 或 CRLF 均可。',
    '',
    '【二、声调列】',
    `5. 只写 canonical ID，全小写：${toneIds}。不要写中文声调名、泰文调类、数字编号或自造符号。`,
    '6. 按单词实际发音的音节顺序标注，音节之间只用半角连字符 - 连接。读取侧虽然也认 / 、→ 和空格，但输出统一只用 -。',
    `7. 最多 ${MAX_TONE_SYLLABLES} 个音节，超过的整行拒收。长词请留空声调，不要截断、不要合并。`,
    `8. 单音节只写 1 个 ID、不加连字符；${MAX_TONE_SYLLABLES} 音节示例 mid-low-high-rising，双音节示例 mid-high。`,
    '9. 不确定的声调一律留空。不允许猜测，也不允许按声调规则自行推导——填了无法识别的值，整行都会被跳过。',
    '',
    '【三、其他字段】',
    '10. 泰文、中文必填；泰文列只写单词本身，不带空格、标点和变体写法。',
    '11. 罗马音只在确定时填写，不确定一律留空，不得由拼写自行拼造。',
    '12. 标签列的多个标签用半角分号 ; 分隔。',
    '13. 字段内部出现逗号、全角逗号、Tab、换行或双引号时，整个字段用双引号包裹，字段内的双引号写成连续两个双引号。',
    '14. 导入按泰文完全相同去重：词库已有的泰文会被跳过且不覆盖，所以不要用重复行来修改旧词。',
    '',
    '【四、输出前自检】',
    `15. 逐行确认字段数 = ${CSV_COLUMNS.length}，没有省略末尾空列。`,
    '16. 确认双引号只在字段起始处出现、成对闭合，字段内的逗号都已正确转义。',
    `17. 确认声调列只用上面 ${TONES.length} 个 canonical ID，音节数在 1 到 ${MAX_TONE_SYLLABLES} 之间，连接符是半角连字符。`,
    '18. 确认不确定的声调与罗马音已经留空，没有编造内容。',
    '19. 只输出符合本规范的 CSV 本体：不要解释、不要注释行、不要 Markdown 代码块或表格。',
    '',
    '【五、格式示例】',
    csvSpecExample(),
  ].join('\n');
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
        列顺序：<code>${escapeHtml(csvSpecHeader())}</code><br>
        最少两列：<code>泰文,中文</code>；分隔符可用逗号或 Tab。<br>
        有表头时按字段名对应，列顺序可调整；表头行只识别、不导入。<br>
        字段内本身含逗号或换行时，用双引号包裹（导出文件即此格式），内部双引号写成 <code>""</code>。<br>
        声调填 mid / low / falling / high / rising（旧中文标签 平 / 低 / 降 / 高 / 升 也兼容），留空表示未标注。<br>
        多音节按顺序写，用 <code>-</code>、<code>/</code>、<code>→</code> 或空格分隔，例如
        <code>mid-high</code>、<code>平-高</code>、<code>falling high</code>，最多 ${MAX_TONE_SYLLABLES} 个音节。
      </p>
      <div class="input-group">
        <textarea class="textarea" id="csv-input" rows="8" style="font-family:var(--font-thai);" placeholder="สวัสดี,你好,low-low-mid,感叹词,,,日常;问候,sà-wàt-dii,,你好
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
  // 报错固定三段：第几行、哪一列、什么原因，末尾附整行原文便于对照。
  const skipNotice = (skipped: CSVSkip[]) => {
    if (skipped.length === 0) return '';
    const detail = skipped.map(s => `
          <div style="padding:6px 0; border-bottom:1px solid var(--border-light);">
            <div style="color:var(--text-secondary);">第 ${s.line} 行${s.column ? ` · ${escapeHtml(s.column)}列` : ''} · ${escapeHtml(s.reason)}</div>
            <div style="font-family:var(--font-thai); color:var(--text-muted); word-break:break-all; margin-top:2px;">${escapeHtml(s.raw)}</div>
          </div>`).join('');
    return `
      <details style="font-size:0.8rem; margin-top:8px;">
        <summary style="color:var(--red-400); cursor:pointer;">已跳过 ${skipped.length} 行异常数据，点击展开全部明细</summary>
        <div style="max-height:160px; overflow-y:auto; border:1px solid var(--border-light); border-radius:8px; padding:2px 8px; margin-top:4px;">${detail}</div>
      </details>`;
  };

  const previewWords = (
    words: { thai: string; meaning: string; toneMark?: string }[],
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
            ${toneTagsHtml(w.toneMark ?? '')}
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
      // 全部行都异常时，光靠 toast 只有个数字，用户看不到是哪一行哪一列出的问题。
      const preview = overlay.querySelector('#csv-preview') as HTMLElement;
      preview.innerHTML = `<p style="color:var(--red-400); font-size:0.85rem;">未解析到有效数据</p>${skipNotice(skipped)}`;
      showError(skipped.length > 0 ? `未解析到有效数据，${skipped.length} 行异常数据已跳过（详见预览）` : '未解析到有效数据');
      return;
    }

    const result = await importWords(words);

    overlay.remove();
    showSuccess(`导入成功 ${result.imported} 个${result.duplicates > 0 ? `，跳过重复 ${result.duplicates} 个` : ''}${skipped.length > 0 ? `，${skipped.length} 行异常数据未导入` : ''}`);
    onSaved?.();
  });
}
