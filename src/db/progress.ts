import { db, type DailyStat, todayStr, updateStreak } from './index';

export async function getTodayStats(): Promise<DailyStat> {
  const today = todayStr();
  let stat = await db.dailyStats.get(today);
  if (!stat) {
    stat = { date: today, newWords: 0, reviewsDone: 0, streakDays: 0 };
    await db.dailyStats.put(stat);
  }
  return stat;
}

export async function getRecentStats(days: number = 7): Promise<DailyStat[]> {
  const stats: DailyStat[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const stat = await db.dailyStats.get(dateStr);
    if (stat) {
      stats.push(stat);
    }
  }
  return stats.reverse();
}

export async function getTotalWords(): Promise<number> {
  return await db.words.count();
}

export async function getTotalReviews(): Promise<number> {
  const allStats = await db.dailyStats.toArray();
  return allStats.reduce((sum, s) => sum + s.reviewsDone, 0);
}

export async function getCurrentStreak(): Promise<number> {
  const today = todayStr();
  const stat = await db.dailyStats.get(today);
  if (stat && stat.streakDays > 0) return stat.streakDays;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  const yStat = await db.dailyStats.get(yStr);
  return yStat?.streakDays || 0;
}

export async function recordDailyActivity(): Promise<void> {
  await updateStreak();
}

export interface ProgressSummary {
  totalWords: number;
  totalReviews: number;
  streakDays: number;
  todayNewWords: number;
  todayReviews: number;
  stubbornCount: number;
}

export async function getProgressSummary(): Promise<ProgressSummary> {
  const [totalWords, totalReviews, streakDays, todayStats, stubbornCount] = await Promise.all([
    getTotalWords(),
    getTotalReviews(),
    getCurrentStreak(),
    getTodayStats(),
    db.stubbornWords.where('mastered').equals(0).count(),
  ]);

  return {
    totalWords,
    totalReviews,
    streakDays,
    todayNewWords: todayStats.newWords,
    todayReviews: todayStats.reviewsDone,
    stubbornCount,
  };
}
