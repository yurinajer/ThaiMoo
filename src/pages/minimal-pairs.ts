import { createElement, escapeHtml, shuffleArray } from '../lib/utils';
import { db, type MinimalPairGroup, type Word } from '../db/index';
import { getAllWords } from '../db/vocabulary';
import { showSuccess, showError } from '../components/toast';

export async function renderMinimalPairsPage(container: HTMLElement): Promise<void> {
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `
    <button class="back-btn" onclick="window.location.hash='/more'">←</button>
    <h1>👂 长短音辨析</h1>
  `;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  const groups = await db.minimalPairGroups.toArray();
  const allWords = await getAllWords();

  content.innerHTML = `
    <div style="display:flex; gap:8px; margin-bottom:16px;">
      <button class="btn btn-primary btn-sm" id="btn-add-group" style="flex:1;">+ 新建对比组</button>
      <button class="btn btn-secondary btn-sm" id="btn-start-quiz" style="flex:1;">开始练习</button>
    </div>

    <div id="groups-list"></div>
  `;

  const groupsList = content.querySelector('#groups-list') as HTMLElement;

  function renderGroups() {
    if (groups.length === 0) {
      groupsList.innerHTML = `
        <div class="empty-state">
          <span class="emoji">🍊</span>
          <p>还没有对比组</p>
          <p style="font-size:0.85rem; color:var(--text-muted); margin-top:8px;">点击"新建对比组"添加形近词进行辨析练习</p>
        </div>
      `;
      return;
    }

    groupsList.innerHTML = groups.map(g => {
      const wordsInGroup = g.wordIds.map(id => allWords.find(w => w.id === id)).filter(Boolean) as Word[];
      return `
        <div class="card" style="margin-bottom:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div style="font-weight:600;">${escapeHtml(g.name)}</div>
            <button class="btn btn-icon" data-delete="${g.id}" style="color:var(--red-400); font-size:1rem;">✕</button>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:8px;">
            ${wordsInGroup.map(w => `
              <div style="padding:8px 12px; background:var(--orange-50); border-radius:8px; border:1px solid var(--orange-200);">
                <span style="font-family:var(--font-thai); font-weight:600;">${escapeHtml(w.thai)}</span>
                <span style="font-size:0.8rem; color:var(--text-muted); margin-left:4px;">${escapeHtml(w.meaning)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');

    groupsList.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.getAttribute('data-delete')!);
        if (confirm('确定删除此对比组？')) {
          await db.minimalPairGroups.delete(id);
          const idx = groups.findIndex(g => g.id === id);
          if (idx >= 0) groups.splice(idx, 1);
          renderGroups();
          showSuccess('已删除');
        }
      });
    });
  }

  renderGroups();

  content.querySelector('#btn-add-group')!.addEventListener('click', () => showAddGroupModal(allWords, groups, renderGroups));
  content.querySelector('#btn-start-quiz')!.addEventListener('click', () => {
    if (groups.length === 0) {
      showError('请先创建对比组');
      return;
    }
    startMinimalPairQuiz(content, groups, allWords);
  });
}

function showAddGroupModal(allWords: Word[], groups: MinimalPairGroup[], onSave: () => void): void {
  const overlay = createElement('div', { className: 'modal-overlay' });
  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>新建对比组</h2>
        <button class="modal-close">&times;</button>
      </div>
      <div class="input-group">
        <label class="input-label">组名</label>
        <input class="input" id="group-name" placeholder="如：长短音 a/aa" />
      </div>
      <div class="input-group">
        <label class="input-label">选择单词（可多选）</label>
        <div id="word-checkboxes" style="max-height:200px; overflow-y:auto; border:1px solid var(--border-light); border-radius:8px; padding:8px;">
          ${allWords.map(w => `
            <label style="display:flex; align-items:center; gap:8px; padding:4px 0; cursor:pointer;">
              <input type="checkbox" value="${w.id}" />
              <span style="font-family:var(--font-thai); font-weight:500;">${escapeHtml(w.thai)}</span>
              <span style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(w.meaning)}</span>
            </label>
          `).join('')}
        </div>
      </div>
      <button class="btn btn-primary btn-block" id="btn-save-group">保存</button>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('.modal-close')!.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#btn-save-group')!.addEventListener('click', async () => {
    const name = (overlay.querySelector('#group-name') as HTMLInputElement).value.trim();
    if (!name) {
      showError('请输入组名');
      return;
    }

    const checkboxes = overlay.querySelectorAll('#word-checkboxes input[type=checkbox]:checked');
    const wordIds = Array.from(checkboxes).map(cb => parseInt(cb.getAttribute('value')!));

    if (wordIds.length < 2) {
      showError('请至少选择2个单词');
      return;
    }

    const group: MinimalPairGroup = {
      name,
      wordIds,
      createdAt: Date.now(),
    };

    await db.minimalPairGroups.add(group);
    groups.push(group);
    overlay.remove();
    showSuccess('创建成功');
    onSave();
  });
}

function startMinimalPairQuiz(content: HTMLElement, groups: MinimalPairGroup[], allWords: Word[]) {
  const questions: { word: Word; groupWords: Word[] }[] = [];

  for (const group of groups) {
    const groupWords = group.wordIds.map(id => allWords.find(w => w.id === id)).filter(Boolean) as Word[];
    if (groupWords.length < 2) continue;

    for (const word of groupWords) {
      questions.push({ word, groupWords: groupWords.filter(w => w.id !== word.id) });
    }
  }

  const shuffled = shuffleArray(questions).slice(0, Math.min(10, questions.length));
  let currentQ = 0;
  let correct = 0;

  function renderQuizQuestion() {
    if (currentQ >= shuffled.length) {
      content.innerHTML = `
        <div class="card" style="text-align:center; margin-top:40px;">
          <div style="font-size:3rem; margin-bottom:16px;">👂</div>
          <div style="font-size:1.1rem; font-weight:600;">练习完成！</div>
          <div style="font-size:2.5rem; font-weight:700; color:var(--orange-500); margin:16px 0;">
            ${Math.round((correct / shuffled.length) * 100)}%
          </div>
          <div style="color:var(--text-secondary);">答对 ${correct} / ${shuffled.length}</div>
        </div>
        <div style="margin-top:24px;">
          <a href="#/more" class="btn btn-secondary btn-block" style="margin-bottom:8px;">返回</a>
          <button class="btn btn-primary btn-block" onclick="window.location.hash='/minimal-pairs'">再来一次</button>
        </div>
      `;
      return;
    }

    const q = shuffled[currentQ];
    const options = shuffleArray([
      { word: q.word, correct: true },
      ...q.groupWords.map(w => ({ word: w, correct: false })),
    ]);

    content.innerHTML = `
      <div class="progress-bar" style="margin-bottom:20px;">
        <div class="progress-fill" style="width:${(currentQ / shuffled.length) * 100}%"></div>
      </div>
      <div style="text-align:center; margin-bottom:8px; font-size:0.85rem; color:var(--text-muted);">
        ${currentQ + 1} / ${shuffled.length}
      </div>

      <div class="card" style="text-align:center; padding:24px 16px; margin-bottom:20px;">
        <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:8px;">请选择正确的词义</div>
        <div style="font-family:var(--font-thai); font-size:2rem; font-weight:700; margin-bottom:8px;">${escapeHtml(q.word.thai)}</div>
      </div>

      <div class="quiz-options" id="quiz-options">
        ${options.map((opt, i) => `
          <button class="quiz-option" data-idx="${i}" data-correct="${opt.correct}">
            <span>${escapeHtml(opt.word.meaning)}</span>
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
