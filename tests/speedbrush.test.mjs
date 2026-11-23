// 单词速刷回归测试：分类/范围/方向/顺序/翻卡/作答/统计/不认识名单的纯逻辑，
// 速刷状态的持久化与 v3→v4 迁移，以及最重要的数据隔离——跑完整一轮速刷后，
// 词库、排期、错题、顽固词、每日统计逐字节不变。
// 运行：node tests/speedbrush.test.mjs
// 隔离性：只在 node 进程内的 fake-indexeddb（内存实现）里建库，进程退出即消失，
// 不会接触浏览器里的 ThaiLearnDB、本地学习数据或线上数据。
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const V3_LEGACY_DB = 'ThaiLearnDB-v3-legacy-for-v4-test';

// v4 之前线上设备实际携带的结构，测试里冻结一份，不跟随生产代码变化。
const PRE_V4_STORES = {
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
  voiceClips: '++id, wordId, createdAt',
};

const results = [];
let failed = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed++;
}
const json = (v) => JSON.stringify(v);
const race = (promise, label, ms = 30000) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`超时：${label}`)), ms)),
]);
const keyOf = (table) => `${table.schema.primKey.auto ? '++' : ''}${table.schema.primKey.keyPath}`;
const indexesOf = (table) => table.schema.indexes.map(i => i.name).sort();

