import { createElement, escapeHtml } from '../lib/utils';
import { db, type ColloquialNote } from '../db/index';
import { showSuccess, showError } from '../components/toast';

export async function renderColloquialPage(container: HTMLElement): Promise<void> {
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `
    <button class="back-btn" onclick="window.location.hash='/more'">←</button>
    <h1>口语吞音笔记</h1>
  `;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  const notes = await db.colloquialNotes.orderBy('createdAt').reverse().toArray();

  content.innerHTML = `
    <div class="card" style="margin-bottom:16px; background:var(--orange-50); border-color:var(--orange-200);">
      <div style="font-size:0.85rem; color:var(--text-secondary);">
        <div style="font-weight:600; margin-bottom:4px;">📝 说明</div>
        <div>记录泰国人日常口语中的吞音、连读现象。例如："ไม่เป็นไร"口语常说成"ไม้มิไร"</div>
      </div>
    </div>

    <button class="btn btn-primary btn-block" id="btn-add-note" style="margin-bottom:16px;">+ 添加笔记</button>

    <div id="notes-list"></div>
  `;

  const notesList = content.querySelector('#notes-list') as HTMLElement;

  function renderNotes() {
    if (notes.length === 0) {
      notesList.innerHTML = `
        <div class="empty-state">
          <span class="emoji">🍊</span>
          <p>还没有笔记</p>
          <p style="font-size:0.85rem; color:var(--text-muted); margin-top:8px;">点击"添加笔记"记录口语吞音现象</p>
        </div>
      `;
      return;
    }

    notesList.innerHTML = notes.map(n => `
      <div class="card" style="margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; align-items:start;">
          <div style="flex:1;">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
              <span style="font-family:var(--font-thai); font-size:1.2rem; font-weight:600; color:var(--brown-800);">${escapeHtml(n.original)}</span>
              <span style="font-size:1rem;">→</span>
              <span style="font-family:var(--font-thai); font-size:1.2rem; font-weight:600; color:var(--orange-500);">${escapeHtml(n.spoken)}</span>
            </div>
            <div style="font-size:0.85rem; color:var(--text-secondary); line-height:1.6;">${escapeHtml(n.explanation)}</div>
          </div>
          <button class="btn btn-icon" data-delete="${n.id}" style="color:var(--red-400); font-size:1rem; flex-shrink:0;">✕</button>
        </div>
      </div>
    `).join('');

    notesList.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.getAttribute('data-delete')!);
        if (confirm('确定删除此笔记？')) {
          await db.colloquialNotes.delete(id);
          const idx = notes.findIndex(n => n.id === id);
          if (idx >= 0) notes.splice(idx, 1);
          renderNotes();
          showSuccess('已删除');
        }
      });
    });
  }

  renderNotes();

  content.querySelector('#btn-add-note')!.addEventListener('click', () => showAddNoteModal(notes, renderNotes));
}

function showAddNoteModal(notes: ColloquialNote[], onSave: () => void): void {
  const overlay = createElement('div', { className: 'modal-overlay' });
  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>添加口语笔记</h2>
        <button class="modal-close">&times;</button>
      </div>
      <div class="input-group">
        <label class="input-label">原词/原句 *</label>
        <input class="input" id="note-original" placeholder="如：ไม่เป็นไร" style="font-family:var(--font-thai);" />
      </div>
      <div class="input-group">
        <label class="input-label">口语变形 *</label>
        <input class="input" id="note-spoken" placeholder="如：ไม้มิไร" style="font-family:var(--font-thai);" />
      </div>
      <div class="input-group">
        <label class="input-label">说明</label>
        <textarea class="textarea" id="note-explanation" placeholder="吞音规则说明、使用场景等"></textarea>
      </div>
      <button class="btn btn-primary btn-block" id="btn-save-note">保存</button>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('.modal-close')!.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#btn-save-note')!.addEventListener('click', async () => {
    const original = (overlay.querySelector('#note-original') as HTMLInputElement).value.trim();
    const spoken = (overlay.querySelector('#note-spoken') as HTMLInputElement).value.trim();
    const explanation = (overlay.querySelector('#note-explanation') as HTMLTextAreaElement).value.trim();

    if (!original || !spoken) {
      showError('原词和口语变形不能为空');
      return;
    }

    const note: ColloquialNote = {
      original,
      spoken,
      explanation,
      createdAt: Date.now(),
    };

    await db.colloquialNotes.add(note);
    notes.unshift(note);
    overlay.remove();
    showSuccess('添加成功');
    onSave();
  });
}
