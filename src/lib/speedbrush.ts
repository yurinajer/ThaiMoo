import type { SpeedStatus, Word } from '../db/index';
import { shuffleArray } from './utils';

export type SpeedDirection = 'thai-to-cn' | 'cn-to-thai';
export type SpeedOrder = 'original' | 'random';
// 速刷状态的取值直接以表定义为准，页面、会话、库里是同一套字面量，不存在第二份真相。
export type SpeedMark = SpeedStatus['status'];
export type SpeedScope = 'all' | 'unknown' | 'unpracticed';

export interface SpeedSettings {
  category: string;
  scope: SpeedScope;
  direction: SpeedDirection;
  order: SpeedOrder;
  autoAdvance: boolean;
}

// 分类走词库已有的 tags 字段，空串是「全部」的哨兵值，不新增任何数据结构。
export const ALL_CATEGORIES = '';

export const DEFAULT_SETTINGS: SpeedSettings = {
  category: ALL_CATEGORIES,
  scope: 'all',
  direction: 'thai-to-cn',
  order: 'original',
  autoAdvance: true,
};

// 练习范围的标签文案；计数由 buildScopeOptions 按当前筛选实时算出。
export const SCOPE_OPTIONS: { scope: SpeedScope; label: string }[] = [
  { scope: 'all', label: '全部单词' },
  { scope: 'unknown', label: '不认识' },
  { scope: 'unpracticed', label: '未练习' },
];

// 长期保存的速刷状态，按词 id 索引。缺项就是「未练习」，不额外存一份 null。
export type SpeedStatusMap = Map<number, SpeedMark>;

export interface SpeedScopeOption {
  scope: SpeedScope;
  label: string;
  count: number;
}

export interface SpeedSession {
  settings: SpeedSettings;
  cards: Word[];
  index: number;
  // 本轮是否翻出过答案：认识/不认识只在此之后可用，也是「浏览」的计数时机。
  revealed: boolean;
  viewed: Set<number>;
  marks: Map<number, SpeedMark>;
}

export interface SpeedCategory {
  name: string;
  count: number;
}

// 上次刷到哪：整串 id 一起记，随机顺序才能原样续上；几千个 id 也就几十 KB。
export interface SpeedProgressRecord {
  ids: number[];
  index: number;
  settings: SpeedSettings;
  updatedAt: number;
}

export interface SpeedStats {
  total: number;
  viewed: number;
  known: number;
  unknown: number;
  answered: number;
  // 分母（已作答）为 0 时不给 0%，交给页面显示占位符。
  knownRate: number | null;
}

// 词库行必然带自增主键；缺 id 只出现在测试手搓的裸对象上，归到同一个 0 键即可。
export function cardKey(word: Word | undefined): number {
  return word?.id ?? 0;
}

