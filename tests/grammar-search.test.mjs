// 语法句型搜索命中范围回归测试。
// 运行：node tests/grammar-search.test.mjs
// 全部数据只存在于内存：grammarMatches 是纯函数，不打开 Dexie、不写 IndexedDB。
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
});
const { grammarMatches } = await server.ssrLoadModule('/src/pages/grammar.ts');
await server.close();

const results = [];
let failed = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed++;
}
const json = (v) => JSON.stringify(v);
const point = (over = {}) => ({
  title: 'แล้ว (lɛ́ɛo) - 已经/了',
  content: '放在动词后表示动作已完成',
  patterns: ['ฉัน กิน ข้าว (我 吃 饭)'],
  examples: [{ thai: 'ฉันกินข้าวแล้ว', meaning: '我已经吃饭了', roman: 'chǎn gin kâao lɛ́ɛo' }],
  order: 1,
  note: '否定完成用 ยังไม่',
  ...over,
});

// ---------- 1. 五个字段都要能命中 ----------
const fields = [
  ['语法名称', p => p.title, 'แล้ว'],
  ['中文解释', p => p.content, '已完成'],
  ['泰语句型', p => p.patterns[0], 'ฉัน กิน ข้าว'],
  ['例句泰文', p => p.examples[0].thai, 'กินข้าว'],
  ['例句中文', p => p.examples[0].meaning, '吃饭'],
  ['例句罗马音', p => p.examples[0].roman, 'kâao'],
  ['补充说明', p => p.note, 'ยังไม่'],
];
for (const [label, pick, needle] of fields) {
  check(`命中${label}`, grammarMatches(point(), needle.toLowerCase()) === true, `关键词 ${needle}，实际 false`);
}

// ---------- 2. 不命中与大小写 ----------
check('无关关键词不命中', grammarMatches(point(), '水电费') === false, json(grammarMatches(point(), '水电费')));
check('英文关键词大小写不敏感', grammarMatches(point(), 'LƐ́ƐO'.toLowerCase()) === true && grammarMatches(point(), 'lɛ́ɛo') === true);
check('泰文关键词大小写路径无副作用', grammarMatches(point(), 'ข้าว') === true);
check('空关键词等同于全量命中', grammarMatches(point(), '') === true);

// ---------- 3. 缺字段的历史记录不能抛错 ----------
const thin = { title: 'A', content: '', patterns: [], examples: [], order: 0 };
check('空数组字段不抛错', grammarMatches(thin, 'zzz') === false);
check('缺 note 的旧记录不抛错', grammarMatches(thin, 'zzz') === false, 'undefined?.toLowerCase 会直接崩');
check('缺 roman 的例句不抛错', grammarMatches({ ...thin, examples: [{ thai: 'ก', meaning: 'x' }] }, 'zzz') === false);
check('缺 roman 的例句仍能命中泰文', grammarMatches({ ...thin, examples: [{ thai: 'ก', meaning: 'x' }] }, 'ก') === true);
check('例句数组为空时不抛错', grammarMatches({ ...thin, examples: [], patterns: [] }, 'ก') === false);

// ---------- 输出 ----------
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n        ${r.detail}`}`);
}
console.log(`\n共 ${results.length} 项，通过 ${results.length - failed} 项，失败 ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
