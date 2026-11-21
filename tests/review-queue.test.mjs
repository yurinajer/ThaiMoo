// 复习队列编排回归测试：导入不预写排期、新词按入库顺序、单轮 50+20 上限、编排只读不写库、今日新词按入库计。
// 运行：node tests/review-queue.test.mjs
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
const race = (promise, label, ms = 30000) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`超时：${label}`)), ms)),
]);

// 上限冻结在测试里，不跟随生产代码走：改数字必须同时改这里。
const WANT_DUE_LIMIT = 50;
const WANT_NEW_LIMIT = 20;

async function main() {
  const server = await createServer({
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true, include: [] },
  });

  let db, review, vocab;
  try {
    ({ db } = await server.ssrLoadModule('/src/db/index.ts'));
    review = await server.ssrLoadModule('/src/db/review.ts');
    vocab = await server.ssrLoadModule('/src/db/vocabulary.ts');
  } finally {
    await server.close();
  }

  const {
    SESSION_DUE_LIMIT, SESSION_NEW_LIMIT, planReviewSession, planSessionCounts,
    getDueCount, getNewWordCount, getNewWordsWithoutReview, getDueReviewStates,
    initNewWordReview, gradeReview,
  } = review;
  const { importWords, addWord } = vocab;

  const mk = (n, tag) => Array.from({ length: n }, (_, i) => ({
    thai: `${tag}${String(i).padStart(4, '0')}`,
    meaning: `${tag}义${i}`,
    toneMark: 'mid', pos: '', example: '', note: '', tags: ['队列测试'],
  }));
  const newWordsTotal = async () =>
    (await db.dailyStats.toArray()).reduce((sum, s) => sum + (s.newWords || 0), 0);

  // ---------- 1. 上限就是需求里说定的两个数 ----------
  check('单轮到期上限 = 50', SESSION_DUE_LIMIT === WANT_DUE_LIMIT, `实际 ${SESSION_DUE_LIMIT}`);
  check('单轮新词上限 = 20', SESSION_NEW_LIMIT === WANT_NEW_LIMIT, `实际 ${SESSION_NEW_LIMIT}`);
  check('Dexie 版本仍是 3（队列编排不动 schema）', db.verno === 3, `实际 ${db.verno}`);

  // ---------- 2. 导入只入词库，不再当场排期 ----------
  const day1 = await race(importWords(mk(30, 'D1')), 'import day1');
  check('导入 30 词全部入库', day1.imported === 30, `实际 ${day1.imported}`);
  check('导入不写排期行', (await race(db.reviewStates.count(), 'rows')) === 0);
  check('导入的词显示在「新词」格里', (await race(getNewWordCount(), 'new0')) === 30);
  check('导入的词不当即到期', (await race(getDueCount(), 'due0')) === 0);
  check('导入当天就计入今日新词（入库口径）', (await newWordsTotal()) === 30, `实际 ${await newWordsTotal()}`);

  // ---------- 3. 新词顺序 = 入库顺序，第二天排在后面 ----------
  const day2 = await race(importWords(mk(5, 'D2')), 'import day2');
  const pool = await race(getNewWordsWithoutReview(), 'pool');
  check('第二批入库把今日新词累加到 35', (await newWordsTotal()) === 35, `实际 ${await newWordsTotal()}`);
  check('今日新词与待复习并行：入库 35 而到期仍 0',
    (await newWordsTotal()) === 35 && (await race(getDueCount(), 'dueD2')) === 0);
  check('新词池按主键升序', json(pool) === json([...pool].sort((a, b) => a - b)));
  check('第二天导入的 5 个词接在昨天 30 个之后',
    pool.slice(30).join() === day2.ids.join(), `池尾 ${pool.slice(30).join()} / 导入 ${day2.ids.join()}`);
  check('带数量取新词 = 取入库最早的那几个',
    (await race(getNewWordsWithoutReview(3), 'pool3')).join() === pool.slice(0, 3).join());

  // ---------- 4. 本轮新词名额 ----------
  const plan0 = await race(planReviewSession(), 'plan0');
  check('一轮只激活 20 个新词', plan0.newIds.length === WANT_NEW_LIMIT, `实际 ${plan0.newIds.length}`);
  check('激活的是入库最早的 20 个', plan0.newIds.join() === pool.slice(0, WANT_NEW_LIMIT).join());
  check('新词剩余量 = 35 - 20', plan0.newOmitted === 15, `实际 ${plan0.newOmitted}`);
  check('没有到期词时 due 为空', plan0.due.length === 0 && plan0.dueOmitted === 0);

  // ---------- 5. 抽中才排期（复现复习页 buildReviewQueue 落笔的那一步） ----------
  for (const id of plan0.newIds) await race(initNewWordReview(id), `init ${id}`);
  check('抽中的 20 个词从新词池移到待复习',
    (await race(getNewWordCount(), 'new1')) === 15 && (await race(getDueCount(), 'due1')) === 20);
  check('抽进队列不叠加今日新词（只在入库时计一次）', (await newWordsTotal()) === 35, `实际 ${await newWordsTotal()}`);

  // ---------- 6. 中途退出后，下一轮它们以最先到期回到队首 ----------
  const plan1 = await race(planReviewSession(), 'plan1');
  check('未评分的词下一轮以到期身份回来，顺序不变',
    json(plan1.due.map(s => s.wordId)) === json(plan0.newIds), `实际 ${plan1.due.map(s => s.wordId).join()}`);
  check('到期名额没用满时不硬凑', plan1.due.length === 20 && plan1.dueOmitted === 0);
  check('新词名额接着放下一批 15 个',
    plan1.newIds.length === 15 && plan1.newOmitted === 0, `实际 ${plan1.newIds.length}/${plan1.newOmitted}`);

  // ---------- 7. 到期侧：超过 50 张时截断 + 按到期时间升序 ----------
  await race(importWords(mk(120, 'D3')), 'import 120');
  for (const id of await race(getNewWordsWithoutReview(), 'pool2')) {
    await race(initNewWordReview(id), `init ${id}`);
  }
  const dueTotal = await race(getDueCount(), 'dueTotal');
  check('全部激活后新词池清空、到期共 155',
    (await race(getNewWordCount(), 'new2')) === 0 && dueTotal === 155, `实际到期 ${dueTotal}`);
  await race(importWords(mk(40, 'D4')), 'import day4');
  // 本文件所有词都走 addWord，所以今日新词应当等于词库总量，包括还没激活的 D4
  check('今日新词 = 累计入库 195（含未激活的 D4 批次）',
    (await newWordsTotal()) === 195 && (await race(db.words.count(), 'wordcount')) === 195,
    `实际新词 ${await newWordsTotal()} / 词库 ${await race(db.words.count(), 'wordcount2')}`);

  // 给每条排期铺上互不相同的时间戳，且 id 越小铺得越晚 —— 「最先到期」于是等于 id 最大的一批
  const states = await race(db.reviewStates.toArray(), 'states');
  const base = Date.now() - 10 * 60 * 1000;
  const laid = states.map((s, i) => ({ wordId: s.wordId, nextReview: base + (states.length - i) * 1000 }));
  await race(db.transaction('rw', db.reviewStates, async () => {
    for (const row of laid) await db.reviewStates.update(row.wordId, { nextReview: row.nextReview });
  }), 'stagger');
  const sortedAll = [...laid].sort((a, b) => a.nextReview - b.nextReview);

  const plan2 = await race(planReviewSession(), 'plan2');
  check('到期名额截到 50', plan2.due.length === WANT_DUE_LIMIT, `实际 ${plan2.due.length}`);
  check('到期取最先到期的 50 张，顺序一致',
    json(plan2.due.map(s => [s.wordId, s.nextReview])) === json(sortedAll.slice(0, WANT_DUE_LIMIT).map(e => [e.wordId, e.nextReview])),
    `实际头三个 ${plan2.due.slice(0, 3).map(s => s.wordId).join()}`);
  check('装不下的 105 张只报数，不丢排期', plan2.dueOmitted === dueTotal - WANT_DUE_LIMIT, `实际 ${plan2.dueOmitted}`);
  check('新词名额给最年轻的 D4 批次',
    plan2.newIds.join() === Array.from({ length: WANT_NEW_LIMIT }, (_, i) => 156 + i).join(),
    `实际 ${plan2.newIds.join()}`);
  check('新词剩余量 = 40 - 20', plan2.newOmitted === 20, `实际 ${plan2.newOmitted}`);

  // ---------- 8. 编排是只读的：可以反复查，不消耗名额也不写库 ----------
  const beforeRows = await race(db.reviewStates.toArray(), 'beforeRows');
  const again1 = await race(planReviewSession(), 'again1');
  const again2 = await race(planReviewSession(), 'again2');
  const afterRows = await race(db.reviewStates.toArray(), 'afterRows');
  check('连续两次编排结果一致', json(again1.due.map(s => s.wordId)) === json(again2.due.map(s => s.wordId)));
  check('编排不写库：排期行逐字节原样', json(beforeRows) === json(afterRows));
  check('编排不会把没抽中的新词标成已排期', (await race(getNewWordCount(), 'new3')) === 40);
  check('剩余量守恒：due + dueOmitted = 全部到期',
    again1.due.length + again1.dueOmitted === dueTotal, `实际 ${again1.due.length}+${again1.dueOmitted}`);
  check('剩余量守恒：newIds + newOmitted = 全部新词',
    again1.newIds.length + again1.newOmitted === 40, `实际 ${again1.newIds.length}+${again1.newOmitted}`);
  check('被截断的到期词仍留在到期队列里',
    (await race(getDueReviewStates(), 'dueAll')).length === dueTotal);

  // ---------- 9. 已牢记的词不占名额，后面的自动补上 ----------
  const headId = again1.due[0].wordId;
  await race(gradeReview(headId, 6), 'graduate head');
  const plan3 = await race(planReviewSession(), 'plan3');
  check('毕业词退出到期队列', plan3.due.some(s => s.wordId === headId) === false);
  check('到期总数少 1', (await race(getDueCount(), 'dueAfterGrad')) === dueTotal - 1);
  check('第 51 张自动补进本轮名额',
    json(plan3.due.map(s => s.wordId)) === json(sortedAll.map(x => x.wordId).filter(id => id !== headId).slice(0, WANT_DUE_LIMIT)),
    `实际 ${plan3.due.map(s => s.wordId).slice(0, 3).join()}…`);
  check('毕业词也不回流成新词',
    (await race(getNewWordsWithoutReview(), 'poolAfterGrad')).includes(headId) === false);

  // ---------- 10. 首页/复习页那句「本轮几张」的算术 ----------
  const counts = (d, n) => json(planSessionCounts(d, n));
  check('planSessionCounts(0, 0) → 本轮 0', counts(0, 0) === json({ planned: 0, dueOmitted: 0, newOmitted: 0 }));
  check('planSessionCounts(3, 4) → 未触顶按实际数', counts(3, 4) === json({ planned: 7, dueOmitted: 0, newOmitted: 0 }));
  check('planSessionCounts(50, 20) → 正好占满，不提示剩余', counts(50, 20) === json({ planned: 70, dueOmitted: 0, newOmitted: 0 }));
  check('planSessionCounts(2800, 2800) → 本轮 70，剩余 2750/2780',
    counts(2800, 2800) === json({ planned: 70, dueOmitted: 2750, newOmitted: 2780 }), `实际 ${counts(2800, 2800)}`);

  // ---------- 11. 今日新词的口径边界：只有 addWord 计数 ----------
  const beforeN = await newWordsTotal();
  const someNew = (await race(getNewWordsWithoutReview(), 'poolNow'))[0];
  await race(initNewWordReview(someNew), 'init one');
  await race(gradeReview(someNew, 3), 'grade once');
  await race(gradeReview(someNew, 4), 'grade twice');
  check('激活 + 首次评分 + 再次评分都不改今日新词', (await newWordsTotal()) === beforeN, `实际 +${(await newWordsTotal()) - beforeN}`);

  await race(addWord({ thai: 'เดี่ยว', meaning: '单独', toneMark: 'mid', pos: '', example: '', note: '', tags: ['队列测试'] }), 'addWord');
  check('单条添加计入今日新词', (await newWordsTotal()) === beforeN + 1, `实际 ${await newWordsTotal()}`);

  const dup = await race(importWords(mk(30, 'D1')), 'reimport day1');
  check('整批重复导入不计今日新词',
    dup.imported === 0 && dup.duplicates === 30 && (await newWordsTotal()) === beforeN + 1,
    `实际 imported=${dup.imported} duplicates=${dup.duplicates} 新词=${await newWordsTotal()}`);

  await race(db.words.add({
    thai: 'กู้', meaning: '直写库', toneMark: 'mid', pos: '', example: '', note: '',
    tags: ['队列测试'], createdAt: 1000, updatedAt: 1000,
  }), 'raw add');
  check('绕过 addWord 的直接写库（备份恢复路径）不计今日新词',
    (await newWordsTotal()) === beforeN + 1, `实际 ${await newWordsTotal()}`);

  return { count: results.length, failed };
}

const summary = await main();
const pass = summary.count - summary.failed;
for (const r of results) if (!r.ok) console.log(`FAIL  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
console.log(`\n复习队列上限回归：共 ${summary.count} 项，通过 ${pass} 项，失败 ${summary.failed} 项`);
if (summary.failed > 0) process.exit(1);
console.log('全部通过 ✓');
