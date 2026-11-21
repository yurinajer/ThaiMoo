import { db, type ReviewState, getOrCreateDailyStat } from './index';

export async function getReviewState(wordId: number): Promise<ReviewState | undefined> {
  return await db.reviewStates.get(wordId);
}

export async function getAllReviewStates(): Promise<ReviewState[]> {
  return await db.reviewStates.toArray();
}

export async function getDueReviewStates(): Promise<ReviewState[]> {
  const now = Date.now();
  return await db.reviewStates.where('nextReview').belowOrEqual(now).toArray();
}

// 新词的先后是产品语义：主键升序 = 入库顺序，所以昨天导入的词永远排在今天之前。
// 刻意不用 toArray 的默认遍历顺序，也不在这里打乱，顺序由调用方（复习页）原样保留。
export async function getNewWordsWithoutReview(count?: number): Promise<number[]> {
  const allStates = await db.reviewStates.toArray();
  const reviewedIds = new Set(allStates.map(s => s.wordId));

  const keys = await db.words.orderBy('id').primaryKeys();
  const newWordIds = keys.filter((k): k is number => typeof k === 'number' && !reviewedIds.has(k));

  if (count !== undefined) {
    return newWordIds.slice(0, count);
  }
  return newWordIds;
}

export async function getTodayNewWordCount(): Promise<number> {
  const stat = await getOrCreateDailyStat();
  return stat.newWords;
}

