import Dexie, { type Table } from 'dexie';

export interface Word {
  id?: number;
  thai: string;
  toneMark: string;
  meaning: string;
  pos: string;
  example: string;
  note: string;
  tags: string[];
  romanization?: string;
  exampleRoman?: string;
  exampleMeaning?: string;
  groupId?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ReviewState {
  wordId: number;
  difficulty: number;
  stability: number;
  reps: number;
  lapses: number;
  lastReview: number;
  nextReview: number;
  state: number;
}

export interface ErrorRecord {
  id?: number;
  wordId: number;
  errorType: string;
  question: string;
  userAnswer: string;
  correctAnswer: string;
  timestamp: number;
  date: string;
}

export interface StubbornWord {
  wordId: number;
  errorCount: number;
  addedAt: number;
  // 0 = 未掌握，1 = 已掌握。IndexedDB 不接受布尔值作为索引键，布尔记录会消失在
  // mastered 索引之外，索引查询永远命中不到。
  mastered: 0 | 1;
}

export interface MinimalPairGroup {
  id?: number;
  name: string;
  wordIds: number[];
  createdAt: number;
}

export interface GrammarExample {
  thai: string;
  meaning: string;
  blank?: string;
  roman?: string;
}

export interface GrammarPoint {
  id?: number;
  title: string;
  content: string;
  patterns: string[];
  examples: GrammarExample[];
  order: number;
  note?: string;
  isUserCreated?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface ColloquialNote {
  id?: number;
  original: string;
  spoken: string;
  explanation: string;
  createdAt: number;
}

export interface DailyStat {
  date: string;
  newWords: number;
  reviewsDone: number;
  streakDays: number;
}

export interface Setting {
  key: string;
  value: string;
}

export interface ReferenceWord {
  id?: number;
  thai: string;
  meaning: string;
  pos: string;
  toneMark: string;
  source: string;
}

export class ThaiLearnDB extends Dexie {
  words!: Table<Word>;
  reviewStates!: Table<ReviewState>;
  errorRecords!: Table<ErrorRecord>;
  stubbornWords!: Table<StubbornWord>;
  minimalPairGroups!: Table<MinimalPairGroup>;
  grammarPoints!: Table<GrammarPoint>;
  colloquialNotes!: Table<ColloquialNote>;
  dailyStats!: Table<DailyStat>;
  settings!: Table<Setting>;
  referenceWords!: Table<ReferenceWord>;

  constructor(name = 'ThaiLearnDB') {
    super(name);
    // Only indexed fields belong here; extra record fields persist without a
    // version bump, which keeps existing FSRS / error / streak data untouched.
    this.version(1).stores({
      words: '++id, thai, createdAt, updatedAt, groupId, *tags',
      reviewStates: 'wordId, nextReview, state',
      errorRecords: '++id, wordId, date, errorType, timestamp',
      stubbornWords: 'wordId, errorCount, mastered',
      minimalPairGroups: '++id, name, createdAt',
      grammarPoints: '++id, order',
      colloquialNotes: '++id, createdAt',
      dailyStats: 'date',
      settings: 'key',
      referenceWords: '++id, thai, meaning',
    });
    // v1 wrote mastered as a boolean, which is not a valid IndexedDB key, so those
    // rows never entered the mastered index. Rewrite the values only: the key stays
    // wordId and every other field is carried over untouched.
    this.version(2).stores({
      stubbornWords: 'wordId, errorCount, mastered',
    }).upgrade(tx => tx.table('stubbornWords').toCollection().modify(row => {
      // 严格归一化：只承认 0 和 1，其余值（boolean、缺失、意外的数字）一律重算，
      // 否则 mastered=2 这类脏数据会绕过 0|1 类型约束继续留在索引里。
      if (row.mastered !== 0 && row.mastered !== 1) row.mastered = row.mastered === true ? 1 : 0;
    }));
  }
}

export const db = new ThaiLearnDB();

export async function getSetting(key: string, defaultValue: string = ''): Promise<string> {
  const setting = await db.settings.get(key);
  return setting?.value ?? defaultValue;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value });
}

export async function getStubbornThreshold(): Promise<number> {
  const val = await getSetting('stubbornThreshold', '3');
  return parseInt(val, 10) || 3;
}

// Backups exported before version 2 hold mastered as a boolean; restoring them
// must not put that value back into the indexed field.
export function normalizeStubbornMastered(value: unknown): 0 | 1 {
  return value === 1 || value === true ? 1 : 0;
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function getOrCreateDailyStat(date?: string): Promise<DailyStat> {
  const d = date || todayStr();
  let stat = await db.dailyStats.get(d);
  if (!stat) {
    stat = { date: d, newWords: 0, reviewsDone: 0, streakDays: 0 };
    await db.dailyStats.put(stat);
  }
  return stat;
}

export async function updateStreak(): Promise<number> {
  const today = todayStr();
  const stat = await getOrCreateDailyStat(today);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  const yStat = await db.dailyStats.get(yStr);

  if (yStat && yStat.streakDays > 0) {
    stat.streakDays = yStat.streakDays + 1;
  } else if (stat.streakDays === 0) {
    stat.streakDays = 1;
  }
  await db.dailyStats.put(stat);
  return stat.streakDays;
}
