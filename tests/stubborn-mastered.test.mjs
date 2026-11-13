// 顽固词 mastered 字段读写链路 + 旧数据迁移回归测试。
// 运行：node tests/stubborn-mastered.test.mjs
// 隔离性：本文件只在 node 进程内的 fake-indexeddb（内存实现）里建库，进程退出即销毁，
// 不会接触浏览器里的 ThaiLearnDB、本地学习数据或线上数据。
// 迁移链路另用一个独立库名（STUBBORN_LEGACY_DB）验证，与业务库名分开。
import 'fake-indexeddb/auto';
import { createServer } from 'vite';

const STUBBORN_LEGACY_DB = 'ThaiLearnDB-stubborn-migration-test';

// 线上老设备实际携带的 v1 结构，测试里冻结一份用于伪造旧库，
// 不跟随生产代码变化，否则迁移测试会跟着被改的 schema 一起失真。
const LEGACY_V1_STORES = {
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
};

const results = [];
let failed = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed++;
}
const json = (v) => JSON.stringify(v);
function race(promise, label, ms = 8000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`超时：${label}`)), ms)),
  ]);
}
const stripMastered = ({ mastered, ...rest }) => rest;
const pkOf = (row) => String(row.id ?? row.wordId ?? row.date ?? row.key ?? '');
const byPk = (rows) => [...rows].sort((a, b) => (pkOf(a) < pkOf(b) ? -1 : pkOf(a) > pkOf(b) ? 1 : 0));

// ---------- 原生 IndexedDB 小工具（用于伪造 v1 旧库并检查索引内部状态） ----------
function parseStoreSpec(spec) {
  const parts = spec.split(',').map(s => s.trim()).filter(Boolean);
  const primary = parts[0];
  const autoIncrement = primary.startsWith('++');
  return {
    keyPath: autoIncrement ? primary.slice(2) : primary,
    autoIncrement,
    indexes: parts.slice(1).map(i => i.startsWith('*') ? { name: i.slice(1), multiEntry: true } : { name: i, multiEntry: false }),
  };
}

function openRaw(name, version, onUpgrade) {
  return race(new Promise((resolve, reject) => {
    const req = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
    if (onUpgrade) req.onupgradeneeded = () => onUpgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error(`版本升级被其他连接占用：${name}`));
  }), `open ${name}@${version ?? 'current'}`);
}

function putRows(idb, storeName, rows) {
  return race(new Promise((resolve, reject) => {
    const tx = idb.transaction(storeName, 'readwrite');
    for (const row of rows) tx.objectStore(storeName).put(row);
    tx.oncomplete = () => resolve(rows);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }), `put ${storeName}`);
}

function readAll(idb, storeName) {
  return race(new Promise((resolve, reject) => {
    const tx = idb.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }), `getAll ${storeName}`);
}

function countIndex(idb, storeName, indexName) {
  return race(new Promise((resolve, reject) => {
    const tx = idb.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).index(indexName).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }), `count index ${storeName}.${indexName}`);
}

