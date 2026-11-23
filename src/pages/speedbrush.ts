import { createElement, escapeHtml, toneTagsHtml } from '../lib/utils';
import { getAllWords, type Word } from '../db/vocabulary';
import { loadSpeedStatuses, saveSpeedStatus } from '../db/speedStatus';
import { setLeaveGuard } from '../lib/route-guard';
import { bindSpeakButton, speakButtonHtml } from '../components/card-speak';
import { clearSpeedProgress, loadSpeedProgress, saveSpeedProgress } from '../lib/speedProgress';
import {
  ALL_CATEGORIES, DEFAULT_SETTINGS, SCOPE_OPTIONS, answerText, buildCategoryOptions, buildScopeOptions,
  canMark, cardKey, createSession, currentCard, filterByCategory, filterByScope, frontText,
  goNext, goPrev, isFirstCard, isLastCard, keepUnknownOnly, markOf, positionOf,
  restartSession, reshuffleSession, restoreSession, revealCard, setMark, statsOf, unknownCards,
  type SpeedDirection, type SpeedMark, type SpeedOrder, type SpeedProgressRecord, type SpeedScope,
  type SpeedSession, type SpeedSettings, type SpeedStatusMap,
} from '../lib/speedbrush';

type SpeedView = 'setup' | 'brushing' | 'done';

const ROUTE = '/speedbrush';
const EXIT_TEXT = '退出本次速刷？本轮统计会清空，已保存的认识状态仍保留，位置也留着，下次进来接着刷。';

// 速刷只活在内存里：路由离开即作废，所以设置项放模块级，重新进来还认得上次的筛选。
let settings: SpeedSettings = { ...DEFAULT_SETTINGS };
let session: SpeedSession | null = null;
let view: SpeedView = 'setup';
let library: Word[] = [];
// 长期状态只在进页面时整表读一次：规模就是一个词几千行，逐张查库反而更慢。
let statuses: SpeedStatusMap = new Map();
// 上次退出留下的位置。整串 id 也就几十 KB，进页读一次，之后都在内存里换算。
let progress: SpeedProgressRecord | null = null;
let unloadBound = false;

