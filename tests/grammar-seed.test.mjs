// 语法种子初始化（grammarSeeded 标记）回归测试。
// 运行：node tests/grammar-seed.test.mjs
// 隔离性：本文件只在 node 进程内的 fake-indexeddb（内存实现）里读写数据，进程退出即销毁，
// 不会接触浏览器里的 ThaiLearnDB、本地学习数据或线上数据。
// 核心断言：只有「fetch 成功 + JSON 解析成功 + 数据库写入成功」才允许写 grammarSeeded；
// 任一环节失败都必须留下「未播种」状态，让下一次进入语法页能够重试。
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const FLAG = 'grammarSeeded';
const SEED_URL = '/data/grammar-points.json';
// 用线上真实种子文件当成功用例的输入，避免测试自己造一份和生产不一致的数据。
const FIXTURE = JSON.parse(readFileSync(new URL('../public/data/grammar-points.json', import.meta.url), 'utf8'));
const FIXTURE_COUNT = FIXTURE.points.length;

const results = [];
let failed = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed++;
}
const json = (v) => JSON.stringify(v);
function race(promise, label, ms = 8000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`超时：${label}`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// 把场景断言包起来：任何意外抛出都记成失败，后续场景继续跑。
async function scenario(name, fn) {
  try {
    await fn();
  } catch (e) {
    check(`${name} 执行未抛异常`, false, String(e?.stack ?? e));
  }
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
  let grammarModule;
  try {
    dbModule = await server.ssrLoadModule('/src/db/index.ts');
    grammarModule = await server.ssrLoadModule('/src/db/grammar.ts');
  } finally {
    await server.close();
  }
  const { db, getSetting } = dbModule;
  const { loadGrammarPoints, createGrammarPoint } = grammarModule;

  const realFetch = globalThis.fetch;
  const realSettingsPut = db.settings.put.bind(db.settings);
  const realGrammarAdd = db.grammarPoints.add.bind(db.grammarPoints);
  let fetchCalls = 0;
  let fetchUrls = [];
  let flagWriteSnapshots = [];

  function stubFetch(handler) {
    globalThis.fetch = async (url) => {
      fetchCalls++;
      fetchUrls.push(url);
      return handler(url);
    };
  }
  const respond = (body) => stubFetch(async () => ({ ok: true, status: 200, json: async () => body }));
  const respondBrokenJson = () => stubFetch(async () => ({
    ok: true, status: 200,
    json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
  }));
  const respondError = (status) => stubFetch(async () => ({
    ok: false, status,
    json: async () => { throw new Error('非 2xx 响应不应被解析'); },
  }));
  const respondNetworkFailure = () => stubFetch(async () => { throw new TypeError('Failed to fetch'); });
  const respondSlowly = (body, ms) => stubFetch(async () => {
    await delay(ms);
    return { ok: true, status: 200, json: async () => body };
  });

  // 记录「写标记那一刻」表里已有多少条语法数据，用来证明顺序是先落数据、后写标记。
  function spySettingsPut() {
    db.settings.put = async (obj, ...rest) => {
      if (obj?.key === FLAG) flagWriteSnapshots.push({ value: obj.value, grammarCount: await db.grammarPoints.count() });
      return realSettingsPut(obj, ...rest);
    };
  }
  function failGrammarAdd(atIndex) {
    let n = 0;
    db.grammarPoints.add = async (row, ...rest) => {
      if (++n === atIndex) throw new Error(`模拟写入失败（第 ${atIndex} 条）`);
      return realGrammarAdd(row, ...rest);
    };
  }

  async function reset() {
    globalThis.fetch = realFetch;
    db.settings.put = realSettingsPut;
    db.grammarPoints.add = realGrammarAdd;
    fetchCalls = 0;
    fetchUrls = [];
    flagWriteSnapshots = [];
    await db.grammarPoints.clear();
    await db.settings.delete(FLAG);
  }

  const flagValue = () => race(getSetting(FLAG), 'read flag');
  const rowCount = () => race(db.grammarPoints.count(), 'count grammar');
  const rows = () => race(db.grammarPoints.orderBy('order').toArray(), 'read grammar');
  function checkUnseeded(label, expectedFetchCalls = 1) {
    return async () => {
      check(`${label}：不写 grammarSeeded 标记`, (await flagValue()) === '', `实际 ${json(await flagValue())}`);
      check(`${label}：语法表保持为空`, (await rowCount()) === 0, `实际 ${await rowCount()} 条`);
      check(`${label}：确实尝试过播种 ${expectedFetchCalls} 次`, fetchCalls === expectedFetchCalls, `实际 ${fetchCalls} 次`);
    };
  }

  // ---------- 1. fetch 失败：网络异常 / 非 2xx / JSON 解析失败 ----------
  await scenario('网络异常', async () => {
    await reset();
    respondNetworkFailure();
    const result = await race(loadGrammarPoints(), 'loadGrammarPoints（网络异常）');
    check('网络异常：页面读取仍返回数组而非抛错', Array.isArray(result) && result.length === 0, `实际 ${json(result)}`);
    await checkUnseeded('网络异常')();
  });

  await scenario('HTTP 500', async () => {
    await reset();
    respondError(500);
    await race(loadGrammarPoints(), 'loadGrammarPoints（500）');
    await checkUnseeded('HTTP 500')();
  });

  await scenario('JSON 解析失败', async () => {
    await reset();
    respondBrokenJson();
    await race(loadGrammarPoints(), 'loadGrammarPoints（坏 JSON）');
    await checkUnseeded('JSON 解析失败')();
  });

  // ---------- 2. 载荷非法：缺 points / 非数组 / 空数组，都不算播种成功 ----------
  for (const [label, body] of [
    ['缺少 points 字段', { description: '没有句型' }],
    ['points 不是数组', { points: { title: '应为数组' } }],
    ['points 为空数组', { points: [] }],
    ['points 全为非法条目', { points: [{ content: '无标题' }, null, 42] }],
  ]) {
    await scenario(label, async () => {
      await reset();
      respond(body);
      await race(loadGrammarPoints(), `loadGrammarPoints（${label}）`);
      await checkUnseeded(label)();
    });
  }

  // ---------- 3. 数据库写入失败 ----------
  await scenario('首条写入失败', async () => {
    await reset();
    respond(FIXTURE);
    spySettingsPut();
    failGrammarAdd(1);
    const result = await race(loadGrammarPoints(), 'loadGrammarPoints（首条写入失败）');
    check('首条写入失败：不抛错打断页面', Array.isArray(result), `实际 ${json(result)}`);
    await checkUnseeded('首条写入失败')();
    check('首条写入失败：未偷偷写入标记', flagWriteSnapshots.length === 0, `实际 ${json(flagWriteSnapshots)}`);
  });

  await scenario('中途写入失败', async () => {
    await reset();
    respond(FIXTURE);
    spySettingsPut();
    failGrammarAdd(4);
    await race(loadGrammarPoints(), 'loadGrammarPoints（中途写入失败）');
    check('中途写入失败：事务整体回滚不留半截数据', (await rowCount()) === 0, `实际 ${await rowCount()} 条`);
    check('中途写入失败：不写 grammarSeeded 标记', (await flagValue()) === '', `实际 ${json(await flagValue())}`);
    check('中途写入失败：未执行标记写入', flagWriteSnapshots.length === 0, `实际 ${json(flagWriteSnapshots)}`);
  });

  // ---------- 4. 成功路径：先写数据，再写标记 ----------
  await scenario('成功播种', async () => {
    await reset();
    respond(FIXTURE);
    spySettingsPut();
    const result = await race(loadGrammarPoints(), 'loadGrammarPoints（成功）');
    check('成功：返回全部种子句型', result.length === FIXTURE_COUNT, `实际 ${result.length} 条，应为 ${FIXTURE_COUNT} 条`);
    check('成功：数据库写入全部种子句型', (await rowCount()) === FIXTURE_COUNT, `实际 ${await rowCount()} 条`);
    check('成功：只请求语法种子文件', json(fetchUrls) === json([SEED_URL]), `实际 ${json(fetchUrls)}`);
    check('成功：写入 grammarSeeded 标记', /^\d+$/.test(await flagValue() ?? ''), `实际 ${json(await flagValue())}`);
    check('成功：写标记时数据已在库中', flagWriteSnapshots.length === 1 && flagWriteSnapshots[0].grammarCount === FIXTURE_COUNT,
      `实际 ${json(flagWriteSnapshots)}`);

    const seeded = await rows();
    check('成功：order 与种子文件顺序一致', json(seeded.map(r => r.order)) === json(seeded.map((_, i) => i)),
      `实际 ${json(seeded.map(r => r.order))}`);
    check('成功：标题逐条对应种子文件', json(seeded.map(r => r.title)) === json(FIXTURE.points.map(p => p.title)),
      `实际 ${json(seeded.map(r => r.title))}`);
    check('成功：全部标记为非自建', seeded.every(r => r.isUserCreated === false), `实际 ${json(seeded.map(r => r.isUserCreated))}`);
    check('成功：句型和例句仍为数组', seeded.every(r => Array.isArray(r.patterns) && Array.isArray(r.examples)),
      `实际 ${json(seeded.map(r => [Array.isArray(r.patterns), Array.isArray(r.examples)]))}`);
    check('成功：note 缺省为空串', seeded.every(r => typeof r.note === 'string'), `实际 ${json(seeded.map(r => r.note))}`);
    check('成功：createdAt / updatedAt 为数字', seeded.every(r => typeof r.createdAt === 'number' && typeof r.updatedAt === 'number'),
      `实际 ${json(seeded.map(r => [r.createdAt, r.updatedAt]))}`);
    check('成功：例句对象结构未改动', json(seeded[0].examples) === json(FIXTURE.points[0].examples),
      `实际 ${json(seeded[0].examples)}`);
  });

  // ---------- 5. 已初始化成功的设备不重复播种 ----------
  await scenario('已播种且表非空', async () => {
    const before = (await rows()).map(r => r.id).join(',');
    const beforeFlag = await flagValue();
    fetchCalls = 0;
    fetchUrls = [];
    flagWriteSnapshots = [];
    const result = await race(loadGrammarPoints(), 'loadGrammarPoints（第二次进入）');
    check('重复进入：不再请求种子文件', fetchCalls === 0, `实际请求 ${fetchCalls} 次`);
    check('重复进入：条数不变', (await rowCount()) === FIXTURE_COUNT, `实际 ${await rowCount()} 条`);
    check('重复进入：记录 id 不变', (await rows()).map(r => r.id).join(',') === before, `之前 ${before}`);
    check('重复进入：返回值与库内一致', result.length === FIXTURE_COUNT, `实际 ${result.length} 条`);
    check('重复进入：标记值不变', (await flagValue()) === beforeFlag, `之前 ${json(beforeFlag)}，现在 ${json(await flagValue())}`);
    check('重复进入：不重复写标记', flagWriteSnapshots.length === 0, `实际 ${json(flagWriteSnapshots)}`);
  });

  await scenario('已播种但用户删光句型', async () => {
    await db.grammarPoints.clear();
    fetchCalls = 0;
    fetchUrls = [];
    flagWriteSnapshots = [];
    const result = await race(loadGrammarPoints(), 'loadGrammarPoints（删光后进入）');
    check('用户删光：不复活种子数据（未播种）', (await rowCount()) === 0, `实际 ${await rowCount()} 条`);
    check('用户删光：不请求种子文件', fetchCalls === 0, `实际请求 ${fetchCalls} 次`);
    check('用户删光：返回空列表不抛错', Array.isArray(result) && result.length === 0, `实际 ${json(result)}`);
    check('用户删光：标记保持已播种', /^\d+$/.test(await flagValue() ?? ''), `实际 ${json(await flagValue())}`);
  });

  // ---------- 6. 表内已有用户自建句型时不得播种 ----------
  await scenario('仅用户自建数据', async () => {
    await reset();
    const id = await race(createGrammarPoint({
      title: '我的自建句型', content: '自编内容', patterns: ['A B'], examples: [{ thai: 'ฉัน', meaning: '我' }], note: '备忘',
    }), 'createGrammarPoint');
    respond(FIXTURE);
    spySettingsPut();
    const result = await race(loadGrammarPoints(), 'loadGrammarPoints（已有自建句型）');
    check('自建数据：不请求种子文件', fetchCalls === 0, `实际请求 ${fetchCalls} 次`);
    check('自建数据：不被覆盖或追加', (await rowCount()) === 1, `实际 ${await rowCount()} 条`);
    const mine = await race(db.grammarPoints.get(id), 'read back user point');
    check('自建数据：字段原样保留', mine?.title === '我的自建句型' && mine?.note === '备忘' && mine?.isUserCreated === true,
      `实际 ${json(mine ?? null)}`);
    check('自建数据：返回值就是这条自建句型', result.length === 1 && result[0].id === id, `实际 ${json(result.map(r => r.id))}`);
    check('自建数据：不误写成功标记', (await flagValue()) === '' && flagWriteSnapshots.length === 0,
      `标记 ${json(await flagValue())}，写入快照 ${json(flagWriteSnapshots)}`);
  });

  // ---------- 7. 失败后下次进入自动重试 ----------
  await scenario('失败后重试', async () => {
    await reset();
    respondNetworkFailure();
    await race(loadGrammarPoints(), 'loadGrammarPoints（首次失败）');
    check('重试：首次失败未写标记', (await flagValue()) === '', `实际 ${json(await flagValue())}`);
    respond(FIXTURE);
    spySettingsPut();
    const result = await race(loadGrammarPoints(), 'loadGrammarPoints（第二次重试）');
    check('重试：第二次成功写入全部句型', result.length === FIXTURE_COUNT, `实际 ${result.length} 条`);
    check('重试：成功后才写标记', /^\d+$/.test(await flagValue() ?? '') && flagWriteSnapshots.length === 1,
      `标记 ${json(await flagValue())}，快照 ${json(flagWriteSnapshots)}`);
    check('重试：没有重复播种', (await rowCount()) === FIXTURE_COUNT, `实际 ${await rowCount()} 条`);
  });

  // ---------- 8. 并发进入只播种一次 ----------
  await scenario('并发播种', async () => {
    await reset();
    respondSlowly(FIXTURE, 30);
    const [a, b, c] = await race(Promise.all([
      loadGrammarPoints(), loadGrammarPoints(), loadGrammarPoints(),
    ]), '并发 loadGrammarPoints');
    check('并发：只发起一次种子请求', fetchCalls === 1, `实际 ${fetchCalls} 次`);
    check('并发：数据不重复写入', (await rowCount()) === FIXTURE_COUNT, `实际 ${await rowCount()} 条`);
    check('并发：三次读取条数一致', a.length === FIXTURE_COUNT && b.length === FIXTURE_COUNT && c.length === FIXTURE_COUNT,
      `实际 ${json([a.length, b.length, c.length])}`);
    check('并发：标记只写一次', /^\d+$/.test(await flagValue() ?? ''), `实际 ${json(await flagValue())}`);
  });

  // ---------- 9. 读取「表为空」之后才有别的写入者落库 ----------
  await scenario('竞态写入者', async () => {
    await reset();
    const seedRows = FIXTURE.points.map((p, i) => ({
      title: p.title, content: p.content ?? '', patterns: p.patterns ?? [], examples: p.examples ?? [],
      order: i, note: '', isUserCreated: false, createdAt: 1, updatedAt: 1,
    }));
    // 模拟并发重试 / 另一个标签页：本次 fetch 期间它已经把数据写完了。
    let competitorIds = [];
    stubFetch(async () => {
      const before = await rows();
      for (const row of seedRows) await realGrammarAdd(row);
      const after = await rows();
      competitorIds = after.filter(r => !before.includes(r)).map(r => r.id);
      return { ok: true, status: 200, json: async () => FIXTURE };
    });
    spySettingsPut();
    const result = await race(loadGrammarPoints(), 'loadGrammarPoints（竞态写入者）');
    check('竞态：并发写入者确实写入了数据', competitorIds.length === FIXTURE_COUNT, `实际 ${competitorIds.length} 条`);
    check('竞态：不写入第二份种子数据', (await rowCount()) === FIXTURE_COUNT, `实际 ${await rowCount()} 条`);
    check('竞态：已有记录的 id 未被替换', json((await rows()).map(r => r.id)) === json(competitorIds),
      `原有 ${json(competitorIds)}，现在 ${json((await rows()).map(r => r.id))}`);
    check('竞态：返回值条数与库内一致', result.length === FIXTURE_COUNT, `实际 ${result.length} 条`);
    check('竞态：本趟未写成功标记', (await flagValue()) === '' && flagWriteSnapshots.length === 0,
      `标记 ${json(await flagValue())}，快照 ${json(flagWriteSnapshots)}`);
  });

  await reset();
  globalThis.fetch = realFetch;
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
