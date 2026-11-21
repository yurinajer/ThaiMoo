// 复习排期回归测试：固定六档间隔、已牢记毕业与取消毕业、今日新词是入库口径（排期与评分都不动它）、以及「不改 schema、不丢 FSRS 历史列」。
// 运行：node tests/review-ladder.test.mjs
// 隔离性：只在 node 进程内的 fake-indexeddb（内存实现）里建库，进程退出即消失，
// 不会接触浏览器里的 ThaiLearnDB、本地学习数据或线上数据。
import 'fake-indexeddb/auto';
import { createServer } from 'vite';

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
const keyOf = (table) => `${table.schema.primKey.auto ? '++' : ''}${table.schema.primKey.keyPath}`;
const indexesOf = (table) => table.schema.indexes.map(i => i.name).sort();

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// 期望的六档，冻结在测试里，不跟随生产代码走。
const WANT = [
  { grade: 1, label: '忘记', interval: '10分钟', delayMs: 10 * MINUTE },
  { grade: 2, label: '困难', interval: '1天', delayMs: DAY },
  { grade: 3, label: '良好', interval: '3天', delayMs: 3 * DAY },
  { grade: 4, label: '优秀', interval: '7天', delayMs: 7 * DAY },
  { grade: 5, label: '已学会', interval: '14天', delayMs: 14 * DAY },
  { grade: 6, label: '已牢记', interval: '永不复习', delayMs: null },
];

