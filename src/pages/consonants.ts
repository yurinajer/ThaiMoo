import { createElement, escapeHtml, shuffleArray } from '../lib/utils';
import { getAllConsonants } from '../lib/tone-engine';
import { showSuccess, showError } from '../components/toast';

export async function renderConsonantsPage(container: HTMLElement): Promise<void> {
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `
    <button class="back-btn" onclick="window.location.hash='/more'">←</button>
    <h1>🔤 辅音分类</h1>
  `;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  const consonants = await getAllConsonants();

  content.innerHTML = `
    <div class="tabs" id="consonant-tabs">
      <button class="tab active" data-class="mid">中辅音 (${consonants.mid.length})</button>
      <button class="tab" data-class="high">高辅音 (${consonants.high.length})</button>
      <button class="tab" data-class="low">低辅音 (${consonants.low.length})</button>
    </div>

    <div id="consonant-grid"></div>

    <div style="margin-top:24px;">
      <button class="btn btn-primary btn-block" id="btn-quiz">开始辅音测验</button>
    </div>

    <div class="card" style="margin-top:16px; background:var(--orange-50); border-color:var(--orange-200);">
      <div style="font-size:0.85rem; color:var(--text-secondary);">
        <div style="font-weight:600; margin-bottom:4px;">💡 提示</div>
        <div>• ห 引导：ห + 低辅音 → 按高辅音规则处理</div>
        <div>• 点击卡片可查看详细信息</div>
      </div>
    </div>
  `;

  const grid = content.querySelector('#consonant-grid') as HTMLElement;

  function renderGrid(cls: 'mid' | 'high' | 'low') {
    const list = consonants[cls];
    grid.innerHTML = `
      <div class="grid-3" style="gap:8px;">
        ${list.map(c => `
          <div class="consonant-card ${cls}" data-char="${c.char}" data-name="${escapeHtml(c.name)}" data-pron="${escapeHtml(c.pronunciation)}" data-meaning="${escapeHtml(c.meaning)}">
            <div class="char">${c.char}</div>
            <div class="name">${c.pronunciation}</div>
          </div>
        `).join('')}
      </div>
    `;

    grid.querySelectorAll('.consonant-card').forEach(card => {
      card.addEventListener('click', () => {
        const char = card.getAttribute('data-char');
        const name = card.getAttribute('data-name');
        const pron = card.getAttribute('data-pron');
        const meaning = card.getAttribute('data-meaning');
        showConsonantDetail(char!, name!, pron!, meaning!, cls);
      });
    });
  }

  function showConsonantDetail(char: string, name: string, pron: string, meaning: string, cls: string) {
    const overlay = createElement('div', { className: 'modal-overlay' });
    overlay.innerHTML = `
      <div class="modal-content" style="text-align:center;">
        <div class="modal-header">
          <h2>辅音详情</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="consonant-card ${cls}" style="margin:16px auto; width:120px; height:120px; font-size:3rem; cursor:default;">
          <div class="char" style="font-size:3rem;">${char}</div>
        </div>
        <div style="margin-bottom:8px;">
          <span style="font-size:0.85rem; color:var(--text-muted);">名称：</span>
          <span style="font-family:var(--font-thai);">${escapeHtml(name)}</span>
        </div>
        <div style="margin-bottom:8px;">
          <span style="font-size:0.85rem; color:var(--text-muted);">发音：</span>
          <span style="font-weight:600;">${escapeHtml(pron)}</span>
        </div>
        <div style="margin-bottom:8px;">
          <span style="font-size:0.85rem; color:var(--text-muted);">含义：</span>
          <span>${escapeHtml(meaning)}</span>
        </div>
        <div style="margin-top:12px;">
          <span class="tag ${cls === 'mid' ? 'tag-tone' : cls === 'high' ? 'tag-error' : ''}" style="${cls === 'low' ? 'background:#e3f2fd; color:#1565c0; border-color:#90caf9;' : ''}">
            ${cls === 'mid' ? '中辅音' : cls === 'high' ? '高辅音' : '低辅音'}
          </span>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  content.querySelectorAll('#consonant-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      content.querySelectorAll('#consonant-tabs .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderGrid(tab.getAttribute('data-class') as 'mid' | 'high' | 'low');
    });
  });

  renderGrid('mid');

  content.querySelector('#btn-quiz')!.addEventListener('click', () => {
    startConsonantQuiz(content, consonants);
  });
}

function startConsonantQuiz(content: HTMLElement, consonants: { mid: any[]; high: any[]; low: any[] }) {
  const allConsonants = [
    ...consonants.mid.map(c => ({ ...c, class: 'mid' as const })),
    ...consonants.high.map(c => ({ ...c, class: 'high' as const })),
    ...consonants.low.map(c => ({ ...c, class: 'low' as const })),
  ];

  const questions = shuffleArray(allConsonants).slice(0, 10);
  let currentQ = 0;
  let correct = 0;

  function renderQuizQuestion() {
    if (currentQ >= questions.length) {
      content.innerHTML = `
        <div class="card" style="text-align:center; margin-top:40px;">
          <div style="font-size:3rem; margin-bottom:16px;">🔤</div>
          <div style="font-size:1.1rem; font-weight:600;">测验完成！</div>
          <div style="font-size:2.5rem; font-weight:700; color:var(--orange-500); margin:16px 0;">
            ${Math.round((correct / questions.length) * 100)}%
          </div>
          <div style="color:var(--text-secondary);">答对 ${correct} / ${questions.length}</div>
        </div>
        <div style="margin-top:24px; display:flex; gap:12px;">
          <a href="#/more" class="btn btn-secondary" style="flex:1;">返回</a>
          <button class="btn btn-primary" style="flex:1;" onclick="window.location.hash='/consonants'">再来一次</button>
        </div>
      `;
      return;
    }

    const q = questions[currentQ];
    const options = shuffleArray(['mid', 'high', 'low'] as const);

    content.innerHTML = `
      <div class="progress-bar" style="margin-bottom:20px;">
        <div class="progress-fill" style="width:${(currentQ / questions.length) * 100}%"></div>
      </div>
      <div style="text-align:center; margin-bottom:8px; font-size:0.85rem; color:var(--text-muted);">
        ${currentQ + 1} / ${questions.length}
      </div>

      <div class="card" style="text-align:center; padding:32px 16px; margin-bottom:20px;">
        <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:8px;">这个辅音属于哪一类？</div>
        <div style="font-family:var(--font-thai); font-size:4rem; font-weight:700; color:var(--brown-800);">${q.char}</div>
      </div>

      <div class="quiz-options" id="quiz-options">
        <button class="quiz-option" data-answer="mid">
          <span style="width:24px; height:24px; border-radius:50%; background:#a5d6a7;"></span>
          <span>中辅音</span>
        </button>
        <button class="quiz-option" data-answer="high">
          <span style="width:24px; height:24px; border-radius:50%; background:#ef9a9a;"></span>
          <span>高辅音</span>
        </button>
        <button class="quiz-option" data-answer="low">
          <span style="width:24px; height:24px; border-radius:50%; background:#90caf9;"></span>
          <span>低辅音</span>
        </button>
      </div>
    `;

    content.querySelectorAll('.quiz-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const answer = btn.getAttribute('data-answer')!;
        const isCorrect = answer === q.class;

        content.querySelectorAll('.quiz-option').forEach(b => {
          (b as HTMLElement).style.pointerEvents = 'none';
          if (b.getAttribute('data-answer') === q.class) b.classList.add('correct');
        });

        if (!isCorrect) {
          btn.classList.add('wrong');
        } else {
          correct++;
        }

        setTimeout(() => {
          currentQ++;
          renderQuizQuestion();
        }, 1000);
      });
    });
  }

  renderQuizQuestion();
}
