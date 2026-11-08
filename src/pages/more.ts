import { createElement, escapeHtml } from '../lib/utils';
import { navigateTo } from '../router';
import { getProgressSummary } from '../db/progress';
import { getWordCount, exportWordsToCSV, downloadCSV, parseCSV, importWords, getAllWords } from '../db/vocabulary';
import { getStubbornCount } from '../db/errors';
import { getSetting, setSetting, db } from '../db/index';
import { showSuccess, showError } from '../components/toast';

export async function renderMorePage(container: HTMLElement): Promise<void> {
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `<h1>我的</h1>`;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  const [summary, wordCount, stubbornCount] = await Promise.all([
    getProgressSummary(),
    getWordCount(),
    getStubbornCount(),
  ]);

  content.innerHTML = `
    <div class="section animate-fade-in">
      <div class="card" style="text-align:center; padding:20px; background:linear-gradient(135deg, var(--orange-100), var(--orange-200)); border-color:var(--orange-300);">
        <div style="font-size:2rem; font-weight:700; color:var(--orange-500);">${summary.streakDays}</div>
        <div style="font-size:0.85rem; color:var(--text-secondary); margin-top:4px;">连续打卡天数</div>
        <div style="display:flex; justify-content:center; gap:24px; margin-top:12px; font-size:0.8rem; color:var(--text-secondary);">
          <span>词汇 ${wordCount}</span>
          <span>复习 ${summary.totalReviews}</span>
          <span>顽固词 ${stubbornCount}</span>
        </div>
      </div>
    </div>

    <div class="section animate-fade-in" style="animation-delay:0.05s;">
      <div class="section-title"><span class="emoji">📊</span> 学习数据</div>
      <div class="card" style="padding:0; overflow:hidden;">
        <div class="list-item" data-nav="/progress" style="cursor:pointer;">
          <span style="font-size:1.2rem;">📈</span>
          <div class="list-item-content">
            <div class="list-item-title">学习进度</div>
            <div class="list-item-subtitle">统计图表与成就</div>
          </div>
          <span style="color:var(--text-muted);">›</span>
        </div>
        <div class="list-item" data-nav="/error-book" style="cursor:pointer;">
          <span style="font-size:1.2rem;">📕</span>
          <div class="list-item-content">
            <div class="list-item-title">错词本</div>
            <div class="list-item-subtitle">今日错词与顽固词</div>
          </div>
          <span style="color:var(--text-muted);">›</span>
        </div>
        <div class="list-item" data-nav="/reference" style="cursor:pointer;">
          <span style="font-size:1.2rem;">📚</span>
          <div class="list-item-content">
            <div class="list-item-title">参考词库</div>
            <div class="list-item-subtitle">搜索参考词，加入学习</div>
          </div>
          <span style="color:var(--text-muted);">›</span>
        </div>
      </div>
    </div>

    <div class="section animate-fade-in" style="animation-delay:0.1s;">
      <div class="section-title"><span class="emoji">📖</span> 学习工具</div>
      <div class="card" style="padding:0; overflow:hidden;">
        <div class="list-item" data-nav="/tone-training" style="cursor:pointer;">
          <span style="font-size:1.2rem;">🎵</span>
          <div class="list-item-content">
            <div class="list-item-title">声调规则训练</div>
            <div class="list-item-subtitle">看泰文选声调，展示推导步骤</div>
          </div>
          <span style="color:var(--text-muted);">›</span>
        </div>
        <div class="list-item" data-nav="/consonants" style="cursor:pointer;">
          <span style="font-size:1.2rem;">🔤</span>
          <div class="list-item-content">
            <div class="list-item-title">辅音分类</div>
            <div class="list-item-subtitle">高/中/低辅音卡片与测验</div>
          </div>
          <span style="color:var(--text-muted);">›</span>
        </div>
        <div class="list-item" data-nav="/spelling" style="cursor:pointer;">
          <span style="font-size:1.2rem;">📝</span>
          <div class="list-item-content">
            <div class="list-item-title">拼写读音对照</div>
            <div class="list-item-subtitle">不发音字母、尾辅音转换</div>
          </div>
          <span style="color:var(--text-muted);">›</span>
        </div>
        <div class="list-item" data-nav="/minimal-pairs" style="cursor:pointer;">
          <span style="font-size:1.2rem;">👂</span>
          <div class="list-item-content">
            <div class="list-item-title">易混淆词</div>
            <div class="list-item-subtitle">形近词对比练习</div>
          </div>
          <span style="color:var(--text-muted);">›</span>
        </div>
        <div class="list-item" data-nav="/colloquial" style="cursor:pointer;">
          <span style="font-size:1.2rem;">💬</span>
          <div class="list-item-content">
            <div class="list-item-title">口语吞音笔记</div>
            <div class="list-item-subtitle">记录口语变形</div>
          </div>
          <span style="color:var(--text-muted);">›</span>
        </div>
      </div>
    </div>

    <div class="section animate-fade-in" style="animation-delay:0.15s;">
      <div class="section-title"><span class="emoji">💾</span> 数据管理</div>
      <div class="card" style="padding:0; overflow:hidden;">
        <div class="list-item" id="btn-export" style="cursor:pointer;">
          <span style="font-size:1.2rem;">⬇️</span>
          <div class="list-item-content">
            <div class="list-item-title">导出词库</div>
            <div class="list-item-subtitle">备份为 CSV 文件</div>
          </div>
        </div>
        <div class="list-item" id="btn-import" style="cursor:pointer;">
          <span style="font-size:1.2rem;">⬆️</span>
          <div class="list-item-content">
            <div class="list-item-title">导入词库</div>
            <div class="list-item-subtitle">从 CSV 文件恢复</div>
          </div>
        </div>
        <div class="list-item" id="btn-export-all" style="cursor:pointer;">
          <span style="font-size:1.2rem;">📦</span>
          <div class="list-item-content">
            <div class="list-item-title">导出全部数据</div>
            <div class="list-item-subtitle">备份所有学习数据 (JSON)</div>
          </div>
        </div>
        <div class="list-item" id="btn-import-all" style="cursor:pointer;">
          <span style="font-size:1.2rem;">📥</span>
          <div class="list-item-content">
            <div class="list-item-title">恢复全部数据</div>
            <div class="list-item-subtitle">从 JSON 备份恢复</div>
          </div>
        </div>
      </div>
    </div>

    <div class="section animate-fade-in" style="animation-delay:0.2s;">
      <div class="section-title"><span class="emoji">⚙️</span> 设置</div>
      <div class="card">
        <div class="input-group" style="margin-bottom:0;">
          <label class="input-label">顽固词阈值（累计错误次数）</label>
          <select class="select" id="stubborn-threshold">
            <option value="2">2 次</option>
            <option value="3">3 次</option>
            <option value="5">5 次</option>
            <option value="7">7 次</option>
          </select>
        </div>
      </div>
    </div>

    <div style="text-align:center; padding:24px 0; color:var(--text-muted); font-size:0.75rem;">
      萨瓦迪卡 · 泰语学习 v2.0
    </div>
  `;

  const threshold = await getSetting('stubbornThreshold', '3');
  const thresholdSelect = content.querySelector('#stubborn-threshold') as HTMLSelectElement;
  thresholdSelect.value = threshold;
  thresholdSelect.addEventListener('change', async () => {
    await setSetting('stubbornThreshold', thresholdSelect.value);
    showSuccess('设置已保存');
  });

  content.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => {
      const route = el.getAttribute('data-nav');
      if (route) navigateTo(route);
    });
  });

  content.querySelector('#btn-export')!.addEventListener('click', async () => {
    const words = await getAllWords();
    if (words.length === 0) { showError('词库为空'); return; }
    const csv = exportWordsToCSV(words);
    downloadCSV(csv, `thai-vocab-${new Date().toISOString().slice(0, 10)}.csv`);
    showSuccess('导出成功');
  });

  content.querySelector('#btn-import')!.addEventListener('click', () => {
    showImportModal();
  });

  content.querySelector('#btn-export-all')!.addEventListener('click', async () => {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      words: await db.words.toArray(),
      reviewStates: await db.reviewStates.toArray(),
      errorRecords: await db.errorRecords.toArray(),
      stubbornWords: await db.stubbornWords.toArray(),
      dailyStats: await db.dailyStats.toArray(),
      grammarPoints: await db.grammarPoints.toArray(),
      colloquialNotes: await db.colloquialNotes.toArray(),
      minimalPairGroups: await db.minimalPairGroups.toArray(),
      referenceWords: await db.referenceWords.toArray(),
      settings: await db.settings.toArray(),
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `thai-learn-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showSuccess('全部数据已导出');
  });

  content.querySelector('#btn-import-all')!.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.version || !data.words) {
          showError('无效的备份文件');
          return;
        }
        if (!confirm(`将恢复 ${data.words.length} 个单词和所有学习数据。当前数据将被覆盖，确定继续？`)) return;
        await db.transaction('rw', [db.words, db.reviewStates, db.errorRecords, db.stubbornWords, db.dailyStats, db.grammarPoints, db.colloquialNotes, db.minimalPairGroups, db.referenceWords, db.settings], async () => {
          await db.words.clear();
          await db.reviewStates.clear();
          await db.errorRecords.clear();
          await db.stubbornWords.clear();
          await db.dailyStats.clear();
          await db.grammarPoints.clear();
          await db.colloquialNotes.clear();
          await db.minimalPairGroups.clear();
          await db.referenceWords.clear();
          await db.settings.clear();
          if (data.words.length) await db.words.bulkAdd(data.words);
          if (data.reviewStates?.length) await db.reviewStates.bulkAdd(data.reviewStates);
          if (data.errorRecords?.length) await db.errorRecords.bulkAdd(data.errorRecords);
          if (data.stubbornWords?.length) await db.stubbornWords.bulkAdd(data.stubbornWords);
          if (data.dailyStats?.length) await db.dailyStats.bulkAdd(data.dailyStats);
          if (data.grammarPoints?.length) await db.grammarPoints.bulkAdd(data.grammarPoints);
          if (data.colloquialNotes?.length) await db.colloquialNotes.bulkAdd(data.colloquialNotes);
          if (data.minimalPairGroups?.length) await db.minimalPairGroups.bulkAdd(data.minimalPairGroups);
          if (data.referenceWords?.length) await db.referenceWords.bulkAdd(data.referenceWords);
          if (data.settings?.length) await db.settings.bulkAdd(data.settings);
        });
        showSuccess('数据恢复成功');
        setTimeout(() => window.location.reload(), 1000);
      } catch (e) {
        showError('恢复失败：文件格式错误');
      }
    });
    input.click();
  });
}

function showImportModal(): void {
  const overlay = createElement('div', { className: 'modal-overlay' });
  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>导入 CSV</h2>
        <button class="modal-close">&times;</button>
      </div>
      <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:12px;">
        每行一个单词，格式：泰文,中文,声调,词性,例句,备注,标签
      </p>
      <div class="input-group">
        <textarea class="textarea" id="csv-input" rows="8" placeholder="สวัสดี,你好,中平,感叹词,,问候语,日常;问候"></textarea>
      </div>
      <button class="btn btn-primary btn-block" id="btn-do-import">确认导入</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.modal-close')!.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#btn-do-import')!.addEventListener('click', async () => {
    const text = (overlay.querySelector('#csv-input') as HTMLTextAreaElement).value;
    const words = parseCSV(text);
    if (words.length === 0) { showError('未解析到有效数据'); return; }
    const result = await importWords(words);
    overlay.remove();
    showSuccess(`导入成功 ${result.imported} 个${result.duplicates > 0 ? `，跳过重复 ${result.duplicates} 个` : ''}`);
  });
}