async function main() {
  const server = await createServer({
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true, include: [] },
  });

  let db, review;
  try {
    ({ db } = await server.ssrLoadModule('/src/db/index.ts'));
    review = await server.ssrLoadModule('/src/db/review.ts');
  } finally {
    await server.close();
  }

  const {
    GRADE_TABLE, NEVER_REVIEW, gradeSpec, nextReviewTime, isGraduated,
    gradeReview, initNewWordReview, getReviewState, getDueReviewStates,
    getNewWordsWithoutReview, getGraduatedCount, getGraduatedReviewStates, ungraduateWord,
  } = review;

  // 今日新词是按天累加的计数，跨场景检查要看全表总量而不是某一行的值
  const newWordsTotal = async () =>
    (await db.dailyStats.toArray()).reduce((sum, s) => sum + (s.newWords || 0), 0);

  // ---------- 1. 没动数据库结构 ----------
  check('Dexie 版本仍是 3（换算法不升 schema）', db.verno === 3, `实际 ${db.verno}`);
  check('reviewStates 主键仍是 wordId', keyOf(db.reviewStates) === 'wordId', `实际 ${keyOf(db.reviewStates)}`);
  check('reviewStates 索引仍是 nextReview, state',
    json(indexesOf(db.reviewStates)) === json(['nextReview', 'state']),
    `实际 ${json(indexesOf(db.reviewStates))}`);

  // ---------- 2. 六档表就是需求写的那六档，按钮文案与排期同源 ----------
  check('评分档共 6 个', GRADE_TABLE.length === 6, `实际 ${GRADE_TABLE.length}`);
  check('六档的 grade/label/interval/delayMs 全部符合需求',
    json(GRADE_TABLE.map(s => ({ grade: s.grade, label: s.label, interval: s.interval, delayMs: s.delayMs }))) === json(WANT),
    `实际 ${json(GRADE_TABLE.map(s => [s.grade, s.label, s.interval, s.delayMs]))}`);
  for (const want of WANT) {
    check(`gradeSpec(${want.grade}) = ${want.label}`, gradeSpec(want.grade).label === want.label);
  }
  let threw = false;
  try { gradeSpec(7); } catch { threw = true; }
  check('未知档位报错而不是静默排期', threw === true);

  // ---------- 3. 间隔算术 ----------
  const base = 1_700_000_000_000;
  check('忘记 = 10 分钟', nextReviewTime(base, 1) === base + 10 * MINUTE);
  check('困难 = 1 天', nextReviewTime(base, 2) === base + DAY);
  check('良好 = 3 天', nextReviewTime(base, 3) === base + 3 * DAY);
  check('优秀 = 7 天', nextReviewTime(base, 4) === base + 7 * DAY);
  check('已学会 = 14 天', nextReviewTime(base, 5) === base + 14 * DAY);
  check('已牢记 = 远未来哨兵，不是 base+某个数', nextReviewTime(base, 6) === NEVER_REVIEW);
  check('固定档：同一按钮永远排同样长度（与记忆历史无关）',
    nextReviewTime(base, 3) - base === nextReviewTime(base + 999 * DAY, 3) - (base + 999 * DAY));
  check('哨兵能被 JSON 备份原样往返',
    JSON.parse(JSON.stringify({ n: NEVER_REVIEW })).n === NEVER_REVIEW);

  // ---------- 4. 落库：排期、计数、以及不覆盖 FSRS 遗留列 ----------
  const mkWord = (id, thai, meaning) => ({
    id, thai, meaning, toneMark: 'mid', pos: '', example: '', note: '', tags: ['测试'],
    createdAt: 1000, updatedAt: 1000,
  });
  await race(db.words.bulkAdd([
    mkWord(1, 'ก', '甲'), mkWord(2, 'ข', '乙'), mkWord(3, 'ค', '丙'), mkWord(4, 'ง', '丁'),
  ]), 'seed words');

  // 词 1 带着 FSRS 时代的历史列
  await race(db.reviewStates.put({
    wordId: 1, difficulty: 7.25, stability: 12.5, reps: 9, lapses: 2,
    lastReview: 1, nextReview: 2, state: 2,
  }), 'seed legacy state');

  {
    const before = Date.now();
    const res = await race(gradeReview(1, 3), 'gradeReview good');
    const after = Date.now();
    const st = await race(getReviewState(1), 'read state');
    check('按良好后 nextReview = 本次时间 + 3 天',
      st.nextReview >= before + 3 * DAY && st.nextReview <= after + 3 * DAY,
      `实际 +${st.nextReview - before}ms`);
    check('返回值与库内一致', res.nextReview === st.nextReview);
    check('difficulty 历史值未被写坏', st.difficulty === 7.25, `实际 ${st.difficulty}`);
    check('stability 历史值未被写坏', st.stability === 12.5, `实际 ${st.stability}`);
    check('reps 累加', st.reps === 10, `实际 ${st.reps}`);
    check('非忘记不增加 lapses', st.lapses === 2, `实际 ${st.lapses}`);
    check('state 记录最近档位', st.state === 3, `实际 ${st.state}`);
    check('lastReview 已更新', st.lastReview >= before && st.lastReview <= after);
  }

  {
    const before = Date.now();
    await race(gradeReview(1, 1), 'gradeReview again');
    const st = await race(getReviewState(1), 'read state again');
    check('按忘记后延后正好 10 分钟',
      st.nextReview - st.lastReview === 10 * MINUTE && st.lastReview >= before,
      `实际 +${st.nextReview - st.lastReview}ms`);
    check('忘记累加 lapses', st.lapses === 3, `实际 ${st.lapses}`);
    check('忘记排在 10 分钟后，当下仍不算到期（上次是 3 天不影响）',
      (await race(getDueReviewStates(), 'due0')).some(s => s.wordId === 1) === false);
  }

  {
    const stats = await race(db.dailyStats.toArray(), 'stats');
    const today = stats.find(s => s.reviewsDone >= 2);
    check('两次评分都计入当日复习数', !!today && today.reviewsDone === 2, `实际 ${json(stats)}`);
    // 今日新词是入库口径（在 addWord 里计），本文件全部用 bulkAdd 造词，所以它该一直是 0
    check('有历史的词评分不动今日新词', today.newWords === 0, `实际 ${today.newWords}`);
  }

  // ---------- 5. 毕业：不再出现在待复习，也不回流成新词 ----------
  {
    await race(initNewWordReview(2), 'init new word 2');
    const st = await race(getReviewState(2), 'read 2');
    check('新词初始化即刻到期', st.nextReview <= Date.now());
    check('新词初始化 reps/lapses 从 0 起', st.reps === 0 && st.lapses === 0);
    check('新词出现在待复习队列',
      (await race(getDueReviewStates(), 'due1')).some(s => s.wordId === 2) === true);
    await race(initNewWordReview(2), 'init again');
    check('抽进队列只建排期行，不动今日新词', (await newWordsTotal()) === 0, `实际 ${await newWordsTotal()}`);

    await race(gradeReview(2, 6), 'graduate 2');
    check('首次评分也不动今日新词', (await newWordsTotal()) === 0, `实际 ${await newWordsTotal()}`);
    const grad = await race(getReviewState(2), 'read 2c');
    check('按已牢记写哨兵', grad.nextReview === NEVER_REVIEW && isGraduated(grad) === true);
    check('已牢记不进入待复习队列',
      (await race(getDueReviewStates(), 'due2')).some(s => s.wordId === 2) === false);
    check('已牢记不回流成新词',
      (await race(getNewWordsWithoutReview(), 'new')).includes(2) === false);
    check('已牢记名单能查到',
      (await race(getGraduatedReviewStates(), 'grad')).map(s => s.wordId).join() === '2');
    check('已牢记计数 = 1', (await race(getGraduatedCount(), 'count')) === 1);

    await race(gradeReview(3, 6), 'graduate 3');
    check('已牢记计数 = 2', (await race(getGraduatedCount(), 'count2')) === 2);
    check('已牢记名单按毕业先后排序',
      (await race(getGraduatedReviewStates(), 'grad2')).map(s => s.wordId).join() === '2,3');
  }

  // ---------- 6. 取消毕业 ----------
  {
    await race(ungraduateWord(2), 'ungraduate 2');
    const st = await race(getReviewState(2), 'read 2d');
    check('取消毕业后立刻回到待复习', st.nextReview <= Date.now());
    check('取消毕业把档位标记归 0', st.state === 0, `实际 ${st.state}`);
    check('取消毕业保留复习次数（不算从头重来）', st.reps === 1, `实际 ${st.reps}`);
    check('取消毕业后已牢记计数下降', (await race(getGraduatedCount(), 'count3')) === 1);
    check('取消毕业后出现在到期队列',
      (await race(getDueReviewStates(), 'due3')).some(s => s.wordId === 2) === true);

    const beforeGood = await race(getReviewState(1), 'read 1');
    await race(ungraduateWord(1), 'ungraduate non-graduated');
    const afterGood = await race(getReviewState(1), 'read 1b');
    check('对未毕业的词调用取消毕业是空操作（排期原样不动）',
      json(afterGood) === json(beforeGood), `${json(beforeGood)} → ${json(afterGood)}`);

    let missingOk = true;
    try { await race(ungraduateWord(4), 'ungraduate missing'); } catch { missingOk = false; }
    check('对不存在的复习记录调用取消毕业不报错', missingOk === true);
    check('没有复习记录的词不会被取消毕业造出空行',
      (await race(getReviewState(4), 'read 4')) === undefined);

    // 词 2 此刻 reps=1，再评一次属于「老词回访」
    await race(gradeReview(2, 5), 're-grade 2');
    check('老词回访评分同样不动今日新词', (await newWordsTotal()) === 0, `实际 ${await newWordsTotal()}`);
    check('已牢记名单不受这次评分影响', (await race(getGraduatedCount(), 'count5')) === 1);
  }

  return { count: results.length, failed };
}

const summary = await main();
const pass = summary.count - summary.failed;
for (const r of results) if (!r.ok) console.log(`FAIL  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
console.log(`\n复习六档回归：共 ${summary.count} 项，通过 ${pass} 项，失败 ${summary.failed} 项`);
if (summary.failed > 0) process.exit(1);
console.log('全部通过 ✓');
