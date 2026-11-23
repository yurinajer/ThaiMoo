import { createElement, escapeHtml, toneTagsHtml } from '../lib/utils';
import { getAllWords, type Word } from '../db/vocabulary';
import { setLeaveGuard } from '../lib/route-guard';
import {
  ALL_CATEGORIES, DEFAULT_SETTINGS, answerText, buildCategoryOptions, canMark, createSession,
  currentCard, filterByCategory, frontText, goNext, goPrev, isFirstCard, isLastCard,
  keepUnknownOnly, markOf, positionOf, restartSession, reshuffleSession, revealCard, setMark,
  statsOf, unknownCards,
  type SpeedDirection, type SpeedMark, type SpeedOrder, type SpeedSession, type SpeedSettings,
} from '../lib/speedbrush';

type SpeedView = 'setup' | 'brushing' | 'done';

const ROUTE = '/speedbrush';
const EXIT_TEXT = '退出本次速刷？不认识名单和本次统计都会清空。';

// 速刷只活在内存里：路由离开即作废，所以设置项放模块级，重新进来还认得上次的筛选。
let settings: SpeedSettings = { ...DEFAULT_SETTINGS };
let session: SpeedSession | null = null;
let view: SpeedView = 'setup';
let library: Word[] = [];
let unloadBound = false;

function disarmGuard(): void {
  setLeaveGuard(null);
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (view !== 'brushing') return;
  // 浏览器不给自定义文案，能拦住手滑刷新就够了。
  event.preventDefault();
  event.returnValue = '';
}

// 只有刷词中的会话会丢东西：设置页和结束页离开了重新开始即可。
function armGuard(): void {
  view = 'brushing';
  setLeaveGuard(from => {
    if (from !== ROUTE || view !== 'brushing') return true;
    const ok = confirm(EXIT_TEXT);
    if (ok) {
      session = null;
      disarmGuard();
    }
    return ok;
  });
  if (!unloadBound) {
    window.addEventListener('beforeunload', onBeforeUnload);
    unloadBound = true;
  }
}

function rateText(rate: number | null): string {
  return rate === null ? '—' : `${rate}%`;
}

export async function renderSpeedbrushPage(container: HTMLElement): Promise<void> {
  library = await getAllWords();
  if (view === 'brushing' && session && session.cards.length > 0) {
    renderBrushing(container);
  } else {
    session = null;
    renderSetup(container);
  }
}

