import { createElement, escapeHtml, shuffleArray } from '../lib/utils';
import { db, type MinimalPairGroup, type Word } from '../db/index';
import { getAllWords } from '../db/vocabulary';
import { addErrorRecord } from '../db/errors';
import { showSuccess, showError } from '../components/toast';

type QuizMode = 'thai-to-meaning' | 'meaning-to-thai';
interface QuizQuestion {
  word: Word;
  groupWords: Word[];
}

export async function renderMinimalPairsPage(container: HTMLElement): Promise<void> {
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `
    <button class="back-btn" onclick="window.location.hash='/more'">←</button>
    <h1>易混淆词</h1>
  `;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  const groups = await db.minimalPairGroups.toArray();
  const allWords = await getAllWords();

  content.innerHTML = `
    <div style="display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-bottom:16px;">
      <div class="card" style="text-align:center; padding:14px;"><div class="summary-value" style="font-size:1.6rem; font-weight:700;">${groups.length}</div><div style="font-size:0.8rem; color:var(--text-muted);">对比组</div></div>
      <div class="card" style="text-align:center; padding:14px;"><div class="summary-value" style="font-size:1.6rem; font-weight:700;">${new Set(groups.flatMap(g => g.wordIds)).size}</div><div style="font-size:0.8rem; color:var(--text-muted);">关联单词</div></div>
    </div>
    <div style="display:flex; gap:8px; margin-bottom:20px;">
      <button class="btn btn-primary btn-sm" id="btn-add-group" style="flex:1;">＋ 新建对比组</button>
    </div>
    <div style="font-weight:600; margin-bottom:10px;">我的对比组</div>
    <div id="groups-list"></div>
    <div class="card" style="margin-top:20px;">
      <div style="font-weight:600; margin-bottom:6px;">开始辨析练习</div>
      <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:12px;">从已创建的对比组中随机抽题，每轮最多 10 题。</div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-primary btn-sm" id="btn-quiz-forward" style="flex:1;">泰文 → 中文</button>
        <button class="btn btn-secondary btn-sm" id="btn-quiz-reverse" style="flex:1;">中文 → 泰文</button>
      </div>
    </div>
  `;

  const groupsList = content.querySelector('#groups-list') as HTMLElement;

  function renderGroups(): void {
    if (groups.length === 0) {
      groupsList.innerHTML = `
        <div class="empty-state">
          <span class="emoji">🍊</span>
          <p>还没有对比组</p>
          <p style="font-size:0.85rem; color:var(--text-muted); margin-top:8px;">点击“新建对比组”，把容易混淆的泰语单词放在一起练习。</p>
        </div>`;
      return;
    }

    groupsList.innerHTML = groups.map(group => {
      const wordsInGroup = group.wordIds
        .map(id => allWords.find(word => word.id === id))
        .filter((word): word is Word => Boolean(word));
      const staleCount = group.wordIds.length - wordsInGroup.length;
      return `
        <div class="card" style="margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px;">
            <div style="font-weight:600; min-width:0;">${escapeHtml(group.name)}</div>
            <div style="display:flex; gap:4px; flex-shrink:0;">
              <button class="btn btn-sm btn-secondary" data-edit="${group.id}" aria-label="编辑对比组">编辑</button>
              <button class="btn btn-icon" data-delete="${group.id}" aria-label="删除对比组" style="color:var(--red-400);">✕</button>
            </div>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:8px;">
            ${wordsInGroup.map(word => `
              <div style="padding:8px 12px; background:var(--orange-50); border-radius:8px; border:1px solid var(--orange-200);">
                <span style="font-family:var(--font-thai); font-weight:600;">${escapeHtml(word.thai)}</span>
                <span style="font-size:0.8rem; color:var(--text-muted); margin-left:4px;">${escapeHtml(word.meaning)}</span>
              </div>
            `).join('')}
          </div>
          ${wordsInGroup.length < 2 ? '<div style="font-size:0.8rem; color:var(--red-400); margin-top:8px;">有效单词不足 2 个，暂时不能练习，请编辑此组。</div>' : ''}
          ${staleCount > 0 ? `<div style="font-size:0.8rem; color:var(--text-muted); margin-top:8px;">有 ${staleCount} 个关联单词已从词库删除，编辑并保存可清理关联。</div>` : ''}
        </div>`;
    }).join('');

    groupsList.querySelectorAll<HTMLElement>('[data-delete]').forEach(button => {
      button.addEventListener('click', async () => {
        const id = Number(button.dataset.delete);
        if (!Number.isFinite(id)) return;
        if (!confirm('确定删除此对比组？此操作不会删除词库中的单词。')) return;
        await db.minimalPairGroups.delete(id);
        const index = groups.findIndex(group => group.id === id);
        if (index >= 0) groups.splice(index, 1);
        renderGroups();
        updateSummary();
        showSuccess('对比组已删除');
      });
    });

    groupsList.querySelectorAll<HTMLElement>('[data-edit]').forEach(button => {
      button.addEventListener('click', () => {
        const id = Number(button.dataset.edit);
        const group = groups.find(item => item.id === id);
        if (group) showGroupModal(allWords, groups, renderGroups, updateSummary, group);
      });
    });
  }

  function updateSummary(): void {
    const values = content.querySelectorAll('.summary-value');
    if (values[0]) values[0].textContent = String(groups.length);
    if (values[1]) values[1].textContent = String(new Set(groups.flatMap(group => group.wordIds)).size);
  }

  content.querySelector('#btn-add-group')!.addEventListener('click', () =>
    showGroupModal(allWords, groups, renderGroups, updateSummary)
  );
  content.querySelector('#btn-quiz-forward')!.addEventListener('click', () =>
    startMinimalPairQuiz(content, groups, allWords, 'thai-to-meaning')
  );
  content.querySelector('#btn-quiz-reverse')!.addEventListener('click', () =>
    startMinimalPairQuiz(content, groups, allWords, 'meaning-to-thai')
  );

  renderGroups();
}

