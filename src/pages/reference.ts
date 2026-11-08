import { createElement, escapeHtml } from '../lib/utils';
import { db, type ReferenceWord } from '../db/index';
import { addWord, findDuplicate } from '../db/vocabulary';
import { initNewWordReview } from '../db/review';
import { showSuccess, showError } from '../components/toast';

const SAMPLE_REFERENCE_WORDS: Omit<ReferenceWord, 'id'>[] = [
  { thai: 'สวัสดี', meaning: '你好', pos: '感叹词', toneMark: '中平', source: '日常' },
  { thai: 'ขอบคุณ', meaning: '谢谢', pos: '感叹词', toneMark: '中平', source: '日常' },
  { thai: 'ไม่', meaning: '不', pos: '副词', toneMark: '中平', source: '基础' },
  { thai: 'ใช่', meaning: '是', pos: '副词', toneMark: '中平', source: '基础' },
  { thai: 'น้ำ', meaning: '水', pos: '名词', toneMark: '高升', source: '日常' },
  { thai: 'ข้าว', meaning: '饭/米饭', pos: '名词', toneMark: '高升', source: '日常' },
  { thai: 'ไป', meaning: '去', pos: '动词', toneMark: '中平', source: '基础' },
  { thai: 'มา', meaning: '来', pos: '动词', toneMark: '中平', source: '基础' },
  { thai: 'กิน', meaning: '吃', pos: '动词', toneMark: '中平', source: '基础' },
  { thai: 'รัก', meaning: '爱', pos: '动词', toneMark: '中平', source: '基础' },
  { thai: 'ดี', meaning: '好', pos: '形容词', toneMark: '中平', source: '基础' },
  { thai: 'ใหญ่', meaning: '大', pos: '形容词', toneMark: '中平', source: '基础' },
  { thai: 'เล็ก', meaning: '小', pos: '形容词', toneMark: '中平', source: '基础' },
  { thai: 'ร้อน', meaning: '热', pos: '形容词', toneMark: '降调', source: '天气' },
  { thai: 'หนาว', meaning: '冷', pos: '形容词', toneMark: '中平', source: '天气' },
  { thai: 'สวย', meaning: '漂亮', pos: '形容词', toneMark: '中平', source: '外貌' },
  { thai: 'หล่อ', meaning: '帅', pos: '形容词', toneMark: '降调', source: '外貌' },
  { thai: 'บ้าน', meaning: '家/房子', pos: '名词', toneMark: '中平', source: '日常' },
  { thai: 'รถ', meaning: '车', pos: '名词', toneMark: '中平', source: '交通' },
  { thai: 'โรงเรียน', meaning: '学校', pos: '名词', toneMark: '降调', source: '场所' },
];

export async function renderReferencePage(container: HTMLElement): Promise<void> {
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `
    <button class="back-btn" onclick="window.location.hash='/more'">←</button>
    <h1>参考词库</h1>
  `;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  let refWords = await db.referenceWords.toArray();

  if (refWords.length === 0) {
    for (const w of SAMPLE_REFERENCE_WORDS) {
      await db.referenceWords.add(w);
    }
    refWords = await db.referenceWords.toArray();
  }

  content.innerHTML = `
    <div class="card" style="margin-bottom:16px; background:var(--orange-50); border-color:var(--orange-200);">
      <div style="font-size:0.85rem; color:var(--text-secondary);">
        <div style="font-weight:600; margin-bottom:4px;">📖 说明</div>
        <div>参考词库仅供搜索浏览，不会自动进入复习。点击"加入学习"可将单词添加到你的词库。</div>
      </div>
    </div>

    <div class="search-bar">
      <span class="search-icon">🔍</span>
      <input type="text" id="ref-search" placeholder="搜索泰文或中文..." />
    </div>

    <div id="ref-list"></div>
  `;

  const refList = content.querySelector('#ref-list') as HTMLElement;
  const searchInput = content.querySelector('#ref-search') as HTMLInputElement;

  function renderList(words: ReferenceWord[]) {
    if (words.length === 0) {
      refList.innerHTML = `
        <div class="empty-state">
          <span class="emoji">🍊</span>
          <p>没有找到匹配的单词</p>
        </div>
      `;
      return;
    }

    refList.innerHTML = words.map(w => `
      <div class="card" style="margin-bottom:8px; padding:12px 16px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="flex:1;">
            <div style="font-family:var(--font-thai); font-size:1.2rem; font-weight:600;">${escapeHtml(w.thai)}</div>
            <div style="font-size:0.85rem; color:var(--text-secondary); margin-top:2px;">${escapeHtml(w.meaning)}</div>
            <div style="display:flex; gap:4px; margin-top:4px;">
              ${w.pos ? `<span class="tag">${escapeHtml(w.pos)}</span>` : ''}
              ${w.toneMark ? `<span class="tag tag-tone">${escapeHtml(w.toneMark)}</span>` : ''}
              ${w.source ? `<span class="tag" style="background:#e3f2fd; color:#1565c0; border-color:#90caf9;">${escapeHtml(w.source)}</span>` : ''}
            </div>
          </div>
          <button class="btn btn-sm btn-primary" data-add="${w.id}">加入学习</button>
        </div>
      </div>
    `).join('');

    refList.querySelectorAll('[data-add]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.getAttribute('data-add')!);
        const refWord = refWords.find(w => w.id === id);
        if (!refWord) return;

        const existing = await findDuplicate(refWord.thai);
        if (existing) {
          showError('该单词已在词库中');
          return;
        }

        const newId = await addWord({
          thai: refWord.thai,
          meaning: refWord.meaning,
          toneMark: refWord.toneMark,
          pos: refWord.pos,
          example: '',
          note: '',
          tags: refWord.source ? [refWord.source] : [],
          groupId: undefined,
        });

        await initNewWordReview(newId);
        showSuccess(`已添加 "${refWord.thai}" 到词库`);
        (btn as HTMLButtonElement).textContent = '已添加';
        (btn as HTMLButtonElement).disabled = true;
      });
    });
  }

  renderList(refWords);

  let searchTimer: ReturnType<typeof setTimeout>;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const q = searchInput.value.trim().toLowerCase();
      if (!q) {
        renderList(refWords);
        return;
      }
      const filtered = refWords.filter(w =>
        w.thai.toLowerCase().includes(q) ||
        w.meaning.toLowerCase().includes(q)
      );
      renderList(filtered);
    }, 300);
  });
}
