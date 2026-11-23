import { db, type SpeedStatus } from './index';
export type { SpeedStatus } from './index';

export type SpeedStatusValue = SpeedStatus['status'];

// 速刷状态表和复习排期表是两套平行数据：这里只认 wordId/status/updatedAt，
// 不读也不写任何排期字段，所以「认识」永远不会变成复习里的「已牢记」。
export async function loadSpeedStatuses(): Promise<Map<number, SpeedStatusValue>> {
  const rows = await db.speedStatuses.toArray();
  return new Map(rows.map(row => [row.wordId, row.status]));
}

// 主键就是 wordId，put 天然覆盖：同一个词反复判定只留最新一次，不会出现多行。
export async function saveSpeedStatus(wordId: number, status: SpeedStatusValue): Promise<void> {
  await db.speedStatuses.put({ wordId, status, updatedAt: Date.now() });
}

// 备份里的状态行可能来自旧版本、也可能被手改过，所以一律按最严口径重校验：
// 状态只认速刷自己写得出的两个字面量，坏行跳过而不是让整份恢复失败。
// validWordIds 是这次要恢复的词库 id 集合：词没了状态就成了孤儿，直接丢掉。
// 同一个 wordId 出现多次按「后者覆盖前者」只留一行，和写库时 put 的行为一致，
// 这样给用户看的条数就是真正会落库的行数。
export function sanitizeSpeedStatusesForRestore(payload: unknown, validWordIds: Set<number>): SpeedStatus[] {
  if (!Array.isArray(payload)) return [];
  const byWordId = new Map<number, SpeedStatus>();
  for (const raw of payload as Partial<SpeedStatus>[]) {
    if (!raw || typeof raw.wordId !== 'number') continue;
    if (raw.status !== 'known' && raw.status !== 'unknown') continue;
    if (!validWordIds.has(raw.wordId)) continue;
    // 时间戳缺失或脏掉就记成恢复这一刻，反正它只是记录字段，不参与任何查询。
    byWordId.set(raw.wordId, {
      wordId: raw.wordId,
      status: raw.status,
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    });
  }
  return [...byWordId.values()];
}