function showGroupModal(
  allWords: Word[],
  groups: MinimalPairGroup[],
  onSave: () => void,
  onSummaryUpdate: () => void,
  editingGroup?: MinimalPairGroup,
): void {
  const selectedIds = new Set<number>(editingGroup?.wordIds ?? []);
  const overlay = createElement('div', { className: 'modal-overlay' });
  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>${editingGroup ? '编辑对比组' : '新建对比组'}</h2>
        <button class="modal-close" aria-label="关闭">&times;</button>
      </div>
      <div class="input-group">
        <label class="input-label" for="group-name">组名</label>
        <input class="input" id="group-name" maxlength="40" placeholder="如：长短音 a/aa" value="${escapeAttribute(editingGroup?.name ?? '')}" />
      </div>
      <div class="input-group">
        <label class="input-label" for="word-search">选择单词（至少 2 个）</label>
        <input class="input" id="word-search" placeholder="搜索泰文或中文释义" />
        <div id="word-checkboxes" style="max-height:240px; overflow-y:auto; border:1px solid var(--border-light); border-radius:8px; padding:8px; margin-top:8px;"></div>
        <div id="selected-count" style="font-size:0.8rem; color:var(--text-muted); margin-top:6px;"></div>
      </div>
      <button class="btn btn-primary btn-block" id="btn-save-group">${editingGroup ? '保存修改' : '创建对比组'}</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const list = overlay.querySelector('#word-checkboxes') as HTMLElement;
  const search = overlay.querySelector('#word-search') as HTMLInputElement;
  const count = overlay.querySelector('#selected-count') as HTMLElement;

  function renderWordOptions(): void {
    const query = search.value.trim().toLowerCase();
    const filtered = allWords.filter(word =>
      word.thai.toLowerCase().includes(query) || word.meaning.toLowerCase().includes(query)
    );
    list.innerHTML = filtered.map(word => `
      <label style="display:flex; align-items:center; gap:8px; padding:6px 2px; cursor:pointer;">
        <input type="checkbox" value="${word.id}" ${word.id !== undefined && selectedIds.has(word.id) ? 'checked' : ''} />
        <span style="font-family:var(--font-thai); font-weight:500;">${escapeHtml(word.thai)}</span>
        <span style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(word.meaning)}</span>
      </label>
    `).join('') || '<div style="padding:12px; color:var(--text-muted); text-align:center;">没有找到单词</div>';
    count.textContent = `已选择 ${selectedIds.size} 个单词`;
  }

  renderWordOptions();
  search.addEventListener('input', renderWordOptions);
  list.addEventListener('change', event => {
    const target = event.target as HTMLInputElement;
    if (target.type !== 'checkbox') return;
    const id = Number(target.value);
    if (target.checked) selectedIds.add(id);
    else selectedIds.delete(id);
    count.textContent = `已选择 ${selectedIds.size} 个单词`;
  });

  const close = (): void => overlay.remove();
  overlay.querySelector('.modal-close')!.addEventListener('click', close);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });

  overlay.querySelector('#btn-save-group')!.addEventListener('click', async () => {
    const name = (overlay.querySelector('#group-name') as HTMLInputElement).value.trim();
    const wordIds = allWords
      .filter(word => word.id !== undefined && selectedIds.has(word.id))
      .map(word => word.id!);
    if (!name) { showError('请输入组名'); return; }
    if (wordIds.length < 2) { showError('请至少选择 2 个有效单词'); return; }

    if (editingGroup?.id !== undefined) {
      await db.minimalPairGroups.update(editingGroup.id, { name, wordIds });
      editingGroup.name = name;
      editingGroup.wordIds = wordIds;
      showSuccess('对比组已更新');
    } else {
      const group: MinimalPairGroup = { name, wordIds, createdAt: Date.now() };
      group.id = await db.minimalPairGroups.add(group);
      groups.push(group);
      showSuccess('对比组创建成功');
    }
    close();
    onSave();
    onSummaryUpdate();
  });
}