function buildLegacyDb(name, version, stores) {
  return race(new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
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

// 默认口径冻结在测试里，改生产默认值必须同时改这里。
const WANT_DEFAULTS = { category: '', scope: 'all', direction: 'thai-to-cn', order: 'original', autoAdvance: true };

// 速刷不许碰的写入口与排期面（源码文本级守卫，覆盖页面与逻辑两层）。
const FORBIDDEN = [
  'GRADE_TABLE', 'gradeReview', 'initNewWordReview', 'ungraduateWord', 'planReviewSession',
  'planSessionCounts', 'nextReviewTime', 'gradeSpec', 'isGraduated',
  'addErrorRecord', 'updateStreak', 'getOrCreateDailyStat', 'getTodayStats', 'recordDailyActivity',
  'addWord', 'updateWord', 'deleteWord', 'deleteWords', 'importWords', 'getWord',
  'reviewStates', 'dailyStats', 'errorRecords', 'stubbornWords', 'voiceClips', 'minimalPairGroups',
  'mountAudioBar', 'word-detail', 'audio-bar', "from 'dexie'", 'db.', '.put(', '.bulkAdd(', '.bulkPut(',
];

function readSrc(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

// 只允许白名单依赖：速刷拿不到 Dexie 实例，就写不了任何表。
function importSpecs(src) {
  return [...src.matchAll(/from\s+'([^']+)'/g)].map(m => m[1]);
}

const mk = (n, tag, tags = ['速刷']) => Array.from({ length: n }, (_, i) => ({
  thai: `${tag}${i}`,
  meaning: `${tag}义${i}`,
  toneMark: i % 2 ? 'high' : 'mid',
  pos: i % 3 === 0 ? '名词' : '',
  example: i % 4 === 0 ? `ตัวอย่าง${i}` : '',
  note: '',
  tags,
}));

// 纯逻辑用例要带主键的对象：统计按 id 记，缺 id 的多张卡会并成同一个键。
const deck = (n, tag) => mk(n, tag, [tag]).map((word, i) => ({ ...word, id: i + 1 }));

async function main() {
  const server = await createServer({
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true, include: [] },
  });

  let db, ThaiLearnDB, sb, vocab, review, errors, speedStatus, speedProgress;
  try {
    ({ db, ThaiLearnDB } = await server.ssrLoadModule('/src/db/index.ts'));
    sb = await server.ssrLoadModule('/src/lib/speedbrush.ts');
    vocab = await server.ssrLoadModule('/src/db/vocabulary.ts');
    review = await server.ssrLoadModule('/src/db/review.ts');
    errors = await server.ssrLoadModule('/src/db/errors.ts');
    speedStatus = await server.ssrLoadModule('/src/db/speedStatus.ts');
    speedProgress = await server.ssrLoadModule('/src/lib/speedProgress.ts');
  } finally {
    await server.close();
  }

  const {
    ALL_CATEGORIES, DEFAULT_SETTINGS, SCOPE_OPTIONS, buildCategoryOptions, buildScopeOptions,
    createSession, currentCard, filterByCategory, filterByScope, isFirstCard, isLastCard,
    positionOf, revealCard, goNext, goPrev, canMark, setMark, markOf, unknownCards, statsOf,
    frontText, answerText, restartSession, reshuffleSession, keepUnknownOnly, cardKey,
    isSameSequence, restoreSession,
  } = sb;
  const { loadSpeedProgress, saveSpeedProgress, clearSpeedProgress } = speedProgress;

  // ---------- 1. 依赖与源码守卫：速刷根本没有拿到写库的手 ----------
  const libSrc = readSrc('src/lib/speedbrush.ts');
  const pageSrc = readSrc('src/pages/speedbrush.ts');
  const statusSrc = readSrc('src/db/speedStatus.ts');
  const progressSrc = readSrc('src/lib/speedProgress.ts');
  check('逻辑层只依赖 db 类型与 utils',
    json(importSpecs(libSrc)) === json(['../db/index', './utils']),
    `实际 ${json(importSpecs(libSrc))}`);
  check('逻辑层的词库引用是 import type（编译后即消失）',
    /import type \{ SpeedStatus, Word \} from '\.\.\/db\/index'/.test(libSrc));
  check('页面层依赖全在白名单内',
    json(importSpecs(pageSrc)) === json(['../lib/utils', '../db/vocabulary', '../db/speedStatus', '../lib/route-guard', '../components/card-speak', '../lib/speedProgress', '../lib/speedbrush']),
    `实际 ${json(importSpecs(pageSrc))}`);
  // 朗读是复习卡已有的能力，速刷只借用同一个组件：语音实现不重写，也不许绕过组件直接碰 Web Speech。
  check('页面层不自己实现语音',
    !/lib\/speech|SpeechSynthesis|speakThai/.test(pageSrc) && /from '..\/components\/card-speak'/.test(pageSrc));
  check('页面唯一的取数入口是 getAllWords',
    /import \{ getAllWords, type Word \} from '\.\.\/db\/vocabulary'/.test(pageSrc) &&
    (pageSrc.match(/getAllWords\(\)/g) || []).length === 1,
    `调用 ${(pageSrc.match(/getAllWords\(\)/g) || []).length} 次`);
  check('页面读状态表只有一个整表入口',
    /import \{ loadSpeedStatuses, saveSpeedStatus \} from '\.\.\/db\/speedStatus'/.test(pageSrc) &&
    (pageSrc.match(/loadSpeedStatuses\(\)/g) || []).length === 1,
    `调用 ${(pageSrc.match(/loadSpeedStatuses\(\)/g) || []).length} 次`);
  for (const token of FORBIDDEN) {
    const hit = [libSrc, pageSrc, progressSrc].filter(src => src.includes(token)).length;
    if (hit > 0) check(`源码不引用「${token}」`, false, `命中 ${hit} 个文件`);
  }
  check('速刷源码不引用任何排期/错题/统计写入口',
    ![libSrc, pageSrc, progressSrc].some(src => FORBIDDEN.some(token => src.includes(token))));
  // 进度层连类型都不必借词库：唯一的依赖是速刷逻辑层的记录形状。
  check('进度层依赖只有速刷逻辑层，且是 import type',
    json(importSpecs(progressSrc)) === json(['./speedbrush'])
    && /import type \{ SpeedProgressRecord \} from '\.\/speedbrush'/.test(progressSrc),
    `实际 ${json(importSpecs(progressSrc))}`);
  check('进度只写 localStorage，不经过任何 Dexie 表',
    /localStorage/.test(progressSrc) && !/indexedDB|IDBKeyRange|Dexie/.test(progressSrc));
  check('进度键名固定，不会和别的本地数据撞',
    /const STORAGE_KEY = 'thailearn\.speedbrush\.progress';/.test(progressSrc));
  // 状态层是唯一允许写库的速刷文件，因此单独守：只碰 speedStatuses，别的表名一个都不许出现。
  check('状态层依赖只有 db 入口',
    json([...new Set(importSpecs(statusSrc))]) === json(['./index']),
    `实际 ${json(importSpecs(statusSrc))}`);
  check('状态层不引用任何排期表与排期函数',
    !FORBIDDEN.filter(token => token !== 'db.' && token !== '.put(' && token !== '.bulkAdd(' && token !== '.bulkPut(')
      .some(token => statusSrc.includes(token)));

  // ---------- 2. 分类：默认全部，标签去重计数 ----------
  const words = [
    { id: 1, thai: 'สวัสดี', meaning: '你好', toneMark: 'mid', pos: '感叹词', example: '', note: '', tags: ['问候', '常用'] },
    { id: 2, thai: 'ขอบคุณ', meaning: '谢谢', toneMark: 'high', pos: '', example: '', note: '', tags: ['问候'] },
    { id: 3, thai: 'น้ำ', meaning: '水', toneMark: 'mid', pos: '名词', example: '', note: '喝水', tags: ['餐饮', ' 常用 '] },
    { id: 4, thai: 'ข้าว', meaning: '米饭', toneMark: 'mid', pos: '', example: '', note: '', tags: ['餐饮'] },
    { id: 5, thai: 'ไก่', meaning: '鸡', toneMark: 'mid', pos: '', example: '', note: '', tags: [] },
  ];
  const cats = buildCategoryOptions(words);
  check('分类首项是「全部」哨兵且计数=词库总量',
    cats[0].name === ALL_CATEGORIES && cats[0].count === 5, `实际 ${json(cats[0])}`);
  check('标签去掉首尾空格后合并同类', cats.some(c => c.name === '常用' && c.count === 2), json(cats));
  check('分类按词数降序、同数按名称', json(cats.map(c => c.count)) === json([5, 2, 2, 2]), json(cats.map(c => [c.name, c.count])));
  check('空标签不产生分类', cats.some(c => c.name === '') === true && cats.filter(c => c.name === '').length === 1);
  check('「全部」返回浅拷贝，不改原数组', (() => {
    const all = filterByCategory(words, ALL_CATEGORIES);
    return json(all) === json(words) && all !== words;
  })());
  check('按分类筛选只取带该标签的词',
    json(filterByCategory(words, '问候').map(w => w.id)) === json([1, 2]));
  check('筛不存在的分类得到空列表（页面据此禁用开始）',
    filterByCategory(words, '没有这个标签').length === 0);

  // ---------- 3. 方向是显示层的唯一真相源 ----------
  check('泰→中 正面泰文、背面中文', frontText(words[0], 'thai-to-cn') === 'สวัสดี' && answerText(words[0], 'thai-to-cn') === '你好');
  check('中→泰 正面中文、背面泰文', frontText(words[0], 'cn-to-thai') === '你好' && answerText(words[0], 'cn-to-thai') === 'สวัสดี');

  // ---------- 4. 顺序：原始一次成型，随机不重不漏 ----------
  check('默认设置就是裁定口径', json(DEFAULT_SETTINGS) === json(WANT_DEFAULTS), json(DEFAULT_SETTINGS));
  const raw = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, thai: `ท${i}`, meaning: `义${i}`, toneMark: 'mid', pos: '', example: '', note: '', tags: ['原始'] }));
  const original = createSession(raw, { ...DEFAULT_SETTINGS });
  check('原始顺序 = 传入词表顺序', json(original.cards.map(w => w.id)) === json(raw.map(w => w.id)));
  const random = createSession(raw, { ...DEFAULT_SETTINGS, order: 'random' });
  check('随机顺序张数不变', random.cards.length === 30, `实际 ${random.cards.length}`);
  check('随机不出现重复单词', new Set(random.cards.map(w => w.id)).size === 30);
  check('随机是同一批词的重排（不漏词）',
    json([...random.cards.map(w => w.id)].sort((a, b) => a - b)) === json(raw.map(w => w.id)));
  check('随机只在开始时生成一次：连查 currentCard 不漂移',
    currentCard(random) === currentCard(random) && json(random.cards.map(w => w.id)) === json(random.cards.map(w => w.id)));
  check('会话里的设置是副本，外部改动不影响本轮', (() => {
    const preset = { ...DEFAULT_SETTINGS };
    const s = createSession(raw, preset);
    preset.direction = 'cn-to-thai';
    return s.settings.direction === 'thai-to-cn';
  })());

  // ---------- 5. 进度、边界与切卡复位 ----------
  const s5 = createSession(raw, { ...DEFAULT_SETTINGS });
  check('空序列进度为 0', positionOf(createSession([], DEFAULT_SETTINGS)) === 0);
  check('第一张进度从 1 开始', positionOf(s5) === 1 && isFirstCard(s5) && !isLastCard(s5));
  check('第一张「上一张」原地不动', goPrev(s5) === false && s5.index === 0);
  s5.index = s5.cards.length - 1;
  check('最后一张「下一张」不再前进', goNext(s5) === false && s5.index === s5.cards.length - 1 && isLastCard(s5));
  check('空序列翻答案返回 false', revealCard(createSession([], DEFAULT_SETTINGS)) === false);
  s5.index = 0;
  check('翻到第二张会复位答案状态', (() => {
    revealCard(s5);
    goNext(s5);
    return s5.revealed === false && canMark(s5) === false;
  })());
  check('越界切卡不会复位已作答的状态', (() => {
    const st = createSession(deck(2, 'A'), DEFAULT_SETTINGS);
    revealCard(st);
    setMark(st, 'known');
    goPrev(st);              // 第一张时点上一张：应停在原地、状态不变
    return st.index === 0 && st.revealed === true && markOf(st) === 'known';
  })());

  // ---------- 6. 浏览/认识/不认识统计 ----------
  const s6 = createSession(deck(6, 'B'), DEFAULT_SETTINGS);
  check('未翻答案前不能作答', canMark(s6) === false && setMark(s6, 'known') === false);
  check('未作答时认识率是空值而不是 0%', (() => {
    const st = statsOf(s6);
    return st.knownRate === null && st.viewed === 0 && st.answered === 0 && st.total === 6;
  })());
  revealCard(s6);
  check('翻开答案计入浏览', statsOf(s6).viewed === 1 && canMark(s6) === true);
  revealCard(s6);
  revealCard(s6);
  check('同一张反复翻只算一次浏览', statsOf(s6).viewed === 1);
  setMark(s6, 'known');
  setMark(s6, 'unknown');
  check('改标覆盖旧值，不重复计数', (() => {
    const st = statsOf(s6);
    return st.known === 0 && st.unknown === 1 && st.answered === 1;
  })());
  check('改标后当前标记读到最新值', markOf(s6) === 'unknown');
  goNext(s6);
  revealCard(s6);
  setMark(s6, 'known');
  const st6 = statsOf(s6);
  check('浏览 2 / 认识 1 / 不认识 1 / 认识率 50%',
    st6.viewed === 2 && st6.known === 1 && st6.unknown === 1 && st6.knownRate === 50, json(st6));
  goNext(s6);
  revealCard(s6);
  setMark(s6, 'known');
  const st6b = statsOf(s6);
  check('认识率四舍五入到整数百分比', st6b.answered === 3 && st6b.known === 2 && st6b.knownRate === 67, json(st6b));
  check('缺 id 的裸对象归同一键，不会抛错', cardKey({ ...mk(1, 'X')[0] }) === 0 && cardKey(mk(1, 'X')[0]) === 0);

  // ---------- 7. 只看不认识 / 重新开始 / 重新打乱 ----------
  const s7 = createSession(deck(8, 'C'), DEFAULT_SETTINGS);
  for (let i = 0; i < 8; i++) {
    revealCard(s7);
    setMark(s7, i % 2 === 0 ? 'unknown' : 'known');
    goNext(s7);
  }
  check('八张全部作答：浏览=认识=不认识=4', (() => {
    const st = statsOf(s7);
    return st.viewed === 8 && st.known === 4 && st.unknown === 4 && st.knownRate === 50;
  })());
  check('不认识名单沿用本轮序列顺序',
    json(unknownCards(s7).map(w => w.id)) === json(s7.cards.filter(w => w.id % 2 === 1).map(w => w.id)),
    json(unknownCards(s7).map(w => w.id)));
  keepUnknownOnly(s7);
  check('只刷不认识重建列表为 4 张并清空统计', (() => {
    const st = statsOf(s7);
    return st.total === 4 && st.viewed === 0 && st.answered === 0 && st.knownRate === null && positionOf(s7) === 1;
  })());
  revealCard(s7);
  setMark(s7, 'unknown');
  restartSession(s7);
  check('重新开始回到第一张且计数清零、顺序不变',
    s7.index === 0 && s7.revealed === false && statsOf(s7).total === 4 &&
    statsOf(s7).viewed === 0 && statsOf(s7).answered === 0);
  const beforeOrder = json(s7.cards.map(w => w.id));
  revealCard(s7);
  setMark(s7, 'known');
  const shuffled = createSession(deck(40, 'D'), { ...DEFAULT_SETTINGS, order: 'random' });
  const shuffleFrom = json(shuffled.cards.map(w => w.id));
  reshuffleSession(shuffled);
  check('重新打乱保持同一批词', json([...shuffled.cards.map(w => w.id)].sort((a, b) => a - b)) === json(Array.from({ length: 40 }, (_, i) => i + 1)));
  check('重新打乱清空本轮计数', statsOf(shuffled).viewed === 0 && statsOf(shuffled).answered === 0 && shuffled.index === 0);
  check('重新打乱确实换了顺序', json(shuffled.cards.map(w => w.id)) !== shuffleFrom);
  check('原始顺序在本轮内稳定', beforeOrder === json(s7.cards.map(w => w.id)));
  const allKnown = createSession(deck(2, 'E'), DEFAULT_SETTINGS);
  for (let i = 0; i < 2; i++) {
    revealCard(allKnown);
    setMark(allKnown, 'known');
    goNext(allKnown);
  }
  check('全部答认识时不认识名单为空（页面据此禁用「只刷不认识」）',
    unknownCards(allKnown).length === 0 && statsOf(allKnown).unknown === 0 && statsOf(allKnown).knownRate === 100);

  // ---------- 8. 数据隔离：跑完整一轮，五表逐字节不变 ----------
  await race(vocab.importWords(mk(4, '隔离')), 'seed 1');
  const seeded = await race(vocab.getAllWords(), 'seeded');
  const ids = seeded.map(w => w.id);
  await race(review.initNewWordReview(ids[0]), 'init 0');
  await race(review.gradeReview(ids[0], 1), 'grade 0');       // 10 分钟后到期
  await race(review.initNewWordReview(ids[1]), 'init 1');
  await race(review.gradeReview(ids[1], 1), 'grade 1');       // 错题 + 顽固词
  await race(review.initNewWordReview(ids[2]), 'init 2');
  await race(review.gradeReview(ids[2], 3), 'grade 2');
  await race(review.initNewWordReview(ids[3]), 'init 3');
  await race(review.gradeReview(ids[3], 6), 'grade 3');       // 已牢记（毕业哨兵）
  await race(errors.addErrorRecord(ids[2], 'spelling', 'q', 'a', 'b'), 'error 2');

  const snapshot = async () => json({
    words: await db.words.toArray(),
    reviewStates: await db.reviewStates.toArray(),
    errorRecords: await db.errorRecords.toArray(),
    stubbornWords: await db.stubbornWords.toArray(),
    dailyStats: await db.dailyStats.toArray(),
    // 纯逻辑层连速刷状态表都不该碰——写库只发生在页面的作答回调里。
    speedStatuses: await db.speedStatuses.toArray(),
  });

  const before = await snapshot();
  const b = JSON.parse(before);
  const beforeDue = await race(review.getDueCount(), 'due before');
  const beforeNew = await race(review.getNewWordCount(), 'new before');
  const beforeGraduated = await race(review.getGraduatedCount(), 'graduated before');
  const project = rows => json(rows.map(x => [x.wordId, x.nextReview, x.state, x.reps, x.lapses, x.difficulty, x.stability]));

  // 与页面完全一致的调用序列：取词 → 建会话 → 逐张翻答案/作答/切卡 → 统计 → 只刷不认识 → 再一轮
  const library = await race(vocab.getAllWords(), 'brush read');
  check('速刷读到全部有效单词', library.length === 4 && ids.length === 4, `实际 ${library.length}`);
  const session = createSession(library, { ...DEFAULT_SETTINGS, order: 'random', autoAdvance: true });
  check('随机序列覆盖整库，一轮 4 张', session.cards.length === 4, `实际 ${session.cards.length}`);
  for (let i = 0; i < session.cards.length; i++) {
    revealCard(session);
    setMark(session, i % 3 === 0 ? 'unknown' : 'known');
    goNext(session);
  }
  const brushStats = statsOf(session);
  check('本轮浏览 4 / 认识 2 / 不认识 2',
    brushStats.viewed === 4 && brushStats.known === 2 && brushStats.unknown === 2, json(brushStats));
  const unknownIds = unknownCards(session).map(w => w.id);
  keepUnknownOnly(session);
  check('「只刷不认识」按本次标记重建名单并清空计数',
    unknownIds.length === 2 && json(session.cards.map(w => w.id)) === json(unknownIds) &&
    statsOf(session).viewed === 0 && statsOf(session).answered === 0, `名单 ${json(unknownIds)}`);
  for (let i = 0; i < session.cards.length; i++) {
    revealCard(session);
    setMark(session, 'unknown');
    goNext(session);
  }
  restartSession(session);
  reshuffleSession(session);
  goPrev(session);
  goNext(session);

  const after = await snapshot();
  const a = JSON.parse(after);
  check('速刷全程不改任何复习数据（六表逐字节一致）', before === after,
    before === after ? '' : `before=${before}\nafter =${after}`);
  check('Dexie 声明版本升到 4（v4 只加速刷状态表）', db.verno === 4, `实际 ${db.verno}`);
  check('排期行的 nextReview/state/reps/lapses/难度/稳定度原样',
    project(b.reviewStates) === project(a.reviewStates) && a.reviewStates.length === 4,
    `实际 ${a.reviewStates.length} 行`);
  check('没有为速刷新增排期行', a.reviewStates.length === b.reviewStates.length);
  check('待复习数量不变', (await race(review.getDueCount(), 'due after')) === beforeDue,
    `${beforeDue} → ${await race(review.getDueCount(), 'due after2')}`);
  check('新词数量不变', (await race(review.getNewWordCount(), 'new after')) === beforeNew);
  check('已牢记数量不变', (await race(review.getGraduatedCount(), 'graduated after')) === beforeGraduated);
  check('词库条数与 updatedAt 未被改动（掌握状态没有被动过）',
    a.words.length === b.words.length &&
    json(a.words.map(w => [w.id, w.updatedAt, w.thai, w.meaning, w.tags])) ===
    json(b.words.map(w => [w.id, w.updatedAt, w.thai, w.meaning, w.tags])));
  check('每日统计的 newWords/reviewsDone/streakDays 原样',
    json(a.dailyStats.map(d => [d.date, d.newWords, d.reviewsDone, d.streakDays])) ===
    json(b.dailyStats.map(d => [d.date, d.newWords, d.reviewsDone, d.streakDays])));
  check('错题与顽固词条数不变',
    a.errorRecords.length === b.errorRecords.length && a.stubbornWords.length === b.stubbornWords.length);

  // 读取路径本身也不能有副作用：今天的统计行缺失时，读词库不该把它建出来。
  await race(db.dailyStats.clear(), 'clear stats');
  await race(vocab.getAllWords(), 'read without stats');
  check('getAllWords 不会顺手创建今日统计行（速刷因此不产生统计副作用）',
    (await db.dailyStats.count()) === 0, `实际 ${await db.dailyStats.count()} 行`);

  // ---------- 9. 练习范围：纯逻辑，与标签/方向/顺序正交 ----------
  const savedMarks = new Map([[2, 'unknown'], [4, 'known']]);
  check('范围「全部」原样返回词表（且是副本）', (() => {
    const all = filterByScope(words, 'all', savedMarks);
    return json(all.map(w => w.id)) === json([1, 2, 3, 4, 5]) && all !== words;
  })());
  check('「不认识」只取最新判定为不认识的词',
    json(filterByScope(words, 'unknown', savedMarks).map(w => w.id)) === json([2]));
  check('「未练习」= 状态表里完全没有的词',
    json(filterByScope(words, 'unpracticed', savedMarks).map(w => w.id)) === json([1, 3, 5]));
  check('判过认识的词既不进「不认识」也不进「未练习」',
    filterByScope(words, 'unknown', savedMarks).every(w => w.id !== 4) &&
    filterByScope(words, 'unpracticed', savedMarks).every(w => w.id !== 4));
  check('空状态表时「不认识」为空、「未练习」为全量', (() => {
    const empty = new Map();
    return filterByScope(words, 'unknown', empty).length === 0 &&
      json(filterByScope(words, 'unpracticed', empty).map(w => w.id)) === json([1, 2, 3, 4, 5]);
  })());
  check('范围顺序稳定为 全部/不认识/未练习',
    json(SCOPE_OPTIONS.map(o => o.scope)) === json(['all', 'unknown', 'unpracticed']));
  check('范围计数 5 / 1 / 3', json(buildScopeOptions(words, savedMarks).map(o => o.count)) === json([5, 1, 3]),
    json(buildScopeOptions(words, savedMarks)));
  check('认识 + 不认识 + 未练习 = 全部', (() => {
    const [all, unknown, unpracticed] = buildScopeOptions(words, savedMarks).map(o => o.count);
    return unpracticed + unknown + (all - unpracticed - unknown) === all && all - unpracticed - unknown === 1;
  })());
  check('范围与标签组合：问候 ∩ 未练习 = [1]',
    json(filterByScope(filterByCategory(words, '问候'), 'unpracticed', savedMarks).map(w => w.id)) === json([1]));
  check('范围与标签组合：餐饮 ∩ 不认识 = 空（页面据此给出空状态）',
    filterByScope(filterByCategory(words, '餐饮'), 'unknown', savedMarks).length === 0);
  check('两个维度的筛选顺序交换结果一致',
    json(filterByCategory(filterByScope(words, 'unpracticed', savedMarks), '餐饮').map(w => w.id)) ===
    json(filterByScope(filterByCategory(words, '餐饮'), 'unpracticed', savedMarks).map(w => w.id)));
  check('范围计数按选中标签重算（餐饮：2 / 0 / 1）',
    json(buildScopeOptions(filterByCategory(words, '餐饮'), savedMarks).map(o => o.count)) === json([2, 0, 1]));
  check('筛过的词表仍走同一套方向与随机逻辑', (() => {
    const pool = filterByScope(words, 'unpracticed', savedMarks);
    const s = createSession(pool, { ...DEFAULT_SETTINGS, scope: 'unpracticed', order: 'random' });
    return s.cards.length === 3 && new Set(s.cards.map(w => w.id)).size === 3 &&
      frontText(s.cards.find(w => w.id === 3), 'cn-to-thai') === '水';
  })());

  // ---------- 10. 长期状态：落库、覆盖、跨刷新保留，且与 FSRS 互不干涉 ----------
  const { loadSpeedStatuses, saveSpeedStatus } = speedStatus;
  check('speedStatuses 主键就是 wordId（同词天然唯一行）',
    keyOf(db.speedStatuses) === 'wordId', `实际 ${keyOf(db.speedStatuses)}`);
  check('speedStatuses 只给 status 建索引',
    json(indexesOf(db.speedStatuses)) === json(['status']), `实际 ${json(indexesOf(db.speedStatuses))}`);
  for (const [name, spec] of Object.entries(PRE_V4_STORES)) {
    const parts = spec.split(',').map(s => s.trim());
    check(`v4 未改动 ${name} 的主键`, keyOf(db[name]) === parts[0], `实际 ${keyOf(db[name])}`);
    check(`v4 未改动 ${name} 的索引`,
      json(indexesOf(db[name])) === json(parts.slice(1).map(i => i.replace('*', '')).sort()),
      `实际 ${json(indexesOf(db[name]))}`);
  }

  const idA = ids[0];
  const idB = ids[1];
  await race(saveSpeedStatus(idA, 'unknown'), 'save A unknown');
  await race(saveSpeedStatus(idA, 'known'), 'save A known');
  await race(saveSpeedStatus(idB, 'unknown'), 'save B unknown');
  let statusRows = await race(db.speedStatuses.toArray(), 'status rows');
  check('改判以最新一次为准，且一个词只有一行',
    statusRows.length === 2 && new Set(statusRows.map(r => r.wordId)).size === 2 &&
    statusRows.find(r => r.wordId === idA).status === 'known', json(statusRows));
  check('记录带 wordId / status / updatedAt 三个字段',
    statusRows.every(r => typeof r.wordId === 'number' && ['known', 'unknown'].includes(r.status) &&
      typeof r.updatedAt === 'number' && r.updatedAt > 0));
  const markTime = statusRows.find(r => r.wordId === idA).updatedAt;
  await new Promise(done => setTimeout(done, 5));
  await race(saveSpeedStatus(idA, 'unknown'), 'save A unknown again');
  statusRows = await race(db.speedStatuses.toArray(), 'status rows 2');
  check('反复练习同一个词不会多出行，updatedAt 只前进',
    statusRows.length === 2 && statusRows.find(r => r.wordId === idA).updatedAt >= markTime &&
    statusRows.find(r => r.wordId === idA).status === 'unknown', json(statusRows));

  // 重新读一次就是「关掉浏览器再打开」的等价路径：状态来自库里，不来自模块变量。
  const reloaded = await race(loadSpeedStatuses(), 'reload statuses');
  check('重新加载后状态仍在（退出页面/刷新/重开浏览器都不丢）',
    reloaded.size === 2 && reloaded.get(idA) === 'unknown' && reloaded.get(idB) === 'unknown',
    json([...reloaded.entries()]));

  const fsrsOf = async () => json({
    words: await db.words.toArray(),
    reviewStates: await db.reviewStates.toArray(),
    errorRecords: await db.errorRecords.toArray(),
    stubbornWords: await db.stubbornWords.toArray(),
    dailyStats: await db.dailyStats.toArray(),
  });
  const fsrsBefore = await fsrsOf();
  const statesBefore = await race(db.reviewStates.count(), 'states before');
  const dueA = await race(db.reviewStates.get(idA), 'due A before');

  // 与页面作答回调完全一致的路径：读状态 → 按范围建会话 → 逐张判定并当场落库。
  let live = await race(loadSpeedStatuses(), 'live map');
  const pool = filterByScope(await race(vocab.getAllWords(), 'pool words'), 'all', live);
  const round = createSession(pool, { ...DEFAULT_SETTINGS });
  for (const card of round.cards) {
    revealCard(round);
    setMark(round, 'known');
    const key = cardKey(card);
    await race(saveSpeedStatus(key, 'known'), `save ${key}`);
    live.set(key, 'known');
    goNext(round);
  }
  const fsrsAfter = await fsrsOf();
  check('写速刷状态不动任何复习数据（词库/排期/错题/顽固/每日统计逐字节一致）',
    fsrsBefore === fsrsAfter, fsrsBefore === fsrsAfter ? '' : `before=${fsrsBefore}\nafter =${fsrsAfter}`);
  check('标记「认识」不会新增或删除排期行', (await db.reviewStates.count()) === statesBefore);
  check('「认识」不映射成 FSRS 的已记住：nextReview/state/reps/lapses 一字不变',
    project([await db.reviewStates.get(idA)]) === project([dueA]),
    `实际 ${json(await db.reviewStates.get(idA))}`);
  check('词库行的 updatedAt 没被速刷动过（不会污染编辑时间）',
    json((await db.words.toArray()).map(w => [w.id, w.updatedAt])) ===
    json(JSON.parse(fsrsBefore).words.map(w => [w.id, w.updatedAt])));
  const afterRound = await race(loadSpeedStatuses(), 'after round map');
  check('全部改判后「不认识」范围为空、「未练习」只剩没进过本轮的词',
    json(filterByScope(pool, 'unknown', afterRound).map(w => w.id)) === json([]) &&
    json(filterByScope(pool, 'unpracticed', afterRound).map(w => w.id)) === json([]));

  const rowsBeforeDelete = await race(db.speedStatuses.count(), 'rows before del');
  await race(vocab.deleteWords([idB]), 'delete B');
  check('本轮四个词都留下了状态行', rowsBeforeDelete === 4, `实际 ${rowsBeforeDelete}`);
  check('删词级联清掉该词的速刷状态（不留孤儿行）',
    (await db.speedStatuses.get(idB)) === undefined, json(await db.speedStatuses.get(idB)));
  check('删词不动其他词的速刷状态', (await db.speedStatuses.get(idA))?.status === 'known',
    json(await db.speedStatuses.get(idA)));
  check('删词只带走自己那一行', (await db.speedStatuses.count()) === rowsBeforeDelete - 1);
  await race(saveSpeedStatus(idA, 'unknown'), 're-save A');
  check('改判已存词仍然只覆盖同一行',
    (await db.speedStatuses.count()) === rowsBeforeDelete - 1 &&
    (await db.speedStatuses.get(idA))?.status === 'unknown');

  // ---------- 11. v3 老库升 v4：只多出一张空表，历史数据一字不动 ----------
  {
    const legacy = await buildLegacyDb(V3_LEGACY_DB, 3, PRE_V4_STORES);
    const legacyWords = [{ id: 7, thai: 'สวัสดี', meaning: '你好', toneMark: 'mid', pos: '感叹词', example: '', note: '', tags: ['问候'], createdAt: 1000, updatedAt: 2000 }];
    const legacyStates = [{ wordId: 7, difficulty: 5, stability: 3.5, reps: 4, lapses: 1, lastReview: 3000, nextReview: 90000, state: 2 }];
    const legacyErrors = [{ id: 1, wordId: 7, errorType: 'spelling', question: 'q', userAnswer: 'a', correctAnswer: 'b', timestamp: 4000, date: '2026-11-23' }];
    await putRawRows(legacy, 'words', legacyWords);
    await putRawRows(legacy, 'reviewStates', legacyStates);
    await putRawRows(legacy, 'errorRecords', legacyErrors);
    await putRawRows(legacy, 'settings', [{ key: 'grammarSeeded', value: '1700000000000' }]);
    legacy.close();

    const upgraded = new ThaiLearnDB(V3_LEGACY_DB);
    check('老库打开后升到 4', upgraded.verno === 4, `实际 ${upgraded.verno}`);
    check('升级新增的速刷状态表是空的', (await upgraded.speedStatuses.count()) === 0);
    check('升级不改动单词记录', json(await upgraded.words.toArray()) === json(legacyWords),
      `实际 ${json(await upgraded.words.toArray())}`);
    check('升级不改动 FSRS 排期（难度/稳定度/复习日期全原样）',
      json(await upgraded.reviewStates.toArray()) === json(legacyStates),
      `实际 ${json(await upgraded.reviewStates.toArray())}`);
    check('升级不改动错题', json(await upgraded.errorRecords.toArray()) === json(legacyErrors));
    check('升级不改动 settings', (await upgraded.settings.get('grammarSeeded'))?.value === '1700000000000');
    await upgraded.delete();
  }

  // ---------- 12. 速刷状态进 JSON 备份：导出内容、旧备份兼容、wordId 校验、恢复不碰排期 ----------
  const { sanitizeSpeedStatusesForRestore } = speedStatus;
  const backupIds = (await race(db.words.toArray(), 'backup word ids')).map(w => w.id);
  const idSet = new Set(backupIds);
  const statusBackup = await race(db.speedStatuses.toArray(), 'status backup rows');
  check('导出的速刷状态可直接 JSON 序列化（不含 Blob）',
    json(JSON.parse(json(statusBackup))) === json(statusBackup), `实际 ${json(statusBackup)}`);
  check('导出字段齐全：wordId / status / updatedAt',
    statusBackup.every(r => typeof r.wordId === 'number' && ['known', 'unknown'].includes(r.status) &&
      typeof r.updatedAt === 'number'), `实际 ${json(statusBackup)}`);
  check('整份导出原样喂回去，内容一字不变（新备份往返）',
    json(sanitizeSpeedStatusesForRestore(statusBackup, idSet)) === json(statusBackup),
    `实际 ${json(sanitizeSpeedStatusesForRestore(statusBackup, idSet))}`);

  // 旧备份（v4 之前导出的 JSON）根本没有 speedStatuses 字段：按空数组处理，一个字节都不动。
  const legacyPayloads = [undefined, null, 'oops', 42, {}];
  check('老备份缺字段/字段类型不对一律当没有',
    legacyPayloads.every(payload => sanitizeSpeedStatusesForRestore(payload, idSet).length === 0),
    json(legacyPayloads.map(payload => sanitizeSpeedStatusesForRestore(payload, idSet).length)));
  const fsrsBeforeRestore = await fsrsOf();
  const statusesBeforeRestore = json(statusBackup);
  const statesBeforeRestore = await race(db.reviewStates.count(), 'states before restore');
  await race(db.speedStatuses.bulkPut(sanitizeSpeedStatusesForRestore(undefined, idSet)), 'restore legacy');
  check('恢复老备份不改动速刷状态表', json(await db.speedStatuses.toArray()) === statusesBeforeRestore,
    `实际 ${json(await db.speedStatuses.toArray())}`);
  check('恢复老备份更不动复习数据', fsrsBeforeRestore === await fsrsOf());

  const ghostId = Math.max(...backupIds) + 500;
  const dirty = sanitizeSpeedStatusesForRestore([
    { wordId: backupIds[0], status: 'unknown', updatedAt: 1234 },
    { wordId: ghostId, status: 'known', updatedAt: 1234 },                     // 词已不在本次恢复的词库里
    { wordId: backupIds[0], status: 'graduated', updatedAt: 1234 },            // 不是速刷能写得出的状态
    { wordId: backupIds[0], status: 2, updatedAt: 1234 },
    { wordId: 'x', status: 'known', updatedAt: 1234 },
    { status: 'known', updatedAt: 1234 },
    null,
    'nope',
    { wordId: backupIds[1], status: 'known' },                                  // 缺 updatedAt
    { wordId: backupIds[1], status: 'known', updatedAt: '昨天' },               // updatedAt 脏
  ], idSet);
  check('坏状态/坏 id/坏行一律跳过，好行保留',
    json(dirty.map(r => r.wordId).sort()) === json([backupIds[0], backupIds[1]].sort()), json(dirty));
  check('指向已删词的状态不恢复（不留孤儿行）',
    dirty.every(r => idSet.has(r.wordId)) && !dirty.some(r => r.wordId === ghostId), json(dirty));
  check('只认 known/unknown 两个字面量，FSRS 的 graduated 之类进不来',
    dirty.every(r => ['known', 'unknown'].includes(r.status)), json(dirty.map(r => r.status)));
  check('updatedAt 缺失或脏掉记成恢复时刻，仍是个正数',
    dirty.every(r => typeof r.updatedAt === 'number' && r.updatedAt > 0), json(dirty.map(r => r.updatedAt)));
  check('updatedAt 合法时按备份原值恢复', dirty.find(r => r.wordId === backupIds[0]).updatedAt === 1234,
    json(dirty.find(r => r.wordId === backupIds[0])));
  check('备份里同一个词出现多次只留最后一次判定',
    json(sanitizeSpeedStatusesForRestore([
      { wordId: backupIds[0], status: 'unknown', updatedAt: 1 },
      { wordId: backupIds[0], status: 'known', updatedAt: 2 },
    ], idSet)) === json([{ wordId: backupIds[0], status: 'known', updatedAt: 2 }]),
    `实际 ${json(sanitizeSpeedStatusesForRestore([
      { wordId: backupIds[0], status: 'unknown', updatedAt: 1 },
      { wordId: backupIds[0], status: 'known', updatedAt: 2 },
    ], idSet))}`);

  // 恢复走 bulkPut 而不是 clear：备份里没有的词保留自己的判定，同一个词只留一行。
  await race(db.speedStatuses.bulkPut(dirty), 'restore dirty');
  const afterRestore = await race(db.speedStatuses.toArray(), 'status rows after restore');
  check('恢复按 wordId 覆盖，一个词仍只有一行',
    new Set(afterRestore.map(r => r.wordId)).size === afterRestore.length, json(afterRestore));
  check('恢复把备份里的判定落到对应词上',
    afterRestore.find(r => r.wordId === backupIds[0])?.status === 'unknown' &&
    afterRestore.find(r => r.wordId === backupIds[1])?.status === 'known', json(afterRestore));
  check('备份里没有的词保留本地判定（恢复不整表清空）',
    afterRestore.filter(r => !dirty.some(d => d.wordId === r.wordId)).length ===
      statusBackup.filter(r => !dirty.some(d => d.wordId === r.wordId)).length,
    `实际 ${json(afterRestore.map(r => r.wordId))} / ${json(statusBackup.map(r => r.wordId))}`);
  check('恢复速刷状态只写自己那张表（复习数据逐字节一致）',
    fsrsBeforeRestore === await fsrsOf(), `after=${await fsrsOf()}`);
  check('恢复不会给没判过的词凭空造排期行', (await db.reviewStates.count()) === statesBeforeRestore,
    `${statesBeforeRestore} → ${await db.reviewStates.count()}`);

  // 备份页面本身要进浏览器才能跑，这里只做源码级核对：字段有没有真的进导出、恢复有没有走校验。
  const moreSrc = readSrc('src/pages/more.ts');
  check('导出全部数据带上速刷状态表',
    /speedStatuses: await db\.speedStatuses\.toArray\(\)/.test(moreSrc));
  check('恢复速刷状态前先按备份词 id 校验',
    /sanitizeSpeedStatusesForRestore\(data\.speedStatuses, validWordIds\)/.test(moreSrc) &&
    /db\.speedStatuses\.bulkPut\(statuses\)/.test(moreSrc));
  check('恢复速刷状态只覆盖，不整表清空', !/speedStatuses\.clear\(\)/.test(moreSrc));

  // ---------- 13. 进度保存与恢复：位置能接上，筛选一变就不硬接 ----------
  const deckP = deck(10, 'P');
  const ids10 = deckP.map(w => w.id);
  const recOf = (ids, index, s = DEFAULT_SETTINGS) => ({ ids, index, settings: s, updatedAt: 1700000000000 });

  // 13.1 序列一致性：只有决定那串词单的三项才算数。
  check('同一套筛选算同一条序列', isSameSequence(DEFAULT_SETTINGS, DEFAULT_SETTINGS) === true);
  for (const key of ['category', 'scope', 'order']) {
    check(`${key} 一变就不是同一条序列`,
      isSameSequence(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, [key]: key === 'category' ? '问候' : key === 'scope' ? 'unknown' : 'random' }) === false);
  }
  for (const key of ['direction', 'autoAdvance']) {
    check(`${key} 只改卡面与节奏，仍然可以接着刷`,
      isSameSequence(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, [key]: key === 'direction' ? 'cn-to-thai' : false }) === true);
  }

  // 13.2 恢复：原样一串、停在原处、本轮统计从零。
  {
    const r = restoreSession(deckP, recOf(ids10, 4), DEFAULT_SETTINGS);
    check('整串原样恢复，张数不变', r && json(r.cards.map(w => w.id)) === json(ids10), r && json(r.cards.map(w => w.id)));
    check('停在记录的那一张：第 5 / 10', r && r.index === 4 && positionOf(r) === 5 && currentCard(r).id === 5,
      r && json({ index: r.index, pos: positionOf(r), id: currentCard(r)?.id }));
    check('恢复出来的会话本轮统计从零：浏览/作答/标记都是空',
      r && statsOf(r).viewed === 0 && statsOf(r).answered === 0 && r.revealed === false && r.viewed.size === 0 && r.marks.size === 0,
      r && json(statsOf(r)));
    check('恢复把卡面复位：翻面与喇叭门槛回到「未露答案」', r && canMark(r) === false && r.revealed === false);
    check('恢复带的设置是浅拷贝，不共享引用', (() => {
      const s = { ...DEFAULT_SETTINGS };
      const back = restoreSession(deckP, recOf(ids10, 0), s);
      return back !== null && back.settings !== s && json(back.settings) === json(s);
    })());
    check('会话能一路走到结尾（恢复出来的序列边界正常）', (() => {
      const s = restoreSession(deckP, recOf(ids10, 8), DEFAULT_SETTINGS);
      if (!s) return false;
      goNext(s);
      return isLastCard(s) && positionOf(s) === 10 && goNext(s) === false;
    })());
    check('恢复后往前翻仍按原序列', (() => {
      const s = restoreSession(deckP, recOf(ids10, 2), DEFAULT_SETTINGS);
      return goPrev(s) === true && currentCard(s).id === 2;
    })());
  }

  // 13.3 词库中途删词：跳过没的，位置落到最近还在的那一张，绝不跟着空转。
  {
    const gone = deckP.filter(w => w.id !== 5);
    const r = restoreSession(gone, recOf(ids10, 4), DEFAULT_SETTINGS);
    check('上次那张已删：往后找第一张还在的，不前移',
      r && r.cards.length === 9 && r.index === 4 && currentCard(r).id === 6,
      r && json({ len: r.cards.length, index: r.index, id: currentCard(r)?.id }));
    check('删词后串尾越界：停在最后一张', (() => {
      const last = restoreSession(deckP.filter(w => w.id !== 10), recOf(ids10, 9), DEFAULT_SETTINGS);
      return last !== null && last.index === 8 && isLastCard(last) && currentCard(last).id === 9;
    })());
    check('记录的 index 越界也不会崩：夹到合法范围', (() => {
      const far = restoreSession(deckP, recOf(ids10, 999), DEFAULT_SETTINGS);
      const neg = restoreSession(deckP, recOf(ids10, -5), DEFAULT_SETTINGS);
      return far !== null && currentCard(far).id === 10 && neg !== null && neg.index === 0;
    })());
    check('整串词都被删光：返回 null，让页面从头开始',
      restoreSession([], recOf(ids10, 3), DEFAULT_SETTINGS) === null && restoreSession(deckP, recOf([991, 992], 0), DEFAULT_SETTINGS) === null);
    check('删词不会改变幸存词的顺序', (() => {
      const r = restoreSession(deckP.filter(w => ![3, 7].includes(w.id)), recOf(ids10, 0), DEFAULT_SETTINGS);
      return r !== null && json(r.cards.map(w => w.id)) === json([1, 2, 4, 5, 6, 8, 9, 10]);
    })());
  }

  // 13.4 不重摇、不重筛：随机顺序和范围计数都按当时那一串 replay。
  {
    // 手工固定一个「非入库顺序」，避免依赖 Math.random 的结果。
    const randSettings = { ...DEFAULT_SETTINGS, order: 'random' };
    const customOrder = [7, 3, 10, 1, 9, 2, 8, 4, 6, 5];
    const r = restoreSession(deckP, recOf(customOrder, 3, randSettings), randSettings);
    check('随机顺序原样接上：既不重摇也不按 id 排回',
      r !== null && json(r.cards.map(w => w.id)) === json(customOrder) && currentCard(r).id === 1,
      r && json(r.cards.map(w => w.id)));
    check('真正摇过的串也能原样接回来', (() => {
      const shuffled = createSession(deckP, randSettings);
      const back = restoreSession(deckP, recOf(shuffled.cards.map(w => w.id), 5, randSettings), randSettings);
      return back !== null && json(back.cards.map(w => w.id)) === json(shuffled.cards.map(w => w.id))
        && back.index === 5 && currentCard(back).id === shuffled.cards[5].id;
    })());
    check('恢复走的是「不认识」范围时也不重跑筛选：已改判认识的词不会从串里消失', (() => {
      const scopeSettings = { ...DEFAULT_SETTINGS, scope: 'unknown' };
      // 记下的三张里，第 2 张此刻已经判成认识；重跑筛选会让它掉出队列、位置整体前移。
      const r2 = restoreSession(deckP, recOf([1, 2, 3], 1, scopeSettings), scopeSettings);
      return r2 !== null && json(r2.cards.map(w => w.id)) === json([1, 2, 3]) && currentCard(r2).id === 2;
    })());
    check('筛选条件不一致就不硬接：分类/范围/顺序各一例', [
      restoreSession(deckP, recOf(ids10, 4), { ...DEFAULT_SETTINGS, category: 'P' }),
      restoreSession(deckP, recOf(ids10, 4), { ...DEFAULT_SETTINGS, scope: 'unknown' }),
      restoreSession(deckP, recOf(ids10, 4), { ...DEFAULT_SETTINGS, order: 'random' }),
    ].every(r2 => r2 === null));
    check('接上位置、换成用户刚选的方向（方向不算筛选冲突）', (() => {
      const r2 = restoreSession(deckP, recOf(ids10, 4), { ...DEFAULT_SETTINGS, direction: 'cn-to-thai' });
      return r2 !== null && r2.index === 4 && r2.settings.direction === 'cn-to-thai';
    })());
  }

  // 13.5 存取层：只认 localStorage，坏数据一律当「没有进度」。
  const STORAGE_KEY = 'thailearn.speedbrush.progress';
  // 假存储只在测试进程内挂在这一份键名上；测完直接摘掉，Node 自带的 localStorage 本身也是空的。
  function installStorage({ throwOnAccess = false, throwOnWrite = false } = {}) {
    const map = new Map();
    const fake = {
      getItem: key => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => {
        if (throwOnWrite) throw new Error('QuotaExceeded');
        map.set(key, String(value));
      },
      removeItem: key => { map.delete(key); },
    };
    if (throwOnAccess) {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
    } else {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fake });
    }
    return map;
  }
  function uninstallStorage() {
    delete globalThis.localStorage;
  }
  try {
    let store = installStorage();
    check('没有记录时读到 null', loadSpeedProgress() === null);
    const record = recOf(ids10, 4);
    saveSpeedProgress(record);
    check('存进去再读出来一字不变', json(loadSpeedProgress()) === json(record), json(loadSpeedProgress()));
    check('进度只占约定的那一个键，不污染别的本地数据',
      json([...store.keys()]) === json([STORAGE_KEY]), json([...store.keys()]));
    check('记录里只有 id 和位置，不抄词库内容',
      json(Object.keys(loadSpeedProgress()).sort()) === json(['ids', 'index', 'settings', 'updatedAt']),
      json(Object.keys(loadSpeedProgress())));
    clearSpeedProgress();
    check('清空后读到 null（刷完整串就没有位置可续）', loadSpeedProgress() === null);

    const badPayloads = [
      '{', 'not json', '[]', 'null', '"text"', '42',
      json({ ids: [], index: 0, settings: DEFAULT_SETTINGS, updatedAt: 1 }),
      json({ index: 0, settings: DEFAULT_SETTINGS, updatedAt: 1 }),
      json({ ids: '123', index: 0, settings: DEFAULT_SETTINGS, updatedAt: 1 }),
      json({ ids: ids10, index: -1, settings: DEFAULT_SETTINGS, updatedAt: 1 }),
      json({ ids: ids10, index: 'abc', settings: DEFAULT_SETTINGS, updatedAt: 1 }),
      json({ ids: ids10, index: 0, updatedAt: 1 }),
      json({ ids: ids10, index: 0, settings: 'all', updatedAt: 1 }),
      json({ ids: ids10, index: 0, settings: { category: '' }, updatedAt: 1 }),
    ];
    check('坏 JSON/缺字段/类型不对一律读成 null',
      badPayloads.every(payload => {
        globalThis.localStorage.setItem(STORAGE_KEY, payload);
        return loadSpeedProgress() === null;
      }),
      json(badPayloads.filter(payload => {
        globalThis.localStorage.setItem(STORAGE_KEY, payload);
        return loadSpeedProgress() !== null;
      })));
    installStorage();
    saveSpeedProgress(recOf([1, 2], 1, DEFAULT_SETTINGS));
    check('脏 updatedAt 记成 0，不影响接续', (() => {
      const raw = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY));
      globalThis.localStorage.setItem(STORAGE_KEY, json({ ...raw, updatedAt: '昨天' }));
      return loadSpeedProgress()?.updatedAt === 0;
    })());
    check('写失败（配额或被禁用）只影响接续，不抛到刷词里', (() => {
      try {
        installStorage({ throwOnWrite: true });
        saveSpeedProgress(recOf(ids10, 2));
        clearSpeedProgress();
        loadSpeedProgress();
        return true;
      } catch {
        return false;
      }
    })());
    check('存储整体不可用（隐私模式）时读写都当没有', (() => {
      try {
        installStorage({ throwOnAccess: true });
        saveSpeedProgress(recOf(ids10, 2));
        return loadSpeedProgress() === null && clearSpeedProgress() === undefined;
      } catch {
        return false;
      }
    })());
    uninstallStorage();
    check('浏览器没有 localStorage 时同样安全', (() => {
      try {
        return loadSpeedProgress() === null && (saveSpeedProgress(recOf(ids10, 0)), clearSpeedProgress(), true);
      } catch {
        return false;
      }
    })());

    // 13.6 端到端（不含 DOM）：刷到中途 → 落盘 → 重进 → 接上同一张。
    check('刷到中途退出再重进，接在最后一次看到的那一张', (() => {
      const store = installStorage();
      try {
        const first = createSession(deckP, DEFAULT_SETTINGS);
        for (let i = 0; i < 4; i++) {
          revealCard(first);
          setMark(first, 'known');
          goNext(first);
        }
        // 页面 paint 时记的就是这份。
        saveSpeedProgress({ ids: first.cards.map(w => cardKey(w)), index: first.index, settings: { ...first.settings }, updatedAt: Date.now() });
        const again = restoreSession(deckP, loadSpeedProgress(), DEFAULT_SETTINGS);
        const sameCard = again !== null && again.index === first.index && currentCard(again).thai === currentCard(first).thai;
        const freshRound = again !== null && statsOf(again).viewed === 0 && statsOf(again).answered === 0;
        // 从头开始：序列不变、位置归零，重新落盘后读到的是 index 0。
        restartSession(again);
        saveSpeedProgress({ ids: again.cards.map(w => cardKey(w)), index: again.index, settings: { ...again.settings }, updatedAt: Date.now() });
        const zeroed = restoreSession(deckP, loadSpeedProgress(), DEFAULT_SETTINGS);
        const resetOk = zeroed !== null && zeroed.index === 0 && json(zeroed.cards.map(w => w.id)) === json(ids10);
        return sameCard && freshRound && resetOk && store.size === 1 && store.has(STORAGE_KEY);
      } finally {
        uninstallStorage();
      }
    })());
  } finally {
    uninstallStorage();
  }

  // 13.7 页面接线：保存点、清理点、重置点与界面提示都在。
  {
    const cssSrc = readSrc('src/styles/components.css');
    check('每次翻到一张都记位置', /syncSpeak\(\);\s*\n\s*\/\/ 每翻到一张[\s\S]{0,80}?persistProgress\(s\);/.test(pageSrc));
    check('标记后也记（自动跳的由 paint 顺手记下，不重复写）',
      /if \(s\.settings\.autoAdvance\) advance\(\);\s*else \{[\s\S]{0,120}?persistProgress\(s\);[\s\S]{0,40}?bindSlot\(\);/.test(pageSrc));
    check('确认退出时先记位置再丢会话', /if \(ok\) \{[\s\S]{0,120}?persistProgress\(session\);[\s\S]{0,60}?session = null;/.test(pageSrc));
    check('顶栏返回同样先记位置', /if \(!confirm\(EXIT_TEXT\)\) return;\s*\n\s*persistProgress\(s\);\s*\n\s*renderSetup\(container\);/.test(pageSrc));
    check('手滑刷新前也记一次', /if \(session\) persistProgress\(session\);\s*\n\s*event\.preventDefault/.test(pageSrc));
    check('刷完整串就清掉位置', /dropProgress\(\);\s*\n\s*mountDone\(container, s\);/.test(pageSrc));
    check('清位置只有一个出口，避免各处自创清理',
      (pageSrc.match(/clearSpeedProgress\(\)/g) || []).length === 1);
    check('记位置只走 speedProgress，不碰状态表',
      (pageSrc.match(/saveSpeedProgress\(/g) || []).length === 1
      && (pageSrc.match(/await saveSpeedStatus\(/g) || []).length === 1);
    check('设置页有可续/不可续两套文案',
      /继续速刷（第 \$\{positionOf\(resumable\)\} \/ \$\{resumable\.cards\.length\} 张）/.test(pageSrc)
      && /开始速刷（\$\{count\} 张）/.test(pageSrc));
    check('设置页显示上次刷到第几张与当时的筛选',
      /上次刷到第 \$\{positionOf\(resumable\)\} \/ \$\{resumable\.cards\.length\} 张/.test(pageSrc)
      && /settingsSummary\(resumable\.settings\)/.test(pageSrc));
    check('筛选与进度不符时说明原因，不假装能续',
      /上次的位置属于另一套筛选条件/.test(pageSrc) && /resumableSession\(\) \?\? createSession\(poolWithinCategory\(\), settings\)/.test(pageSrc));
    check('从头开始这一串走 createSession，不动长期状态',
      /begin\(createSession\(poolWithinCategory\(\), settings\)\)/.test(pageSrc));
    check('刷词中也能随时归零', /restartSession\(s\);\s*\n\s*paint\(\);/.test(pageSrc));
    check('重新打乱把设置也改成随机，接续时选中的顺序对得上这一串',
      /reshuffleSession\(s\);\s*\n\s*s\.settings = \{ \.\.\.s\.settings, order: 'random' \};\s*\n\s*settings = \{ \.\.\.settings, order: 'random' \};/.test(pageSrc));
    check('归零按钮走确认，手滑不会丢进度', /confirm\('从头开始这一串/.test(pageSrc));
    check('退出文案说明位置会留着', /const EXIT_TEXT = '[^']*位置也留着/.test(pageSrc));
    check('恢复只吃 words/记录/设置，不读状态表也不读排期',
      /export function restoreSession\(words: Word\[\], record: SpeedProgressRecord, settings: SpeedSettings\): SpeedSession \| null \{[\s\S]*?\n\}/.test(libSrc)
      && !/statuses|speedStatuses|nextReview/.test((libSrc.match(/export function restoreSession\([\s\S]*?\n\}/) || [''])[0]));
    check('进度样式有专门的卡片与顶栏按钮，不靠临时内联',
      /\.speed-resume \{/.test(cssSrc) && /\.page-header \.speed-restart \{/.test(cssSrc));
    check('设置页收成「速刷规则」一个折叠框，进度段嵌在框内',
      /<details class="csv-spec">\s*<summary class="csv-spec-title">速刷规则<span class="csv-spec-sub" id="sb-rules-sub"><\/span><\/summary>\s*<div class="csv-spec-body">\s*<div id="sb-resume"><\/div>\s*<div class="speed-rules-text">/.test(pageSrc)
      && /\.speed-rules-text \{/.test(cssSrc));
    check('折叠框默认收起，进度写在标题行里不收起来就看不见',
      !/<details class="csv-spec" open>/.test(pageSrc)
      && /rulesSub\.textContent = `上次刷到第 \$\{positionOf\(resumable\)\} \/ \$\{resumable\.cards\.length\} 张`/.test(pageSrc));
    check('进度段不再自套一张卡，说明文案也不留第二张标题卡',
      !/class="card speed-resume/.test(pageSrc) && !/直接读现有词库/.test(pageSrc));
    const backupBlock = (moreSrc.match(/const data = \{[\s\S]*?\n    \};/) || [''])[0];
    const backupKeys = [...backupBlock.matchAll(/^\s{6}(\w+):/gm)].map(m => m[1]);
    check('进度不进 JSON 备份：恢复会重排词 id，位置只能留在本机',
      backupKeys.length === 14 && backupKeys.includes('speedStatuses')
      && !backupKeys.some(k => /progress/i.test(k)) && !/lib\/speedProgress/.test(moreSrc),
      json(backupKeys));
  }

  return { count: results.length, failed };
}

const summary = await main();
const pass = summary.count - summary.failed;
for (const r of results) if (!r.ok) console.log(`FAIL  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
console.log(`\n单词速刷回归：共 ${summary.count} 项，通过 ${pass} 项，失败 ${summary.failed} 项`);
if (summary.failed > 0) process.exit(1);
console.log('全部通过 ✓');