export async function getTodayReviewCount(): Promise<number> {
  const stat = await getOrCreateDailyStat();
  return stat.reviewsDone;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// 单轮上限：一口气导入几千词时，「开始复习」不该把整库排成一场。
// 到期词取最先到期的前 50 张，新词取入库最早的前 20 张；截断只发生在读取端，
// 不写库、不改排期，剩下的下一轮从头续上。
export const SESSION_DUE_LIMIT = 50;
export const SESSION_NEW_LIMIT = 20;

// 「永不复习」不用新字段、也不给 Dexie 升版本：nextReview 上本来就有索引，
// 存一个远未来时间戳就天然落在 getDueReviewStates 的 belowOrEqual(now) 之外。
// Number.MAX_SAFE_INTEGER 换成年份约 28 万年，且能被 structuredClone 与 JSON 备份原样往返。
export const NEVER_REVIEW = Number.MAX_SAFE_INTEGER;

export type ReviewGrade = 1 | 2 | 3 | 4 | 5 | 6;

export interface GradeSpec {
  grade: ReviewGrade;
  label: string;
  /** 按钮上显示的间隔文案，和 delayMs 同源，不允许各写一份 */
  interval: string;
  /** 相对本次评分的延后毫秒数；null 表示毕业（永不复习） */
  delayMs: number | null;
}

// 固定六档：按哪个按钮就排多久，和记忆历史无关。
// 改间隔只改这张表，复习页按钮和排期一起跟着变。
export const GRADE_TABLE: readonly GradeSpec[] = [
  { grade: 1, label: '忘记', interval: '10分钟', delayMs: 10 * MINUTE },
  { grade: 2, label: '困难', interval: '1天', delayMs: DAY },
  { grade: 3, label: '良好', interval: '3天', delayMs: 3 * DAY },
  { grade: 4, label: '优秀', interval: '7天', delayMs: 7 * DAY },
  { grade: 5, label: '已学会', interval: '14天', delayMs: 14 * DAY },
  { grade: 6, label: '已牢记', interval: '永不复习', delayMs: null },
];

export function gradeSpec(grade: ReviewGrade): GradeSpec {
  const spec = GRADE_TABLE.find(s => s.grade === grade);
  if (!spec) throw new Error(`未知的复习评分档：${grade}`);
  return spec;
}

export function nextReviewTime(from: number, grade: ReviewGrade): number {
  const delay = gradeSpec(grade).delayMs;
  return delay === null ? NEVER_REVIEW : from + delay;
}

export function isGraduated(state: ReviewState): boolean {
  return state.nextReview === NEVER_REVIEW;
}

export async function gradeReview(wordId: number, grade: ReviewGrade): Promise<{ nextReview: number }> {
  const existing = await getReviewState(wordId);
  const now = Date.now();
  const nextReview = nextReviewTime(now, grade);

  const state: ReviewState = {
    wordId,
    // difficulty / stability 是 FSRS 时代留下的列，固定档不再计算它们。
    // 原值照抄回写：既保住历史，也让 schema 不必升版本。
    difficulty: existing?.difficulty ?? 0,
    stability: existing?.stability ?? 0,
    reps: (existing?.reps ?? 0) + 1,
    lapses: (existing?.lapses ?? 0) + (grade === 1 ? 1 : 0),
    lastReview: now,
    nextReview,
    // state 存最近一次的评分档（1~6），0 表示还没评过分。
    // 全仓库没有任何地方读它，只挂在 Dexie 索引上。
    state: grade,
  };
  await db.reviewStates.put(state);

  // 这里只累加复习数。「今日新词」是入库口径，记在 db/vocabulary.ts 的 addWord 里，
  // 抽中、评分、退出都不影响它。
  const stat = await getOrCreateDailyStat();
  stat.reviewsDone++;
  await db.dailyStats.put(stat);

  return { nextReview };
}

// 新词被抽进本轮复习时才落第一行排期；重复调用是空操作，不会把已排期的词打回炉。
// 它不记「今日新词」——那个口径在 addWord 里按入库计。
export async function initNewWordReview(wordId: number): Promise<void> {
  const existing = await getReviewState(wordId);
  if (existing) return;

  const now = Date.now();
  const state: ReviewState = {
    wordId,
    difficulty: 0,
    stability: 0,
    reps: 0,
    lapses: 0,
    lastReview: 0,
    nextReview: now,
    state: 0,
  };
  await db.reviewStates.put(state);
}

export async function getDueCount(): Promise<number> {
  const due = await getDueReviewStates();
  return due.length;
}

export async function getNewWordCount(): Promise<number> {
  const newWords = await getNewWordsWithoutReview();
  return newWords.length;
}

export async function getGraduatedReviewStates(): Promise<ReviewState[]> {
  const states = await db.reviewStates.where('nextReview').equals(NEVER_REVIEW).toArray();
  return states.sort((a, b) => a.lastReview - b.lastReview);
}

export async function getGraduatedCount(): Promise<number> {
  return await db.reviewStates.where('nextReview').equals(NEVER_REVIEW).count();
}

export async function ungraduateWord(wordId: number): Promise<void> {
  const state = await getReviewState(wordId);
  if (!state || !isGraduated(state)) return;
  // 取消毕业 = 立刻回到待复习队列。排回 14 天等于又消失两周，等于没取消。
  await db.reviewStates.update(wordId, { nextReview: Date.now(), state: 0 });
}

export interface SessionPlan {
  /** 本轮要考的到期词，按 nextReview 升序，最多 SESSION_DUE_LIMIT 条 */
  due: ReviewState[];
  /** 本轮要激活的新词 id，按入库顺序，最多 SESSION_NEW_LIMIT 个 */
  newIds: number[];
  /** 本轮装不下的数量，只给文案用；库里它们的到期状态一模一样 */
  dueOmitted: number;
  newOmitted: number;
}

// 只读编排：不写库。抽中新词的排期行由调用方 initNewWordReview 落笔，
// 这样「本轮实际考了什么」在页面上是可观察的一步，而不是查询的副作用。
export async function planReviewSession(): Promise<SessionPlan> {
  const dueStates = (await getDueReviewStates()).sort((a, b) => a.nextReview - b.nextReview);
  const newIds = await getNewWordsWithoutReview();
  return {
    due: dueStates.slice(0, SESSION_DUE_LIMIT),
    newIds: newIds.slice(0, SESSION_NEW_LIMIT),
    dueOmitted: Math.max(0, dueStates.length - SESSION_DUE_LIMIT),
    newOmitted: Math.max(0, newIds.length - SESSION_NEW_LIMIT),
  };
}

// 首页和复习页都要报「本轮几张」，这道算术只写一处，别各算各的。
export function planSessionCounts(dueCount: number, newCount: number): {
  planned: number; dueOmitted: number; newOmitted: number;
} {
  const dueTake = Math.min(dueCount, SESSION_DUE_LIMIT);
  const newTake = Math.min(newCount, SESSION_NEW_LIMIT);
  return {
    planned: dueTake + newTake,
    dueOmitted: dueCount - dueTake,
    newOmitted: newCount - newTake,
  };
}
