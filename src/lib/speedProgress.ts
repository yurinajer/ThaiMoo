import type { SpeedProgressRecord } from './speedbrush';

// 速刷进度只记「上次停在哪」，是设备本地的临时位置，不该进任何表：
// 一不进表，JSON 备份里就没有它，恢复备份时词 id 重排也不会把一个旧位置指到别的词上。
const STORAGE_KEY = 'thailearn.speedbrush.progress';

// 隐私模式或被站点禁用时，光是访问 localStorage 就会抛，取句柄这一步也得包起来。
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

// 只认这一份结构：字段缺、类型不对、JSON 坏了，一律当没有进度，宁可从头刷也不能刷出空白卡。
function parse(raw: string | null): SpeedProgressRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SpeedProgressRecord> | null;
    const settings = parsed?.settings;
    if (!Array.isArray(parsed?.ids) || parsed.ids.length === 0) return null;
    if (typeof parsed.index !== 'number' || !Number.isFinite(parsed.index) || parsed.index < 0) return null;
    if (!settings || typeof settings.category !== 'string' || typeof settings.scope !== 'string'
      || typeof settings.direction !== 'string' || typeof settings.order !== 'string'
      || typeof settings.autoAdvance !== 'boolean') return null;
    return {
      ids: parsed.ids.map(Number),
      index: Math.floor(parsed.index),
      settings: settings as SpeedProgressRecord['settings'],
      updatedAt: Number(parsed.updatedAt) || 0,
    };
  } catch {
    return null;
  }
}

export function loadSpeedProgress(): SpeedProgressRecord | null {
  const store = storage();
  if (!store) return null;
  try {
    return parse(store.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

// 写失败（配额、被禁用）只影响下次接续，不该打断当前这张卡，所以这里只吞不改。
export function saveSpeedProgress(record: SpeedProgressRecord): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* 位置记不住，本轮照刷 */
  }
}

export function clearSpeedProgress(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    /* 同上 */
  }
}