function disarmGuard(): void {
  setLeaveGuard(null);
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (view !== 'brushing') return;
  // 浏览器不给自定义文案，能拦住手滑刷新就够了。
  if (session) persistProgress(session);
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
      // 位置先记下再丢会话：下次进来还是这张卡。
      if (session) persistProgress(session);
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

// 进度记的是整串 id 加当前下标：重新摇一次就不是同一份词单了，位置也就无从对起。
function persistProgress(s: SpeedSession): void {
  const record: SpeedProgressRecord = {
    ids: s.cards.map(word => cardKey(word)),
    index: s.index,
    settings: { ...s.settings },
    updatedAt: Date.now(),
  };
  saveSpeedProgress(record);
  progress = record;
}

function dropProgress(): void {
  clearSpeedProgress();
  progress = null;
}

// 当前筛选下能接上次的会话就接，接不上（筛选变了、词全删了、没记过）给 null，由调用方从头建。
function resumableSession(): SpeedSession | null {
  return progress ? restoreSession(library, progress, settings) : null;
}

function settingsSummary(s: SpeedSettings): string {
  const category = s.category === ALL_CATEGORIES ? '全部标签' : s.category;
  const scope = SCOPE_OPTIONS.find(opt => opt.scope === s.scope)?.label ?? s.scope;
  const order = s.order === 'random' ? '随机顺序' : '原始顺序';
  const direction = s.direction === 'thai-to-cn' ? '泰→中' : '中→泰';
  return `${category} · ${scope} · ${order} · ${direction}`;
}

function rateText(rate: number | null): string {
  return rate === null ? '—' : `${rate}%`;
}

export async function renderSpeedbrushPage(container: HTMLElement): Promise<void> {
  library = await getAllWords();
  statuses = await loadSpeedStatuses();
  progress = loadSpeedProgress();
  // 位置和筛选是一套记下来的：进页面先整套认回上次的筛选，
  // 「继续速刷」指向的才会是界面上选中的那一串。
  if (progress) settings = { ...progress.settings };
  if (view === 'brushing' && session && session.cards.length > 0) {
    renderBrushing(container);
  } else {
    session = null;
    renderSetup(container);
  }
}

// 标签和范围是两个独立维度，先按标签再按范围，两侧计数各取自己那一步的结果。
function poolWithinCategory(): Word[] {
  return filterByScope(filterByCategory(library, settings.category), settings.scope, statuses);
}

function emptyHint(): string {
  const catLabel = settings.category === ALL_CATEGORIES ? '' : `「${settings.category}」标签下`;
  if (settings.scope === 'unknown') {
    return `${catLabel}没有标记为「不认识」的单词；先去「全部单词」里标几个再来`;
  }
  if (settings.scope === 'unpracticed') {
    return `${catLabel}的单词都已标记过；可切换到「不认识」反复刷，或到「全部单词」改判`;
  }
  return '该分类下没有单词，换一个分类';
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

  // 分类的可选集合始终按整个词库给，计数才换成「当前范围 ∩ 该标签」的结果：
  // 范围一变就藏掉标签，用户可能连切回的范围都点不到。
  const scopePool = filterByScope(library, settings.scope, statuses);
  const scopeCounts = new Map(buildCategoryOptions(scopePool).map(opt => [opt.name, opt.count]));
  const categories = buildCategoryOptions(library).map(opt => ({ ...opt, count: scopeCounts.get(opt.name) ?? 0 }));
  const scopeOptions = buildScopeOptions(filterByCategory(library, settings.category), statuses);

  container.innerHTML = `
    <div class="page-header"><h1>单词速刷</h1></div>
    <div class="page-content">
      <details class="csv-spec">
        <summary class="csv-spec-title">速刷规则<span class="csv-spec-sub" id="sb-rules-sub"></span></summary>
        <div class="csv-spec-body">
          <div id="sb-resume"></div>
          <div class="speed-rules-text">
            速刷不排期、不评分：认识与否单独存进速刷状态，退出、刷新、关掉浏览器都还在，
            但不进复习队列，也不改任何复习统计。刷到第几张也记在浏览器本地，下次进来接着刷；
            「从头开始」只把位置挪回第一张，已保存的状态一个都不动。
          </div>
        </div>
      </details>

      ${categories.length > 1 ? `
        <div class="section-title" style="margin-top:20px;">分类</div>
        <div class="chip-group" id="sb-cats">
          ${categories.map(cat => `
            <button class="chip${cat.name === settings.category ? ' selected' : ''}" data-cat="${escapeHtml(cat.name)}">${escapeHtml(cat.name || '全部')} ${cat.count}</button>
          `).join('')}
        </div>
      ` : ''}

      <div class="section-title" style="margin-top:20px;">练习范围</div>
      <div class="chip-group" id="sb-scopes">
        ${scopeOptions.map(opt => `
          <button class="chip${opt.scope === settings.scope ? ' selected' : ''}" data-scope="${opt.scope}">${opt.label} ${opt.count}</button>
        `).join('')}
      </div>

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
      <button class="btn btn-secondary btn-block" id="sb-zero" style="margin-top:12px; display:none;">从头开始这一串</button>
      <p class="review-cap-notice" id="sb-hint"></p>
    </div>
  `;

  const startBtn = container.querySelector('#sb-start') as HTMLButtonElement;
  const zeroBtn = container.querySelector('#sb-zero') as HTMLButtonElement;
  const resumeBox = container.querySelector('#sb-resume') as HTMLElement;
  const rulesSub = container.querySelector('#sb-rules-sub') as HTMLElement;
  const hint = container.querySelector('#sb-hint') as HTMLElement;
  const scopeChips = [...container.querySelectorAll('#sb-scopes .chip')];

  // 每次改筛选都要重算「能不能续」：序列只由分类/范围/顺序三项决定，
  // 任一项一动，上次记下的那串就对不上了，按钮文案得跟着换成「开始速刷」。
  const syncStart = () => {
    const resumable = resumableSession();
    if (resumable) {
      startBtn.textContent = `继续速刷（第 ${positionOf(resumable)} / ${resumable.cards.length} 张）`;
      startBtn.disabled = false;
      zeroBtn.style.display = '';
      hint.textContent = '';
      // 折叠框收起来时也要看得见位置，所以进度写在标题行；展开后再补筛选条件和口径说明，
      // 同一句话不重复两遍。
      rulesSub.textContent = `上次刷到第 ${positionOf(resumable)} / ${resumable.cards.length} 张`;
      resumeBox.innerHTML = `
        <div class="speed-resume">
          <div class="speed-resume-meta">${escapeHtml(settingsSummary(resumable.settings))}</div>
          <div class="speed-resume-note">接着这张往下刷。本轮的浏览/认识统计从零重记，已保存的认识状态与复习数据都不受影响。</div>
        </div>
      `;
      return;
    }
    const count = poolWithinCategory().length;
    startBtn.textContent = `开始速刷（${count} 张）`;
    startBtn.disabled = count === 0;
    zeroBtn.style.display = 'none';
    rulesSub.textContent = progress ? '上次的位置属于另一套筛选条件' : '不排期、不评分，进度只记在本机';
    resumeBox.innerHTML = progress
      ? `<div class="speed-resume stale">上次的位置属于另一套筛选条件（${escapeHtml(settingsSummary(progress.settings))}），改回那套就能接着刷；现在开始的会是新的一串。</div>`
      : '';
    hint.textContent = count === 0 ? emptyHint() : '';
  };

  container.querySelectorAll('#sb-cats .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      container.querySelectorAll('#sb-cats .chip').forEach(other => other.classList.remove('selected'));
      chip.classList.add('selected');
      settings = { ...settings, category: chip.getAttribute('data-cat') ?? ALL_CATEGORIES };
      // 范围计数按标签算，选完标签要把数字重算一遍，否则会停在旧范围的计数上。
      buildScopeOptions(filterByCategory(library, settings.category), statuses).forEach((opt, i) => {
        const btn = scopeChips[i];
        btn.textContent = `${opt.label} ${opt.count}`;
      });
      syncStart();
    });
  });

  container.querySelectorAll('#sb-scopes .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      settings = { ...settings, scope: chip.getAttribute('data-scope') as SpeedScope };
      // 两个维度的计数互相依赖，整页重绘比手工同步四个地方更不容易漏。
      renderSetup(container);
    });
  });

  container.querySelectorAll('#sb-direction .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('#sb-direction .tab').forEach(other => other.classList.remove('active'));
      tab.classList.add('active');
      settings = { ...settings, direction: tab.getAttribute('data-direction') as SpeedDirection };
      // 方向不改序列，但进度卡上写的是这套筛选，文案得跟着换。
      syncStart();
    });
  });

  container.querySelectorAll('#sb-order .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('#sb-order .tab').forEach(other => other.classList.remove('active'));
      tab.classList.add('active');
      settings = { ...settings, order: tab.getAttribute('data-order') as SpeedOrder };
      // 顺序一改，上次那串的位置就不再是同一个位置了。
      syncStart();
    });
  });

  const autoChip = container.querySelector('#sb-auto')!;
  autoChip.addEventListener('click', () => {
    settings = { ...settings, autoAdvance: !settings.autoAdvance };
    autoChip.classList.toggle('selected', settings.autoAdvance);
    autoChip.setAttribute('aria-pressed', String(settings.autoAdvance));
  });

  const begin = (next: SpeedSession | null): void => {
    if (!next || next.cards.length === 0) return;
    session = next;
    renderBrushing(container);
  };

  startBtn.addEventListener('click', () => {
    // 能续就续；续不上才按当前筛选新建一串（createSession 里的标签筛选是同一条件的第二次过滤，幂等）。
    begin(resumableSession() ?? createSession(poolWithinCategory(), settings));
  });

  // 主动归零：丢掉上次位置，按当前筛选从第一张重来，长期状态表一个字都不碰。
  zeroBtn.addEventListener('click', () => begin(createSession(poolWithinCategory(), settings)));

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

