// 跟读录音（voiceClips 表）+ 批量删除级联 + 录音备份 base64 往返回归测试。
// 运行：node tests/voice-clips.test.mjs
// 隔离性：本文件只在 node 进程内的 fake-indexeddb（内存实现）里建库，进程退出即销毁，
// 不会接触浏览器里的 ThaiLearnDB、本地学习数据或线上数据。
// v2→v3 升级用例另用一个独立库名，与业务库名分开。
import 'fake-indexeddb/auto';
import { createServer } from 'vite';

const V2_LEGACY_DB = 'ThaiLearnDB-v2-legacy-for-v3-test';

// v3 之前线上设备实际携带的结构，测试里冻结一份，不跟随生产代码变化。
const PRE_V3_STORES = {
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
const race = (promise, label, ms = 8000) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`超时：${label}`)), ms)),
]);
const clip = (text, type = 'audio/webm') => new Blob([text], { type });
const keyOf = (table) => `${table.schema.primKey.auto ? '++' : ''}${table.schema.primKey.keyPath}`;
const indexesOf = (table) => table.schema.indexes.map(i => i.name).sort();

function buildLegacyDb(name, stores) {
  return race(new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 2);
    req.onupgradeneeded = () => {
      const raw = req.result;
      for (const [storeName, spec] of Object.entries(stores)) {
        const parts = spec.split(',').map(s => s.trim());
        const auto = parts[0].startsWith('++');
        const keyPath = auto ? parts[0].slice(2) : parts[0];
        const store = raw.createObjectStore(storeName, { keyPath, autoIncrement: auto });
        for (const idx of parts.slice(1)) {
          const multi = idx.startsWith('*');
          const key = multi ? idx.slice(1) : idx;
          store.createIndex(key, key, { multiEntry: multi });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }), `build ${name}`);
}

function putRawRows(idb, storeName, rows) {
  return race(new Promise((resolve, reject) => {
    const tx = idb.transaction(storeName, 'readwrite');
    // 行内键（in-line key）不能再传第二参数，否则 IDB 直接报 DataError。
    for (const row of rows) tx.objectStore(storeName).put(row);
    tx.oncomplete = () => resolve(rows);
    tx.onerror = () => reject(tx.error);
  }), `put ${storeName}`);
}

