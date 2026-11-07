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
  mastered: boolean;
}

export interface MinimalPairGroup {
  id?: number;
  name: string;
  wordIds: number[];
  createdAt: number;
}

export interface GrammarPoint {
  id?: number;
  title: string;
  content: string;
  patterns: string[];
  examples: { thai: string; meaning: string; blank?: string }[];
  order: number;
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

  constructor() {
    super('ThaiLearnDB');
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