function savedMark(s: SpeedSession): SpeedMark | undefined {
  const card = currentCard(s);
  return card ? statuses.get(cardKey(card)) : undefined;
}

function savedHintHtml(saved: SpeedMark | undefined): string {
  if (!saved) return '';
  return `<p class="speed-saved">已保存：${saved === 'known' ? '认识' : '不认识'}</p>`;
}

function markSlotHtml(s: SpeedSession): string {
  // 选中态优先本轮判定，没有就回落到上次保存的状态；统计仍只算本轮。
  const saved = savedMark(s);
  const hint = savedHintHtml(saved);
  if (!canMark(s)) {
    return `<button class="btn btn-primary btn-block btn-lg" id="sb-reveal">显示答案</button>${hint}`;
  }
  const mark = markOf(s) ?? saved;
  return `
    <div class="speed-marks">
      <button class="fsrs-btn speed-btn-unknown" data-mark="unknown" aria-pressed="${mark === 'unknown'}">不认识</button>
      <button class="fsrs-btn speed-btn-known" data-mark="known" aria-pressed="${mark === 'known'}">认识</button>
    </div>
    ${hint}
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
    <button class="speed-restart" id="sb-zero-round" type="button">从头开始</button>
  `;
  container.appendChild(header);
  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  // 退出前把位置记下（确认文案里说的「位置也留着」靠这一步兑现），再回设置页。
  header.querySelector('#sb-back')!.addEventListener('click', () => {
    if (!confirm(EXIT_TEXT)) return;
    persistProgress(s);
    renderSetup(container);
  });

  // 刷到一半想重来：位置归零并立刻按新序列重记，长期状态与本轮以外的东西都不受影响。
  header.querySelector('#sb-zero-round')!.addEventListener('click', () => {
    if (!confirm('从头开始这一串？本轮统计清零，已保存的认识状态仍保留。')) return;
    restartSession(s);
    paint();
  });

  // flipped 是卡面当前朝哪一面；revealed 是这张翻出过答案没有，回看已作答的词也允许改标。
  let flipped = false;
  // 每张卡的喇叭只绑一次：重复绑会让一次点击发出两遍读音。
  let speakBound = false;

  // 喇叭沿用复习卡的组件，读音就是当前这张卡的泰文。
  // 中→泰 的正面是中文，一听读音等于把答案给了，所以要等答案面露出过才亮；
  // canMark 表达的正是「这张的答案给看过」，跟作答按钮同一条件，不会出现能改标却读不了。
  const syncSpeak = (): void => {
    const host = content.querySelector('#sb-card') as HTMLElement;
    const btn = host.querySelector<HTMLElement>('.card-speak');
    if (!btn) return;
    const show = settings.direction === 'thai-to-cn' || canMark(s);
    btn.style.display = show ? '' : 'none';
    if (show && !speakBound) {
      speakBound = true;
      bindSpeakButton(host, currentCard(s)!.thai);
    }
  };

  const syncStats = () => {
    const host = content.querySelector('#sb-stats');
    if (host) host.innerHTML = statsLine(s);
  };

  const bindSlot = () => {
    const slot = content.querySelector('#sb-slot')!;
    slot.innerHTML = markSlotHtml(s);
    slot.querySelector('#sb-reveal')?.addEventListener('click', flip);
    slot.querySelectorAll('[data-mark]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const mark = btn.getAttribute('data-mark') as SpeedMark;
        const card = currentCard(s);
        if (!card || !setMark(s, mark)) return;
        // 判定当场落库：等这一行写完再翻页，手滑关掉页面也不会丢最后一个标记。
        const id = cardKey(card);
        await saveSpeedStatus(id, mark);
        statuses.set(id, mark);
        syncStats();
        if (s.settings.autoAdvance) advance();
        else {
          // 自动跳下一张时 paint 会顺手记下新位置；不跳的这张停在原地，也要把「刚标记到这张」存下来。
          persistProgress(s);
          bindSlot();
        }
      });
    });
  };

  function flip() {
    const firstReveal = !s.revealed;
    if (firstReveal) revealCard(s);
    flipped = !flipped;
    (content.querySelector('#sb-card') as HTMLElement).classList.toggle('flipped', flipped);
    // 答案第一次露出来，中→泰 的读音才允许跟着放出来；翻回中文面也不收回，
    // 和复习页「答案露出后常驻」同一口径。
    syncSpeak();
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
    speakBound = false;
    header.querySelector('#sb-pos')!.textContent = `${positionOf(s)} / ${s.cards.length}`;
    const percent = Math.round(((s.index + 1) / s.cards.length) * 100);
    content.innerHTML = `
      <div class="progress-bar"><div class="progress-fill" style="width:${percent}%"></div></div>
      <div class="speed-stats" id="sb-stats">${statsLine(s)}</div>
      <div class="flashcard speed-card" id="sb-card"><div class="flashcard-inner">
        <div class="flashcard-front">${promptHtml(card, settings.direction === 'thai-to-cn')}</div>
        <div class="flashcard-back">${answerHtml(card)}</div>
      </div>${speakButtonHtml()}</div>
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
    syncSpeak();
    // 每翻到一张就记一次位置：这样退出、刷新、直接关页面都停在最后看到的那张。
    persistProgress(s);
  }

  paint();
}

function renderDone(container: HTMLElement): void {
  const s = session;
  if (!s) {
    renderSetup(container);
    return;
  }
  // 整串刷完就没有「上次位置」可续了：清掉进度，结算页的重来/重排会按新序列重新记。
  dropProgress();
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
    // 打乱之后的串确实是随机序列：设置跟着改，下次进来选中的「顺序」才对得上这一串。
    reshuffleSession(s);
    s.settings = { ...s.settings, order: 'random' };
    settings = { ...settings, order: 'random' };
    renderBrushing(container);
  });
  content.querySelector('#sb-unknown')!.addEventListener('click', () => {
    keepUnknownOnly(s);
    renderBrushing(container);
  });
  content.querySelector('#sb-setup')!.addEventListener('click', () => renderSetup(container));
}