export function buildCategoryOptions(words: Word[]): SpeedCategory[] {
  const counts = new Map<string, number>();
  for (const word of words) {
    for (const raw of word.tags ?? []) {
      const name = raw.trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const named = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN'))
    .map(([name, count]) => ({ name, count }));
  return [{ name: ALL_CATEGORIES, count: words.length }, ...named];
}

export function filterByCategory(words: Word[], category: string): Word[] {
  if (category === ALL_CATEGORIES) return [...words];
  return words.filter(word => (word.tags ?? []).some(tag => tag.trim() === category));
}

// 练习范围只看长期状态表里的判定，跟 FSRS 的复习日期、掌握状态没有任何关系：
// 「不认识」= 最新一次判的是不认识（可以反复刷到改判认识），
// 「未练习」= 状态表里完全没有这个词。
export function filterByScope(words: Word[], scope: SpeedScope, statuses: SpeedStatusMap): Word[] {
  if (scope === 'unknown') return words.filter(word => statuses.get(cardKey(word)) === 'unknown');
  if (scope === 'unpracticed') return words.filter(word => !statuses.has(cardKey(word)));
  return [...words];
}

// 计数在同一个词表上一次性算完，三个范围加起来才对得上：全部 = 不认识 + 已判认识 + 未练习。
export function buildScopeOptions(words: Word[], statuses: SpeedStatusMap): SpeedScopeOption[] {
  let unknown = 0;
  let unpracticed = 0;
  for (const word of words) {
    const saved = statuses.get(cardKey(word));
    if (!saved) unpracticed++;
    else if (saved === 'unknown') unknown++;
  }
  return SCOPE_OPTIONS.map(option => ({
    scope: option.scope,
    label: option.label,
    count: option.scope === 'all' ? words.length : option.scope === 'unknown' ? unknown : unpracticed,
  }));
}

// 序列只在开始时生成一次，切卡不再重排，随机才不会重复也不会漏词。
export function createSession(words: Word[], settings: SpeedSettings): SpeedSession {
  const picked = filterByCategory(words, settings.category);
  return {
    settings: { ...settings },
    cards: settings.order === 'random' ? shuffleArray(picked) : picked,
    index: 0,
    revealed: false,
    viewed: new Set(),
    marks: new Map(),
  };
}

// 分类/范围/顺序决定序列本身，方向和自动跳只改卡面与节奏，所以只有前三项一致才谈得上「接着刷」。
export function isSameSequence(a: SpeedSettings, b: SpeedSettings): boolean {
  return a.category === b.category && a.scope === b.scope && a.order === b.order;
}

// 恢复的是上次那一串，不重新生成：重摇一次等于换了词单，位置也就白记了。
// 中途删掉的词直接跳过，其余保持原顺序；本轮统计从零起，计分口径与新建会话一致。
export function restoreSession(words: Word[], record: SpeedProgressRecord, settings: SpeedSettings): SpeedSession | null {
  if (!isSameSequence(record.settings, settings)) return null;
  const byId = new Map<number, Word>();
  for (const word of words) {
    if (word.id !== undefined) byId.set(word.id, word);
  }
  const cards: Word[] = [];
  const origin: number[] = [];
  record.ids.forEach((id, pos) => {
    const word = byId.get(id);
    if (!word) return;
    cards.push(word);
    origin.push(pos);
  });
  if (cards.length === 0) return null;
  const anchor = Math.min(Math.max(Math.floor(record.index), 0), record.ids.length - 1);
  // 上次那张可能已被删：往后找第一张还在的，整串都没了才停在最后一张。
  let index = cards.length - 1;
  for (let i = 0; i < origin.length; i++) {
    if (origin[i] >= anchor) {
      index = i;
      break;
    }
  }
  return { settings: { ...settings }, cards, index, revealed: false, viewed: new Set(), marks: new Map() };
}

export function currentCard(session: SpeedSession): Word | undefined {
  return session.cards[session.index];
}

export function isFirstCard(session: SpeedSession): boolean {
  return session.index === 0;
}

export function isLastCard(session: SpeedSession): boolean {
  return session.index >= session.cards.length - 1;
}

export function positionOf(session: SpeedSession): number {
  return session.cards.length === 0 ? 0 : session.index + 1;
}

export function revealCard(session: SpeedSession): boolean {
  const word = currentCard(session);
  if (!word) return false;
  session.revealed = true;
  session.viewed.add(cardKey(word));
  return true;
}

function goTo(session: SpeedSession, index: number): boolean {
  if (index < 0 || index >= session.cards.length) return false;
  session.index = index;
  // 切卡必须复位翻面状态，否则新卡一上来就带着上一张的答案和按钮。
  session.revealed = false;
  return true;
}

export function goNext(session: SpeedSession): boolean {
  return goTo(session, session.index + 1);
}

export function goPrev(session: SpeedSession): boolean {
  return goTo(session, session.index - 1);
}

// 答案翻出来之后才能作答；回看已作答的词也要能改标，所以按 id 放行。
export function canMark(session: SpeedSession): boolean {
  const word = currentCard(session);
  if (!word) return false;
  return session.revealed || session.marks.has(cardKey(word));
}

export function setMark(session: SpeedSession, mark: SpeedMark): boolean {
  const word = currentCard(session);
  if (!word || !canMark(session)) return false;
  // 同一张按 id 覆盖，改标只算一次，不会把统计刷胖。
  session.marks.set(cardKey(word), mark);
  return true;
}

export function markOf(session: SpeedSession): SpeedMark | undefined {
  const word = currentCard(session);
  return word ? session.marks.get(cardKey(word)) : undefined;
}

// 不认识名单沿用本轮序列的顺序，打乱与否都由开始时的设置决定。
export function unknownCards(session: SpeedSession): Word[] {
  return session.cards.filter(word => session.marks.get(cardKey(word)) === 'unknown');
}

export function statsOf(session: SpeedSession): SpeedStats {
  let known = 0;
  let unknown = 0;
  for (const mark of session.marks.values()) {
    if (mark === 'known') known++;
    else unknown++;
  }
  const answered = known + unknown;
  return {
    total: session.cards.length,
    viewed: session.viewed.size,
    known,
    unknown,
    answered,
    knownRate: answered === 0 ? null : Math.round((known / answered) * 100),
  };
}

export function frontText(word: Word, direction: SpeedDirection): string {
  return direction === 'thai-to-cn' ? word.thai : word.meaning;
}

export function answerText(word: Word, direction: SpeedDirection): string {
  return direction === 'thai-to-cn' ? word.meaning : word.thai;
}

function resetCounters(session: SpeedSession): void {
  session.index = 0;
  session.revealed = false;
  session.viewed.clear();
  session.marks.clear();
}

export function restartSession(session: SpeedSession): void {
  resetCounters(session);
}

export function reshuffleSession(session: SpeedSession): void {
  session.cards = shuffleArray(session.cards);
  resetCounters(session);
}

export function keepUnknownOnly(session: SpeedSession): void {
  session.cards = unknownCards(session);
  resetCounters(session);
}