async function main() {
  const server = await createServer({
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { ThaiLearnDB, db } = await server.ssrLoadModule('/src/db/index.ts');
    const vocab = await server.ssrLoadModule('/src/db/vocabulary.ts');
    const clips = await server.ssrLoadModule('/src/db/voiceClips.ts');
    const b64 = await server.ssrLoadModule('/src/lib/base64.ts');

    // ---------- 1. v3 只新增录音表，已有 schema 一字未动 ----------
    check('Dexie 声明版本已到 4（v4 只加速刷状态表）', db.verno === 4, `实际 ${db.verno}`);
    check('录音表已声明', !!db.voiceClips, `实际 ${json(Object.keys(db.tables))}`);
    check('录音表索引为 ++id, wordId, createdAt',
      json([keyOf(db.voiceClips), indexesOf(db.voiceClips)]) === json(['++id', ['createdAt', 'wordId']]),
      `实际 ${json([keyOf(db.voiceClips), indexesOf(db.voiceClips)])}`);

    for (const [name, spec] of Object.entries(PRE_V3_STORES)) {
      const parts = spec.split(',').map(s => s.trim());
      const wantKey = parts[0];
      const wantIndexes = parts.slice(1).map(i => i.replace('*', '')).sort();
      check(`v3 未改动 ${name} 的主键`, keyOf(db[name]) === wantKey, `实际 ${keyOf(db[name])}`);
      check(`v3 未改动 ${name} 的索引`, json(indexesOf(db[name])) === json(wantIndexes), `实际 ${json(indexesOf(db[name]))}`);
    }

    // ---------- 2. 老设备（v2 结构）升级到 v3：数据保留 + 只多出空表 ----------
    {
      const legacy = await buildLegacyDb(V2_LEGACY_DB, PRE_V3_STORES);
      const legacyWords = [{ id: 1, thai: 'กิน', meaning: '吃', toneMark: 'mid', pos: '', example: '', note: '', tags: ['日常'], createdAt: 1000, updatedAt: 1000 }];
      const legacyStates = [{ wordId: 1, difficulty: 5, stability: 1, reps: 2, lapses: 0, lastReview: 900, nextReview: 2000, state: 2 }];
      await putRawRows(legacy, 'words', legacyWords);
      await putRawRows(legacy, 'reviewStates', legacyStates);
      await putRawRows(legacy, 'settings', [{ key: 'grammarSeeded', value: '1700000000000' }]);
      legacy.close();

      const upgraded = new ThaiLearnDB(V2_LEGACY_DB);
      check('老库打开后一路升到 4', upgraded.verno === 4, `实际 ${upgraded.verno}`);
      check('升级新增的录音表是空的', (await upgraded.voiceClips.count()) === 0, `实际 ${await upgraded.voiceClips.count()}`);
      check('升级不改动单词记录', json(await upgraded.words.toArray()) === json(legacyWords), `实际 ${json(await upgraded.words.toArray())}`);
      check('升级不改动复习进度', json(await upgraded.reviewStates.toArray()) === json(legacyStates), `实际 ${json(await upgraded.reviewStates.toArray())}`);
      check('升级不改动 settings', (await upgraded.settings.get('grammarSeeded'))?.value === '1700000000000', `实际 ${json(await upgraded.settings.toArray())}`);
      await upgraded.delete();
    }

    // ---------- 3. 录音读写 ----------
    await Promise.all([db.words, db.reviewStates, db.errorRecords, db.stubbornWords, db.minimalPairGroups, db.voiceClips, db.settings].map(t => t.clear()));

    const wordA = await vocab.addWord({ thai: 'กิน', meaning: '吃', toneMark: 'mid', pos: '动词', example: '', note: '', tags: [] });
    const clipA1 = await clips.addClip(wordA, clip('clip-a1'), 3200);
    const clipA2 = await clips.addClip(wordA, clip('clip-a2', 'audio/mp4'), 1500);
    const clipA3 = await clips.addClip(wordA, clip('clip-a3'));
    const clipA4 = await clips.addClip(wordA, clip('clip-a4', ''));

    const list = await clips.getClipsForWord(wordA);
    check('按词取回全部录音', list.length === 4, `实际 ${list.length}`);
    check('录音按录制时间先后返回', json(list.map(c => c.id)) === json([clipA1, clipA2, clipA3, clipA4]), `实际 ${json(list.map(c => c.id))}`);
    check('录音内容原样存回', (await list[0].blob.text()) === 'clip-a1', `实际 ${await list[0].blob.text()}`);
    check('录音格式随记录保存', list[1].mime === 'audio/mp4', `实际 ${list[1].mime}`);
    check('无格式录音补默认 webm 记账', list[3].mime === 'audio/webm', `实际 ${list[3].mime}`);
    check('时长随记录保存', list[0].durationMs === 3200, `实际 ${list[0].durationMs}`);
    check('文件导入的录音允许没有时长', list[2].durationMs === undefined && list[3].durationMs === undefined, `实际 ${json(list.map(c => c.durationMs))}`);
    check('其他词查不到本词的录音', (await clips.getClipsForWord(9999)).length === 0, `实际 ${(await clips.getClipsForWord(9999)).length}`);

    await clips.deleteClip(clipA2);
    const afterDelete = await clips.getClipsForWord(wordA);
    check('删除单条录音只删一条', json(afterDelete.map(c => c.id)) === json([clipA1, clipA3, clipA4]), `实际 ${json(afterDelete.map(c => c.id))}`);

    // ---------- 4. 批量删除的级联 ----------
    const wordB = await vocab.addWord({ thai: 'น้ำ', meaning: '水', toneMark: 'mid', pos: '名词', example: '', note: '', tags: [] });
    const wordC = await vocab.addWord({ thai: 'แมว', meaning: '猫', toneMark: 'mid', pos: '名词', example: '', note: '', tags: [] });
    const mkState = (id) => ({ wordId: id, difficulty: 5, stability: 1, reps: 1, lapses: 0, lastReview: 1, nextReview: 2, state: 1 });
    await db.reviewStates.bulkAdd([wordA, wordB, wordC].map(mkState));
    await db.errorRecords.bulkAdd([wordA, wordB, wordC].map(id => ({ wordId: id, errorType: 'review', question: 'ก', userAnswer: 'x', correctAnswer: 'y', timestamp: 1, date: '2026-11-21' })));
    await db.stubbornWords.bulkAdd([{ wordId: wordA, errorCount: 4, addedAt: 1, mastered: 0 }, { wordId: wordC, errorCount: 4, addedAt: 1, mastered: 0 }]);
    await clips.addClip(wordB, clip('clip-b1'));
    await clips.addClip(wordC, clip('clip-c1'));

    const groupMixed = await db.minimalPairGroups.add({ name: '组-含三词', wordIds: [wordA, wordB, wordC], createdAt: 1 });
    const groupDoomed = await db.minimalPairGroups.add({ name: '组-只含待删词', wordIds: [wordA], createdAt: 2 });
    const groupClean = await db.minimalPairGroups.add({ name: '组-与删除无关', wordIds: [wordC], createdAt: 3 });
    const groupBefore = json(await db.minimalPairGroups.get(groupClean));
    const wordCBefore = json(await db.words.get(wordC));
    const stateCBefore = json(await db.reviewStates.get(wordC));

    check('空选择不删除任何数据', (await vocab.deleteWords([])) === 0 && (await db.words.count()) === 3, `返回 ${await vocab.deleteWords([])}，剩余 ${await db.words.count()}`);

    const removed = await vocab.deleteWords([wordA, wordB]);
    check('批量删除返回条数', removed === 2, `实际 ${removed}`);
    check('批量删除移走选中单词', json((await db.words.toArray()).map(w => w.id)) === json([wordC]), `实际 ${json(await db.words.toArray())}`);
    check('批量删除级联复习进度', json((await db.reviewStates.toArray()).map(s => s.wordId)) === json([wordC]), `实际 ${json(await db.reviewStates.toArray())}`);
    check('批量删除级联错题记录', json((await db.errorRecords.toArray()).map(e => e.wordId)) === json([wordC]), `实际 ${json(await db.errorRecords.toArray())}`);
    check('批量删除级联顽固词标记', json((await db.stubbornWords.toArray()).map(s => s.wordId)) === json([wordC]), `实际 ${json(await db.stubbornWords.toArray())}`);
    check('批量删除级联跟读录音', json((await db.voiceClips.toArray()).map(c => c.wordId)) === json([wordC]), `实际 ${json(await db.voiceClips.toArray())}`);

    check('对比组只摘掉被删的关联', json((await db.minimalPairGroups.get(groupMixed))?.wordIds) === json([wordC]), `实际 ${json(await db.minimalPairGroups.get(groupMixed))}`);
    check('全空的对比组被收掉', (await db.minimalPairGroups.get(groupDoomed)) === undefined, `实际 ${json(await db.minimalPairGroups.get(groupDoomed))}`);
    check('只剩一个词的对比组保留', json((await db.minimalPairGroups.get(groupClean))?.wordIds) === json([wordC]), `实际 ${json(await db.minimalPairGroups.get(groupClean))}`);
    check('未选中单词的记录一字未改', json(await db.words.get(wordC)) === wordCBefore, `实际 ${json(await db.words.get(wordC))}`);
    check('未选中单词的复习进度一字未改', json(await db.reviewStates.get(wordC)) === stateCBefore, `实际 ${json(await db.reviewStates.get(wordC))}`);
    check('无关对比组的 wordIds 一字未改', json(await db.minimalPairGroups.get(groupClean)) === groupBefore, `实际 ${json(await db.minimalPairGroups.get(groupClean))}`);

    // 单条删除与批量共用同一条级联，重构后行为不能变窄
    const wordD = await vocab.addWord({ thai: 'หมา', meaning: '狗', toneMark: 'mid', pos: '名词', example: '', note: '', tags: [] });
    await db.reviewStates.add(mkState(wordD));
    await db.errorRecords.add({ wordId: wordD, errorType: 'tone', question: 'ก', userAnswer: 'x', correctAnswer: 'y', timestamp: 1, date: '2026-11-21' });
    await db.stubbornWords.add({ wordId: wordD, errorCount: 3, addedAt: 1, mastered: 1 });
    await clips.addClip(wordD, clip('clip-d1'));
    const groupD = await db.minimalPairGroups.add({ name: '组-单删目标', wordIds: [wordD, wordC], createdAt: 4 });
    await vocab.deleteWord(wordD);
    check('单条删除级联单词与复习进度', (await db.words.get(wordD)) === undefined && (await db.reviewStates.get(wordD)) === undefined, `实际 ${json({ w: await db.words.get(wordD), r: await db.reviewStates.get(wordD) })}`);
    check('单条删除级联错题记录', (await db.errorRecords.where('wordId').equals(wordD).count()) === 0, `实际 ${await db.errorRecords.where('wordId').equals(wordD).count()}`);
    check('单条删除级联顽固词标记', (await db.stubbornWords.get(wordD)) === undefined, `实际 ${json(await db.stubbornWords.get(wordD))}`);
    check('单条删除级联跟读录音', (await db.voiceClips.where('wordId').equals(wordD).count()) === 0, `实际 ${await db.voiceClips.where('wordId').equals(wordD).count()}`);
    check('单条删除清理对比组关联', json((await db.minimalPairGroups.get(groupD))?.wordIds) === json([wordC]), `实际 ${json(await db.minimalPairGroups.get(groupD))}`);

    // ---------- 5. 备份里的 base64 往返 ----------
    const kept = await db.voiceClips.toArray();
    const keptWord = await db.words.get(wordC);
    const encoded = await clips.encodeClipsForBackup();
    check('备份导出覆盖全部录音', encoded.length === kept.length, `实际 ${encoded.length} / ${kept.length}`);
    check('备份里的录音是 base64 文本', encoded.every(c => typeof c.data === 'string' && /^[A-Za-z0-9+/=]+$/.test(c.data)), `实际 ${json(encoded.map(c => c.data.slice(0, 12)))}`);
    check('备份保留录音归属、时长与时间戳', encoded.every(c => typeof c.id === 'number' && typeof c.wordId === 'number' && typeof c.createdAt === 'number'), `实际 ${json(encoded)}`);
    check('备份不改动库内录音', json((await db.voiceClips.toArray()).map(c => c.id).sort()) === json(kept.map(c => c.id).sort()), `实际 ${json(await db.voiceClips.toArray())}`);
    check('备份不影响单词数据', json(await db.words.get(wordC)) === wordCBefore, `实际 ${json(await db.words.get(wordC))} vs ${wordCBefore} / ${json(keptWord)}`);

    const viaJson = JSON.parse(JSON.stringify({ voiceClips: encoded }));
    const decoded = clips.decodeClipsForRestore(viaJson.voiceClips);
    check('解码条数与备份一致', decoded.length === encoded.length, `实际 ${decoded.length}`);
    const originalBlob = await db.voiceClips.get(encoded[0].id);
    check('解码后录音内容还原', (await decoded[0].blob.text()) === (await originalBlob.blob.text()), `实际 ${await decoded[0].blob.text()} / ${await originalBlob.blob.text()}`);
    check('解码后 id 原样保留，可按 id 覆盖', json([...decoded.map(c => c.id)].sort()) === json([...encoded.map(c => c.id)].sort()), `实际 ${json(decoded.map(c => c.id))}`);
    check('解码保留无时长记录', decoded.every(c => c.durationMs === undefined || typeof c.durationMs === 'number'), `实际 ${json(decoded.map(c => c.durationMs))}`);

    check('老备份（无录音字段）解码为空', clips.decodeClipsForRestore(undefined).length === 0, `实际 ${json(clips.decodeClipsForRestore(undefined))}`);
    check('空录音字段解码为空', clips.decodeClipsForRestore([]).length === 0, `实际 ${json(clips.decodeClipsForRestore([]))}`);
    check('非数组的录音字段解码为空', clips.decodeClipsForRestore('oops').length === 0, `实际 ${json(clips.decodeClipsForRestore('oops'))}`);
    const dirty = clips.decodeClipsForRestore([
      { id: 1, wordId: 1, createdAt: 1, data: 'AAAA' },
      { id: 2, wordId: 1, createdAt: 2 },
      { id: 3, wordId: 1, createdAt: 3, data: '!!!不是base64!!!' },
      { wordId: 'x', createdAt: 4, data: 'AAAA' },
      null,
    ]);
    check('坏录音行跳过，好录音行保留', json(dirty.map(c => c.id)) === json([1]), `实际 ${json(dirty.map(c => c.id))}`);

    const big = new Blob([new Uint8Array(200_000).fill(7)], { type: 'audio/webm' });
    const bigBack = b64.base64ToBlob(await b64.blobToBase64(big), 'audio/webm');
    const bigBytes = new Uint8Array(await bigBack.arrayBuffer());
    check('大录音 base64 往返字节不变', bigBytes.length === 200_000 && bigBytes.every(b => b === 7), `实际 ${bigBytes.length}`);
    check('非 ASCII 内容也能往返', (await b64.base64ToBlob(await b64.blobToBase64(new Blob(['สวัสดี吃'])), 'audio/webm').text()) === 'สวัสดี吃');

    // 恢复语义：按 id 覆盖（bulkPut），不整表清空
    await db.voiceClips.bulkPut(decoded);
    check('按 id 覆盖恢复不新增重复录音', (await db.voiceClips.count()) === kept.length, `实际 ${await db.voiceClips.count()}`);
    const clipAfterBackup = await clips.addClip(wordC, clip('clip-new'));
    await db.voiceClips.bulkPut(clips.decodeClipsForRestore(viaJson.voiceClips));
    check('旧备份恢复不会清掉之后新录的内容', (await db.voiceClips.get(clipAfterBackup)) !== undefined, `实际 ${json(await db.voiceClips.get(clipAfterBackup))}`);
  } finally {
    await server.close();
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