function startMinimalPairQuiz(
  content: HTMLElement,
  groups: MinimalPairGroup[],
  allWords: Word[],
  mode: QuizMode,
): void {
  const questions: QuizQuestion[] = [];
  for (const group of groups) {
    const groupWords = group.wordIds
      .map(id => allWords.find(word => word.id === id))
      .filter((word): word is Word => Boolean(word));
    if (groupWords.length < 2) continue;
    for (const word of groupWords) {
      questions.push({ word, groupWords: groupWords.filter(other => other.id !== word.id) });
    }
  }

  const shuffled = shuffleArray(questions).slice(0, Math.min(10, questions.length));
  if (shuffled.length === 0) {
    showError('没有可练习的有效对比组，请检查每组是否至少包含 2 个词库单词');
    return;
  }

  let currentQ = 0;
  let correct = 0;
  let answered = false;

  function renderQuizQuestion(): void {
    if (currentQ >= shuffled.length) {
      const accuracy = Math.round((correct / shuffled.length) * 100);
      content.innerHTML = `
        <div class="card" style="text-align:center; margin-top:40px;">
          <div style="font-size:3rem; margin-bottom:16px;">👂</div>
          <div style="font-size:1.1rem; font-weight:600;">练习完成！</div>
          <div style="font-size:2.5rem; font-weight:700; color:var(--orange-500); margin:16px 0;">${accuracy}%</div>
          <div style="color:var(--text-secondary);">答对 ${correct} / ${shuffled.length}</div>
          <div style="font-size:0.85rem; color:var(--text-muted); margin-top:8px;">${mode === 'thai-to-meaning' ? '泰文 → 中文' : '中文 → 泰文'} · 答错的单词已记录到错题本</div>
        </div>
        <div style="margin-top:24px;">
          <button class="btn btn-primary btn-block" id="btn-quiz-again" style="margin-bottom:8px;">再练一次</button>
          <a href="#/minimal-pairs" class="btn btn-secondary btn-block">返回易混淆词</a>
        </div>`;
      content.querySelector('#btn-quiz-again')!.addEventListener('click', () =>
        startMinimalPairQuiz(content, groups, allWords, mode)
      );
      return;
    }

    answered = false;
    const question = shuffled[currentQ];
    const options = shuffleArray([
      { word: question.word, correct: true },
      ...question.groupWords.map(word => ({ word, correct: false })),
    ]);
    const prompt = mode === 'thai-to-meaning' ? question.word.thai : question.word.meaning;
    const instruction = mode === 'thai-to-meaning' ? '请选择正确的中文释义' : '请选择对应的泰语单词';

    content.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <button class="btn btn-sm btn-secondary" id="btn-quit-quiz">退出练习</button>
        <span style="font-size:0.85rem; color:var(--text-muted);">${mode === 'thai-to-meaning' ? '泰文 → 中文' : '中文 → 泰文'}</span>
      </div>
      <div class="progress-bar" style="margin-bottom:16px;"><div class="progress-fill" style="width:${(currentQ / shuffled.length) * 100}%"></div></div>
      <div style="text-align:center; margin-bottom:8px; font-size:0.85rem; color:var(--text-muted);">第 ${currentQ + 1} / ${shuffled.length} 题</div>
      <div class="card" style="text-align:center; padding:28px 16px; margin-bottom:20px;">
        <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:12px;">${instruction}</div>
        <div style="font-family:${mode === 'thai-to-meaning' ? 'var(--font-thai)' : 'var(--font-cn)'}; font-size:2rem; font-weight:700;">${escapeHtml(prompt)}</div>
      </div>
      <div class="quiz-options" id="quiz-options">
        ${options.map((option, index) => `
          <button class="quiz-option" data-correct="${option.correct}" data-answer="${escapeAttribute(mode === 'thai-to-meaning' ? option.word.meaning : option.word.thai)}">
            <span>${escapeHtml(mode === 'thai-to-meaning' ? option.word.meaning : option.word.thai)}</span>
          </button>
        `).join('')}
      </div>
      <div id="quiz-feedback" aria-live="polite" style="min-height:24px; margin-top:12px; text-align:center; font-size:0.9rem;"></div>
    `;

    content.querySelector('#btn-quit-quiz')!.addEventListener('click', () => {
      window.location.hash = '/minimal-pairs';
    });

    content.querySelectorAll<HTMLButtonElement>('.quiz-option').forEach(button => {
      button.addEventListener('click', async () => {
        if (answered) return;
        answered = true;
        const isCorrect = button.dataset.correct === 'true';
        const feedback = content.querySelector('#quiz-feedback') as HTMLElement;
        const correctOption = content.querySelector('.quiz-option[data-correct="true"]') as HTMLButtonElement | null;
        content.querySelectorAll<HTMLButtonElement>('.quiz-option').forEach(option => {
          option.disabled = true;
          if (option.dataset.correct === 'true') option.classList.add('correct');
        });

        if (isCorrect) {
          correct++;
          feedback.textContent = '回答正确！';
          feedback.style.color = 'var(--green-500)';
        } else {
          button.classList.add('wrong');
          feedback.textContent = `正确答案：${correctOption?.textContent?.trim() ?? ''}`;
          feedback.style.color = 'var(--red-400)';
          const userAnswer = button.dataset.answer ?? '';
          const correctAnswer = mode === 'thai-to-meaning' ? question.word.meaning : question.word.thai;
          if (question.word.id !== undefined) {
            try {
              await addErrorRecord(
                question.word.id,
                'minimal-pair',
                `${mode === 'thai-to-meaning' ? '泰文→中文' : '中文→泰文'}：${question.word.thai}`,
                userAnswer,
                correctAnswer,
              );
            } catch (error) {
              console.error('记录易混淆词错题失败：', error);
            }
          }
        }

        window.setTimeout(() => {
          currentQ++;
          renderQuizQuestion();
        }, 1000);
      });
    });
  }

  renderQuizQuestion();
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
}