async function main() {
  const server = await createServer({
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  let dbModule;
  let errorsModule;
  let progressModule;
  try {
    dbModule = await server.ssrLoadModule('/src/db/index.ts');
    errorsModule = await server.ssrLoadModule('/src/db/errors.ts');
    progressModule = await server.ssrLoadModule('/src/db/progress.ts');
  } finally {
    await server.close();
  }
  const { ThaiLearnDB, db, normalizeStubbornMastered } = dbModule;
  const { addErrorRecord, getStubbornWords, getStubbornWordIds, getStubbornCount, markStubbornMastered } = errorsModule;

  // ---------- 1. 新增顽固词写入未掌握状态 ----------
  {
    const threshold = await dbModule.getStubbornThreshold();
    check('阈值默认 3 次', threshold === 3, `实际 ${threshold}`);

    for (let i = 0; i < threshold; i++) {
      await addErrorRecord(201, 'tone', '声调？', 'low', 'mid', true);
    }
    const row = await db.stubbornWords.get(201);
    check('达到阈值后新建顽固词记录', !!row, `实际 ${json(row ?? null)}`);
    check('新增顽固词 mastered 为数字 0', row?.mastered === 0, `实际 ${json(row?.mastered)}`);
    check('新增顽固词 errorCount 记录真实错误数', row?.errorCount === threshold, `实际 ${json(row?.errorCount)}`);
    check('新增顽固词保留 addedAt', typeof row?.addedAt === 'number', `实际 ${json(row?.addedAt)}`);

    // 未达阈值不应产生顽固词
    await addErrorRecord(203, 'tone', '声调？', 'low', 'mid', true);
    await addErrorRecord(203, 'tone', '声调？', 'low', 'mid', true);
    check('未达阈值不新增顽固词', (await db.stubbornWords.get(203)) === undefined, json(await db.stubbornWords.get(203) ?? null));
    // 非词库错题不进入顽固词链路
    await addErrorRecord(0, 'rule', '规则？', 'a', 'b', true);
    check('非词库错题（wordId=0）不新增顽固词', (await db.stubbornWords.get(0)) === undefined);
  }

  // ---------- 2. 未掌握 / 已掌握查询走索引 ----------
  {
    for (let i = 0; i < 3; i++) await addErrorRecord(202, 'tone', '声调？', 'high', 'mid', true);

    const unmastered = await getStubbornWords();
    check('查询未掌握顽固词返回记录', unmastered.length === 2, `实际 ${json(unmastered.map(s => s.wordId))}`);
    check('查询未掌握顽固词内容正确', json(unmastered.map(s => s.wordId)) === json([201, 202]), `实际 ${json(unmastered.map(s => s.wordId))}`);
    check('getStubbornWordIds 与列表一致', json(await getStubbornWordIds()) === json([201, 202]), `实际 ${json(await getStubbornWordIds())}`);
    check('未掌握统计数量与实际记录一致', (await getStubbornCount()) === 2, `实际 ${await getStubbornCount()}`);

    await markStubbornMastered(201);
    const afterMark = await db.stubbornWords.get(201);
    check('标记掌握后 mastered 为数字 1', afterMark?.mastered === 1, `实际 ${json(afterMark?.mastered)}`);
    const mastered = await db.stubbornWords.where('mastered').equals(1).toArray();
    check('查询已掌握顽固词返回记录', json(mastered.map(s => s.wordId)) === json([201]), `实际 ${json(mastered.map(s => s.wordId))}`);
    check('标记掌握后从未掌握列表消失', json(await getStubbornWordIds()) === json([202]), `实际 ${json(await getStubbornWordIds())}`);
    check('标记掌握后统计数量为 1', (await getStubbornCount()) === 1, `实际 ${await getStubbornCount()}`);

    // 已掌握的词再次答错，只累加次数，不应退回未掌握
    await addErrorRecord(201, 'tone', '声调？', 'low', 'mid', true);
    const again = await db.stubbornWords.get(201);
    check('已掌握词再次错题仍保持 mastered=1', again?.mastered === 1, `实际 ${json(again?.mastered)}`);
    check('已掌握词再次错题 errorCount 继续累加', again?.errorCount === 4, `实际 ${json(again?.errorCount)}`);
    check('统计口径只算未掌握', (await getStubbornCount()) === 1, `实际 ${await getStubbornCount()}`);
  }

  // ---------- 3. 统计页读取同一链路 ----------
  {
    const summary = await progressModule.getProgressSummary();
    check('进度汇总 stubbornCount 与未掌握数量一致', summary.stubbornCount === 1, `实际 ${summary.stubbornCount}`);
    const realUnmastered = (await db.stubbornWords.toArray()).filter(s => s.mastered === 0).length;
    check('统计数量等于按记录扫描得到的未掌握数', summary.stubbornCount === realUnmastered, `汇总 ${summary.stubbornCount}，扫描 ${realUnmastered}`);
  }

  // ---------- 4. 全库不存在布尔 mastered 值 ----------
  {
    const rows = await db.stubbornWords.toArray();
    const booleans = rows.filter(s => typeof s.mastered === 'boolean');
    check('业务库不存在布尔 mastered 记录', booleans.length === 0, `实际 ${json(booleans)}`);
    const idb = await openRaw('ThaiLearnDB');
    const indexed = await countIndex(idb, 'stubbornWords', 'mastered');
    idb.close();
    check('业务库 mastered 索引覆盖全部记录', indexed === rows.length, `索引 ${indexed} 条，表 ${rows.length} 条`);
  }

  // ---------- 5. 备份恢复归一化 ----------
  {
    check('恢复归一化函数已导出', typeof normalizeStubbornMastered === 'function', `实际 ${typeof normalizeStubbornMastered}`);
    if (typeof normalizeStubbornMastered === 'function') {
      const cases = [[false, 0], [true, 1], [0, 0], [1, 1], [2, 0], [undefined, 0], [null, 0], ['x', 0]];
      for (const [input, expected] of cases) {
        check(`归一化 ${json(input) ?? String(input)} → ${expected}`, normalizeStubbornMastered(input) === expected, `实际 ${json(normalizeStubbornMastered(input))}`);
      }
    }
  }

  // ---------- 6. 旧版 boolean 数据迁移 ----------
  {
    check('Dexie 声明版本为 2', db.verno === 2, `实际 ${db.verno}`);
    check('ThaiLearnDB 构造函数支持传入隔离库名', new ThaiLearnDB(STUBBORN_LEGACY_DB).name === STUBBORN_LEGACY_DB, `实际 ${new ThaiLearnDB(STUBBORN_LEGACY_DB).name}`);

    const legacyStubborn = [
      { wordId: 11, errorCount: 5, addedAt: 1700000000000, mastered: false },
      { wordId: 12, errorCount: 9, addedAt: 1700000001000, mastered: true },
      { wordId: 13, errorCount: 3, addedAt: 1700000002000, mastered: false },
      { wordId: 14, errorCount: 4, addedAt: 1700000003000 },
      { wordId: 15, errorCount: 7, addedAt: 1700000004000, mastered: 2 },
    ];
    const legacyWords = [
      { id: 1, thai: 'สวัสดี', toneMark: 'mid', meaning: '你好', pos: '问候', example: '', note: '', tags: ['问候'], romanization: 'sà-wàt-dee', createdAt: 1, updatedAt: 1 },
      { id: 2, thai: 'นก', toneMark: '', meaning: '鸟', pos: '名词', example: '', note: '', tags: [], createdAt: 2, updatedAt: 2 },
    ];
    const legacyReviewStates = [{ wordId: 1, difficulty: 5, stability: 1, reps: 0, lapses: 0, lastReview: 0, nextReview: 1700000000000, state: 0 }];
    const legacyErrorRecords = [
      { id: 1, wordId: 11, errorType: 'tone', question: 'q', userAnswer: 'a', correctAnswer: 'b', timestamp: 1700000000000, date: '2026-11-13' },
      { id: 2, wordId: 11, errorType: 'tone', question: 'q', userAnswer: 'a', correctAnswer: 'b', timestamp: 1700000000500, date: '2026-11-13' },
      { id: 3, wordId: 12, errorType: 'spelling', question: 'q', userAnswer: 'a', correctAnswer: 'b', timestamp: 1700000001000, date: '2026-11-12' },
    ];
    const legacyDailyStats = [
      { date: '2026-11-12', newWords: 3, reviewsDone: 10, streakDays: 4 },
      { date: '2026-11-13', newWords: 1, reviewsDone: 2, streakDays: 5 },
    ];
    const legacySettings = [
      { key: 'stubbornThreshold', value: '3' },
      { key: 'grammarSeeded', value: '1700000000000' },
    ];
    const legacyGrammar = [{ id: 1, title: 'ครับ/ค่ะ', content: '礼貌词', patterns: [], examples: [], order: 0 }];
    const seed = {
      stubbornWords: legacyStubborn,
      words: legacyWords,
      reviewStates: legacyReviewStates,
      errorRecords: legacyErrorRecords,
      dailyStats: legacyDailyStats,
      settings: legacySettings,
      grammarPoints: legacyGrammar,
      colloquialNotes: [],
      minimalPairGroups: [],
      referenceWords: [],
    };

    // 6.1 先造出真实的 v1 旧库（表结构 + 索引全部由原生 IndexedDB 建立）
    const legacyIdb = await openRaw(STUBBORN_LEGACY_DB, 1, (idb) => {
      for (const [name, spec] of Object.entries(LEGACY_V1_STORES)) {
        const { keyPath, autoIncrement, indexes } = parseStoreSpec(spec);
        const store = idb.createObjectStore(name, { keyPath, autoIncrement });
        for (const idx of indexes) store.createIndex(idx.name, idx.name, { unique: false, multiEntry: idx.multiEntry });
      }
    });
    for (const [name, rows] of Object.entries(seed)) await putRows(legacyIdb, name, rows);

    check('旧库版本号 1', legacyIdb.version === 1, `实际 ${legacyIdb.version}`);
    check('旧库表格仍是 5 条（迁移不得丢记录）', (await readAll(legacyIdb, 'stubbornWords')).length === 5);
    // 布尔值不是合法索引键，只有 mastered=2 这条脏数据进了索引。
    check('旧库 mastered 索引未覆盖布尔值记录', (await countIndex(legacyIdb, 'stubbornWords', 'mastered')) === 1, `实际 ${await countIndex(legacyIdb, 'stubbornWords', 'mastered')}`);
    let rangeError = null;
    try { IDBKeyRange.only(false); } catch (e) { rangeError = e; }
    check('用布尔值构造索引键查询会直接报 DataError', rangeError?.name === 'DataError', `实际 ${rangeError?.name ?? '未抛错'}`);
    legacyIdb.close();

    // 6.2 用修复后的类打开同一个库，触发 version(2) 迁移
    const migrated = new ThaiLearnDB(STUBBORN_LEGACY_DB);
    const migratedRows = await migrated.stubbornWords.toArray();
    check('迁移后版本号升到 2', migrated.verno === 2, `实际 ${migrated.verno}`);
    check('迁移后记录条数不变', migratedRows.length === 5, `实际 ${migratedRows.length}`);
    check('迁移后主键 wordId 不变', json(migratedRows.map(r => r.wordId)) === json([11, 12, 13, 14, 15]), `实际 ${json(migratedRows.map(r => r.wordId))}`);
    check('迁移后 false → 0', migratedRows.find(r => r.wordId === 11)?.mastered === 0, `实际 ${json(migratedRows.find(r => r.wordId === 11)?.mastered)}`);
    check('迁移后 true → 1', migratedRows.find(r => r.wordId === 12)?.mastered === 1, `实际 ${json(migratedRows.find(r => r.wordId === 12)?.mastered)}`);
    check('迁移后缺失字段按未掌握处理', migratedRows.find(r => r.wordId === 14)?.mastered === 0, `实际 ${json(migratedRows.find(r => r.wordId === 14)?.mastered)}`);
    check('迁移后意外数字 2 归零', migratedRows.find(r => r.wordId === 15)?.mastered === 0, `实际 ${json(migratedRows.find(r => r.wordId === 15)?.mastered)}`);
    check('迁移保留 errorCount / addedAt 等字段', json(migratedRows.map(stripMastered)) === json(legacyStubborn.map(stripMastered)), `实际 ${json(migratedRows.map(stripMastered))}`);
    check('迁移不产生布尔 mastered', migratedRows.every(r => typeof r.mastered === 'number'), `实际 ${json(migratedRows.map(r => r.mastered))}`);
    check('迁移后 mastered 只有 0 或 1', migratedRows.every(r => r.mastered === 0 || r.mastered === 1), `实际 ${json(migratedRows.map(r => r.mastered))}`);

    const migratedUnmastered = await migrated.stubbornWords.where('mastered').equals(0).toArray();
    const migratedMastered = await migrated.stubbornWords.where('mastered').equals(1).toArray();
    check('迁移后未掌握查询命中 4 条', json(migratedUnmastered.map(r => r.wordId)) === json([11, 13, 14, 15]), `实际 ${json(migratedUnmastered.map(r => r.wordId))}`);
    check('迁移后已掌握查询命中 1 条', json(migratedMastered.map(r => r.wordId)) === json([12]), `实际 ${json(migratedMastered.map(r => r.wordId))}`);
    const migratedIdb = await openRaw(STUBBORN_LEGACY_DB);
    check('迁移后 mastered 索引覆盖全部记录', (await countIndex(migratedIdb, 'stubbornWords', 'mastered')) === 5);
    migratedIdb.close();

    // 6.3 其他表必须原样保留（toArray 按主键序返回，比较前先统一排序）
    for (const [name, rows] of Object.entries(seed)) {
      if (name === 'stubbornWords') continue;
      const after = await migrated.table(name).toArray();
      check(`迁移不影响 ${name} 表`, json(byPk(after)) === json(byPk(rows)), `迁移后 ${json(byPk(after))}`);
    }
    migrated.close();
  }

  // ---------- 7. 幂等：已迁移库重复打开不再改写 ----------
  {
    const reopened = new ThaiLearnDB(STUBBORN_LEGACY_DB);
    const rows = await reopened.stubbornWords.toArray();
    check('重复打开不重复改写数据', json(rows.map(r => [r.wordId, r.mastered])) === json([[11, 0], [12, 1], [13, 0], [14, 0], [15, 0]]), `实际 ${json(rows.map(r => [r.wordId, r.mastered]))}`);
    reopened.close();
  }
}

try {
  await main();
} catch (e) {
  check('测试套件完整执行未中断', false, String(e?.stack ?? e));
}

for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n        ${r.detail}`}`);
}
console.log(`\n共 ${results.length} 项，通过 ${results.length - failed} 项，失败 ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
