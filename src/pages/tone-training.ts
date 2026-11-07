import { createElement, escapeHtml, shuffleArray } from '../lib/utils';
import { deriveTone, getToneOptions, getAllConsonants } from '../lib/tone-engine';
import { getAllWords, type Word } from '../db/vocabulary';
import { addErrorRecord } from '../db/errors';
import { showSuccess, showError } from '../components/toast';

export async function renderToneTrainingPage(container: HTMLElement): Promise<void> {
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `
    <button class="back-btn" onclick="window.location.hash='/more'">←</button>
    <h1>🍊 声调规则训练</h1>
  `;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  const words = await getAllWords();
  const toneOptions = await getToneOptions();

  if (words.length === 0) {
    content.innerHTML = `
      <div class="empty-state" style="margin-top:40px;">
        <span class="emoji">🍊</span>
        <p>词库为空，请先添加单词</p>
        <a href="#/vocabulary" class="btn btn-primary" style="margin-top:16px;">去添加</a>
      </div>
    `;
    return;
  }

  let currentIndex = 0;
  let correctCount = 0;
  const shuffledWords = shuffleArray(words).slice(0, Math.min(20, words.length));

  function renderQuestion() {
    if (currentIndex >= shuffledWords.length) {
      renderResult(container, correctCount, shuffledWords.length);
      return;
    }

    const word = shuffledWords[currentIndex];
    content.innerHTML = `
      <div class="progress-bar" style="margin-bottom:20px;">
        <div class="progress-fill" style="width:${(currentIndex / shuffledWords.length) * 100}%"></div>
      </div>
      <div style="text-align:center; margin-bottom:8px; font-size:0.85rem; color:var(--text-muted);">
        ${currentIndex + 1} / ${shuffledWords.length}
      </div>

      <div class="card" style="text-align:center; padding:32px 16px; margin-bottom:20px;">
        <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:8px;">请判断以下泰文词的声调</div>
        <div class="thai-text-lg" style="margin-bottom:12px;">${escapeHtml(word.thai)}</div>
        <div style="font-size:0.9rem; color:var(--text-secondary);">${escapeHtml(word.meaning)}</div>
      </div>

      <div class="quiz-options" id="tone-options">
        ${toneOptions.map(t => `
          <button class="quiz-option" data-tone="${t.id}">
            <span style="font-size:1.2rem; width:24px;">${t.symbol}</span>
            <span>${t.name}</span>
          </button>
        `).join('')}
      </div>

      <div id="tone-result" style="display:none; margin-top:16px;"></div>
    `;

    content.querySelectorAll('.quiz-option').forEach(btn => {
      btn.addEventListener('click', async () => {
        const selected = btn.getAttribute('data-tone')!;
        const correct = word.toneMark || 'mid';
        const isCorrect = selected === correct;

        content.querySelectorAll('.quiz-option').forEach(b => {
          (b as HTMLElement).style.pointerEvents = 'none';
          if (b.getAttribute('data-tone') === correct) {
            b.classList.add('correct');
          }
        });

        if (!isCorrect) {
          btn.classList.add('wrong');
          await addErrorRecord(word.id!, 'tone', word.thai, selected, correct);
        } else {
          correctCount++;
        }

        const derivation = await deriveTone(word.thai);
        const resultDiv = content.querySelector('#tone-result') as HTMLElement;
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = `
          <div class="card" style="background:${isCorrect ? '#e8f5e9' : '#ffebee'}; border-color:${isCorrect ? '#a5d6a7' : '#ef9a9a'};">
            <div style="font-weight:600; margin-bottom:8px; color:${isCorrect ? '#2e7d32' : '#c62828'};">
              ${isCorrect ? '✓ 正确！' : '✗ 错误'}
              ${!isCorrect ? `正确答案：${toneOptions.find(t => t.id === correct)?.name || correct}` : ''}
            </div>
            ${derivation ? `
              <div style="font-size:0.85rem; color:var(--text-secondary); margin-top:8px;">
                <div style="font-weight:500; margin-bottom:4px;">推导过程：</div>
                ${derivation.steps.map(s => `<div style="padding:2px 0;">${escapeHtml(s)}</div>`).join('')}
                <div style="margin-top:4px; font-weight:600; color:var(--orange-500);">→ ${derivation.resultName}</div>
              </div>
            ` : ''}
          </div>
          <button class="btn btn-primary btn-block" id="btn-next" style="margin-top:12px;">
            ${currentIndex < shuffledWords.length - 1 ? '下一题 →' : '查看结果'}
          </button>
        `;

        resultDiv.querySelector('#btn-next')!.addEventListener('click', () => {
          currentIndex++;
          renderQuestion();
        });
      });
    });
  }

  renderQuestion();
}

function renderResult(container: HTMLElement, correct: number, total: number): void {
  const percent = total > 0 ? Math.round((correct / total) * 100) : 0;
  const content = container.querySelector('.page-content') as HTMLElement;

  content.innerHTML = `
    <div class="card" style="text-align:center; margin-top:40px;">
      <div style="font-size:3rem; margin-bottom:16px;">🍊</div>
      <div style="font-size:1.1rem; font-weight:600;">声调训练完成！</div>
      <div style="font-size:2.5rem; font-weight:700; color:var(--orange-500); margin:16px 0;">${percent}%</div>
      <div style="color:var(--text-secondary);">答对 ${correct} / ${total}</div>
    </div>
    <div style="margin-top:24px; display:flex; gap:12px;">
      <a href="#/more" class="btn btn-secondary" style="flex:1;">返回</a>
      <button class="btn btn-primary" style="flex:1;" onclick="window.location.hash='/tone-training'">再来一次</button>
    </div>
  `;
}
