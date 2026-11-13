import { db, getSetting, setSetting, type GrammarPoint, type GrammarExample } from './index';

export type { GrammarPoint, GrammarExample };

const SEED_FLAG = 'grammarSeeded';
const SEED_URL = '/data/grammar-points.json';

// 播种失败不再写标记，下一次进入本页会重试；重试可能和上一次尝试并发，
// 故同一进程内共享同一次播种，避免两趟各自看到空表而写入两份种子数据。
let seeding: Promise<boolean> | null = null;

export async function loadGrammarPoints(): Promise<GrammarPoint[]> {
  const existing = await db.grammarPoints.orderBy('order').toArray();
  if (existing.length > 0) return existing;
  // 标记的意义是「本设备播种过了」：用户删光种子句型后不应被自动复活。
  if (await getSetting(SEED_FLAG)) return existing;

  if (!seeding) {
    seeding = seedFromJson().then((ok) => {
      seeding = null;
      return ok;
    });
  }
  if (await seeding) await setSetting(SEED_FLAG, String(Date.now()));

  return db.grammarPoints.orderBy('order').toArray();
}

async function seedFromJson(): Promise<boolean> {
  let payload: unknown;
  try {
    const resp = await fetch(SEED_URL);
    if (!resp.ok) return false;
    payload = await resp.json();
  } catch {
    return false;
  }

  const points = (payload as { points?: unknown } | null)?.points;
  // 取到空清单也算失败：写成成功标记等于永久放弃初始化。
  if (!Array.isArray(points) || points.length === 0) return false;

  const now = Date.now();
  let added = 0;

  try {
    await db.transaction('rw', db.grammarPoints, async () => {
      // 「表为空」是播种前读的，写入事务里必须再确认一次：并发重试或另一个标签页
      // 已经写完之后，这一趟只能跳过，否则会落进两份重复的种子数据。
      if ((await db.grammarPoints.count()) > 0) return;
      for (let i = 0; i < points.length; i++) {
        const p = points[i] as Partial<GrammarPoint>;
        if (!p || typeof p.title !== 'string') continue;
        await db.grammarPoints.add({
          title: p.title,
          content: p.content ?? '',
          patterns: Array.isArray(p.patterns) ? p.patterns : [],
          examples: Array.isArray(p.examples) ? p.examples : [],
          order: i,
          note: p.note ?? '',
          isUserCreated: false,
          createdAt: now,
          updatedAt: now,
        });
        added++;
      }
    });
  } catch {
    return false;
  }

  return added > 0;
}

export async function createGrammarPoint(
  data: Omit<GrammarPoint, 'id' | 'order' | 'createdAt' | 'updatedAt' | 'isUserCreated'>
): Promise<number> {
  const last = await db.grammarPoints.orderBy('order').last();
  const now = Date.now();
  const id = await db.grammarPoints.add({
    ...data,
    order: (last?.order ?? -1) + 1,
    isUserCreated: true,
    createdAt: now,
    updatedAt: now,
  });
  return id as number;
}

export async function updateGrammarPoint(id: number, changes: Partial<GrammarPoint>): Promise<void> {
  await db.grammarPoints.update(id, { ...changes, updatedAt: Date.now() });
}

export async function getGrammarPoint(id: number): Promise<GrammarPoint | undefined> {
  const p = await db.grammarPoints.get(id);
  return p && normalizeGrammarPoint(p);
}

export async function deleteGrammarPoint(id: number): Promise<void> {
  await db.grammarPoints.delete(id);
}

export function normalizeGrammarPoint(p: GrammarPoint): GrammarPoint {
  return {
    ...p,
    patterns: Array.isArray(p.patterns) ? p.patterns.filter(x => typeof x === 'string') : [],
    examples: Array.isArray(p.examples)
      ? p.examples.filter(x => x && typeof x.thai === 'string')
      : [],
    note: p.note ?? '',
  };
}
