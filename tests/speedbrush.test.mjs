// 单词速刷回归测试：分类/方向/顺序/翻卡/作答/统计/不认识名单的纯逻辑，
// 以及最重要的数据隔离——跑完整一轮速刷后，词库、排期、错题、顽固词、每日统计逐字节不变。
// 运行：node tests/speedbrush.test.mjs
// 隔离性：只在 node 进程内的 fake-indexeddb（内存实现）里建库，进程退出即消失，
// 不会接触浏览器里的 ThaiLearnDB、本地学习数据或线上数据。
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

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

// 默认口径冻结在测试里，改生产默认值必须同时改这里。
const WANT_DEFAULTS = { category: '', direction: 'thai-to-cn', order: 'original', autoAdvance: true };

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

  let db, sb, vocab, review, errors;
  try {
    ({ db } = await server.ssrLoadModule('/src/db/index.ts'));
    sb = await server.ssrLoadModule('/src/lib/speedbrush.ts');
    vocab = await server.ssrLoadModule('/src/db/vocabulary.ts');
    review = await server.ssrLoadModule('/src/db/review.ts');
    errors = await server.ssrLoadModule('/src/db/errors.ts');
  } finally {
    await server.close();
  }

  const {
    ALL_CATEGORIES, DEFAULT_SETTINGS, buildCategoryOptions, filterByCategory, createSession,
    currentCard, isFirstCard, isLastCard, positionOf, revealCard, goNext, goPrev, canMark,
    setMark, markOf, unknownCards, statsOf, frontText, answerText, restartSession,
    reshuffleSession, keepUnknownOnly, cardKey,
  } = sb;

  // ---------- 1. 依赖与源码守卫：速刷根本没有拿到写库的手 ----------
  const libSrc = readSrc('src/lib/speedbrush.ts');
  const pageSrc = readSrc('src/pages/speedbrush.ts');
  check('逻辑层只依赖 db 类型与 utils',
    json(importSpecs(libSrc)) === json(['../db/index', './utils']),
    `实际 ${json(importSpecs(libSrc))}`);
  check('逻辑层的词库引用是 import type（编译后即消失）',
    /import type \{ Word \} from '\.\.\/db\/index'/.test(libSrc));
  check('页面层依赖全在白名单内',
    json(importSpecs(pageSrc)) === json(['../lib/utils', '../db/vocabulary', '../lib/route-guard', '../lib/speedbrush']),
    `实际 ${json(importSpecs(pageSrc))}`);
  check('页面唯一的取数入口是 getAllWords',
    /import \{ getAllWords, type Word \} from '\.\.\/db\/vocabulary'/.test(pageSrc) &&
    (pageSrc.match(/getAllWords\(\)/g) || []).length === 1,
    `调用 ${(pageSrc.match(/getAllWords\(\)/g) || []).length} 次`);
  for (const token of FORBIDDEN) {
    const hit = [libSrc, pageSrc].filter(src => src.includes(token)).length;
    if (hit > 0) check(`源码不引用「${token}」`, false, `命中 ${hit} 个文件`);
  }
  check('速刷源码不引用任何排期/错题/统计写入口',
    ![libSrc, pageSrc].some(src => FORBIDDEN.some(token => src.includes(token))));

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
  check('速刷全程不改任何复习数据（五表逐字节一致）', before === after,
    before === after ? '' : `before=${before}\nafter =${after}`);
  check('Dexie 版本仍是 3（没有新增迁移）', db.verno === 3, `实际 ${db.verno}`);
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

  return { count: results.length, failed };
}

const summary = await main();
const pass = summary.count - summary.failed;
for (const r of results) if (!r.ok) console.log(`FAIL  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
console.log(`\n单词速刷回归：共 ${summary.count} 项，通过 ${pass} 项，失败 ${summary.failed} 项`);
if (summary.failed > 0) process.exit(1);
console.log('全部通过 ✓');
