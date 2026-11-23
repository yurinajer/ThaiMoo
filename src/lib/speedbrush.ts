import type { Word } from '../db/index';
import { shuffleArray } from './utils';

export type SpeedDirection = 'thai-to-cn' | 'cn-to-thai';
export type SpeedOrder = 'original' | 'random';
export type SpeedMark = 'known' | 'unknown';

export interface SpeedSettings {
  category: string;
  direction: SpeedDirection;
  order: SpeedOrder;
  autoAdvance: boolean;
}

// 分类走词库已有的 tags 字段，空串是「全部」的哨兵值，不新增任何数据结构。
export const ALL_CATEGORIES = '';

export const DEFAULT_SETTINGS: SpeedSettings = {
  category: ALL_CATEGORIES,
  direction: 'thai-to-cn',
  order: 'original',
  autoAdvance: true,
};

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