function renderSetup(container: HTMLElement): void {
  view = 'setup';
  disarmGuard();
  session = null;

  if (library.length === 0) {
    container.innerHTML = `
      <div class="page-header"><h1>单词速刷</h1></div>
      <div class="page-content">
        <div class="empty-state" style="margin-top:60px;">
          <p>词库还是空的</p>
          <p style="font-size:0.85rem; color:var(--text-muted); margin-top:8px;">先添加或导入单词，再来速刷</p>
          <a href="#/vocabulary" class="btn btn-primary" style="margin-top:16px;">去词库</a>
        </div>
      </div>
    `;
    return;
  }

  const categories = buildCategoryOptions(library);

  container.innerHTML = `
    <div class="page-header"><h1>单词速刷</h1></div>
    <div class="page-content">
      <div class="card">
        <div style="font-weight:600; font-size:0.9rem; margin-bottom:6px;">直接读现有词库</div>
        <div style="font-size:0.85rem; color:var(--text-muted); line-height:1.6;">
          速刷不排期、不评分，认识与否只记在这次会话里，不进复习队列，也不改任何复习统计。
        </div>
      </div>

      ${categories.length > 1 ? `
        <div class="section-title" style="margin-top:20px;">分类</div>
        <div class="chip-group" id="sb-cats">
          ${categories.map(cat => `
            <button class="chip${cat.name === settings.category ? ' selected' : ''}" data-cat="${escapeHtml(cat.name)}">${escapeHtml(cat.name || '全部')} ${cat.count}</button>
          `).join('')}
        </div>
      ` : ''}

      <div class="section-title" style="margin-top:20px;">方向</div>
      <div class="tabs" id="sb-direction">
        <button class="tab${settings.direction === 'thai-to-cn' ? ' active' : ''}" data-direction="thai-to-cn">泰语 → 中文</button>
        <button class="tab${settings.direction === 'cn-to-thai' ? ' active' : ''}" data-direction="cn-to-thai">中文 → 泰语</button>
      </div>

      <div class="section-title">顺序</div>
      <div class="tabs" id="sb-order">
        <button class="tab${settings.order === 'original' ? ' active' : ''}" data-order="original">原始顺序</button>
        <button class="tab${settings.order === 'random' ? ' active' : ''}" data-order="random">随机顺序</button>
      </div>

      <div class="section-title">刷词方式</div>
      <div class="chip-group">
        <button class="chip${settings.autoAdvance ? ' selected' : ''}" id="sb-auto" aria-pressed="${settings.autoAdvance}">答完自动下一张</button>
      </div>

      <button class="btn btn-primary btn-block btn-lg" id="sb-start" style="margin-top:24px;"></button>
      <p class="review-cap-notice" id="sb-hint"></p>
    </div>
  `;

  const startBtn = container.querySelector('#sb-start') as HTMLButtonElement;
  const hint = container.querySelector('#sb-hint') as HTMLElement;

  const syncStart = () => {
    const count = filterByCategory(library, settings.category).length;
    startBtn.textContent = `开始速刷（${count} 张）`;
    startBtn.disabled = count === 0;
    hint.textContent = count === 0 ? '该分类下没有单词，换一个分类' : '';
  };

  container.querySelectorAll('#sb-cats .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      container.querySelectorAll('#sb-cats .chip').forEach(other => other.classList.remove('selected'));
      chip.classList.add('selected');
      settings = { ...settings, category: chip.getAttribute('data-cat') ?? ALL_CATEGORIES };
      syncStart();
    });
  });

  container.querySelectorAll('#sb-direction .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('#sb-direction .tab').forEach(other => other.classList.remove('active'));
      tab.classList.add('active');
      settings = { ...settings, direction: tab.getAttribute('data-direction') as SpeedDirection };
    });
  });

  container.querySelectorAll('#sb-order .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('#sb-order .tab').forEach(other => other.classList.remove('active'));
      tab.classList.add('active');
      settings = { ...settings, order: tab.getAttribute('data-order') as SpeedOrder };
    });
  });

  const autoChip = container.querySelector('#sb-auto')!;
  autoChip.addEventListener('click', () => {
    settings = { ...settings, autoAdvance: !settings.autoAdvance };
    autoChip.classList.toggle('selected', settings.autoAdvance);
    autoChip.setAttribute('aria-pressed', String(settings.autoAdvance));
  });

  startBtn.addEventListener('click', () => {
    const next = createSession(library, settings);
    if (next.cards.length === 0) return;
    session = next;
    renderBrushing(container);
  });

  syncStart();
}

// 卡面方向只问 frontText/answerText，切方向不需要在页面里再判一次方向。
function promptHtml(word: Word, isThaiFace: boolean): string {
  const toneTags = toneTagsHtml(word.toneMark);
  if (isThaiFace) {
    return `
      <div class="thai-text-lg" style="font-weight:500;">${escapeHtml(frontText(word, settings.direction))}</div>
      ${(word.romanization ?? '').trim() ? `<div class="card-roman">${escapeHtml(word.romanization!.trim())}</div>` : ''}
      ${toneTags ? `<div style="margin-top:8px;">${toneTags}</div>` : ''}
      <div class="flashcard-hint">回忆释义</div>
    `;
  }
  return `
    <div class="speed-answer">${escapeHtml(frontText(word, settings.direction))}</div>
    ${word.pos ? `<div class="speed-pos">${escapeHtml(word.pos)}</div>` : ''}
    <div class="flashcard-hint">回忆泰文</div>
  `;
}

// 背面只放词库里真实存在的字段，缺项直接不渲染，不编造英文释义。
function answerHtml(word: Word): string {
  const isThaiFace = settings.direction === 'cn-to-thai';
  const toneTags = toneTagsHtml(word.toneMark);
  const answer = isThaiFace
    ? `
      <div class="thai-text-lg" style="font-weight:500;">${escapeHtml(answerText(word, settings.direction))}</div>
      ${(word.romanization ?? '').trim() ? `<div class="card-roman">${escapeHtml(word.romanization!.trim())}</div>` : ''}
      ${toneTags ? `<div style="margin-top:8px;">${toneTags}</div>` : ''}
    `
    : `
      <div class="speed-answer">${escapeHtml(answerText(word, settings.direction))}</div>
      ${word.pos ? `<div class="speed-pos">${escapeHtml(word.pos)}</div>` : ''}
    `;
  return `
    ${answer}
    ${word.example ? `<div class="speed-example">${escapeHtml(word.example)}</div>` : ''}
    ${(word.exampleRoman ?? '').trim() ? `<div class="speed-roman">${escapeHtml(word.exampleRoman!.trim())}</div>` : ''}
    ${(word.exampleMeaning ?? '').trim() ? `<div class="speed-example-meaning">${escapeHtml(word.exampleMeaning!.trim())}</div>` : ''}
    ${word.note ? `<div class="speed-note-text">${escapeHtml(word.note)}</div>` : ''}
    ${word.tags.length ? `<div class="speed-tags">${word.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
    <div class="flashcard-hint">点击卡片可翻回</div>
  `;
}

function markSlotHtml(s: SpeedSession): string {
  if (!canMark(s)) {
    return `<button class="btn btn-primary btn-block btn-lg" id="sb-reveal">显示答案</button>`;
  }
  const mark = markOf(s);
  return `
    <div class="speed-marks">
      <button class="fsrs-btn speed-btn-unknown" data-mark="unknown" aria-pressed="${mark === 'unknown'}">不认识</button>
      <button class="fsrs-btn speed-btn-known" data-mark="known" aria-pressed="${mark === 'known'}">认识</button>
    </div>
  `;
}

function statsLine(s: SpeedSession): string {
  const stats = statsOf(s);
  return `
    <span>浏览 <b>${stats.viewed}</b></span>
    <span>认识 <b>${stats.known}</b></span>
    <span>不认识 <b>${stats.unknown}</b></span>
    <span>认识率 <b>${rateText(stats.knownRate)}</b></span>
  `;
}

function renderBrushing(container: HTMLElement): void {
  const s = session;
  if (!s || s.cards.length === 0) {
    renderSetup(container);
    return;
  }
  mountBrushing(container, s);
}

function mountBrushing(container: HTMLElement, s: SpeedSession): void {
  armGuard();

  container.innerHTML = '';
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `
    <button class="back-btn" id="sb-back" aria-label="返回设置">←</button>
    <h1>单词速刷</h1>
    <span class="speed-progress-text" id="sb-pos"></span>
  `;
  container.appendChild(header);
  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  header.querySelector('#sb-back')!.addEventListener('click', () => {
    if (confirm(EXIT_TEXT)) renderSetup(container);
  });

  // flipped 是卡面当前朝哪一面；revealed 是这张翻出过答案没有，回看已作答的词也允许改标。
  let flipped = false;

  const syncStats = () => {
    const host = content.querySelector('#sb-stats');
    if (host) host.innerHTML = statsLine(s);
  };

  const bindSlot = () => {
    const slot = content.querySelector('#sb-slot')!;
    slot.innerHTML = markSlotHtml(s);
    slot.querySelector('#sb-reveal')?.addEventListener('click', flip);
    slot.querySelectorAll('[data-mark]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mark = btn.getAttribute('data-mark') as SpeedMark;
        if (!setMark(s, mark)) return;
        slot.querySelectorAll('[data-mark]').forEach(other => {
          other.setAttribute('aria-pressed', String(other.getAttribute('data-mark') === mark));
        });
        syncStats();
        if (s.settings.autoAdvance) advance();
      });
    });
  };

  function flip() {
    const firstReveal = !s.revealed;
    if (firstReveal) revealCard(s);
    flipped = !flipped;
    (content.querySelector('#sb-card') as HTMLElement).classList.toggle('flipped', flipped);
    // 首次翻出答案才把作答按钮换上去；之后翻卡面只切换正反面。
    if (firstReveal) {
      bindSlot();
      syncStats();
    }
  }

  function advance() {
    if (isLastCard(s)) {
      renderDone(container);
      return;
    }
    goNext(s);
    paint();
  }

  function paint() {
    const card = currentCard(s)!;
    flipped = false;
    header.querySelector('#sb-pos')!.textContent = `${positionOf(s)} / ${s.cards.length}`;
    const percent = Math.round(((s.index + 1) / s.cards.length) * 100);
    content.innerHTML = `
      <div class="progress-bar"><div class="progress-fill" style="width:${percent}%"></div></div>
      <div class="speed-stats" id="sb-stats">${statsLine(s)}</div>
      <div class="flashcard speed-card" id="sb-card"><div class="flashcard-inner">
        <div class="flashcard-front">${promptHtml(card, settings.direction === 'thai-to-cn')}</div>
        <div class="flashcard-back">${answerHtml(card)}</div>
      </div></div>
      <div id="sb-slot">${markSlotHtml(s)}</div>
      <div class="speed-nav">
        <button class="btn btn-secondary" id="sb-prev"${isFirstCard(s) ? ' disabled' : ''}>上一张</button>
        <button class="btn btn-primary" id="sb-next">${isLastCard(s) ? '完成本轮' : '下一张'}</button>
      </div>
    `;
    content.querySelector('#sb-card')!.addEventListener('click', flip);
    bindSlot();
    content.querySelector('#sb-prev')!.addEventListener('click', () => {
      if (goPrev(s)) paint();
    });
    content.querySelector('#sb-next')!.addEventListener('click', advance);
  }

  paint();
}

function renderDone(container: HTMLElement): void {
  const s = session;
  if (!s) {
    renderSetup(container);
    return;
  }
  mountDone(container, s);
}

function mountDone(container: HTMLElement, s: SpeedSession): void {
  view = 'done';
  disarmGuard();

  const stats = statsOf(s);
  const rest = unknownCards(s).length;

  container.innerHTML = '';
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `<h1>本次速刷结束</h1>`;
  container.appendChild(header);
  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  content.innerHTML = `
    <div class="card" style="text-align:center; margin-top:24px;">
      <div style="font-size:0.85rem; color:var(--text-muted);">认识率</div>
      <div style="font-size:2.5rem; font-weight:700; color:var(--orange-500); margin:8px 0;">${rateText(stats.knownRate)}</div>
      <div class="speed-result">
        <div><div class="speed-result-value">${stats.viewed}</div><div class="speed-result-label">浏览</div></div>
        <div><div class="speed-result-value">${stats.known}</div><div class="speed-result-label">认识</div></div>
        <div><div class="speed-result-value">${stats.unknown}</div><div class="speed-result-label">不认识</div></div>
        <div><div class="speed-result-value">${stats.total}</div><div class="speed-result-label">本轮张数</div></div>
      </div>
    </div>

    ${stats.answered === 0 ? `<p class="review-cap-notice">还没有作答，认识率暂不计算</p>` : ''}

    <div class="speed-nav" style="margin-top:24px;">
      <button class="btn btn-secondary" id="sb-again">重新开始</button>
      <button class="btn btn-secondary" id="sb-shuffle">重新打乱</button>
      <button class="btn btn-primary" id="sb-unknown"${rest === 0 ? ' disabled' : ''}>只刷不认识${rest > 0 ? `（${rest}）` : ''}</button>
      <button class="btn btn-outline" id="sb-setup">返回设置</button>
    </div>
    ${rest === 0 ? `<p class="review-cap-notice">本轮没有标记「不认识」的词</p>` : ''}
  `;

  content.querySelector('#sb-again')!.addEventListener('click', () => {
    restartSession(s);
    renderBrushing(container);
  });
  content.querySelector('#sb-shuffle')!.addEventListener('click', () => {
    reshuffleSession(s);
    renderBrushing(container);
  });
  content.querySelector('#sb-unknown')!.addEventListener('click', () => {
    keepUnknownOnly(s);
    renderBrushing(container);
  });
  content.querySelector('#sb-setup')!.addEventListener('click', () => renderSetup(container));
}
