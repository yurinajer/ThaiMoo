// 中译泰默写回归测试：提交门槛、提交前不泄露答案、提交后展示正确答案与转义。
// 运行：node tests/review-dictation.test.mjs
// 隔离性：只在 node 进程内的 fake-indexeddb（内存实现）里加载模块，进程退出即消失，
// 不会接触浏览器里的 ThaiLearnDB、本地学习数据或线上数据。
import 'fake-indexeddb/auto';
import { createServer } from 'vite';

// escapeHtml 走的是浏览器的 textContent→innerHTML 语义（只转义 & < >），
// node 里没有 document，用同样语义的最小替身，避免测试自己发明一套转义规则。
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
globalThis.document = {
  createElement: () => {
    let text = '';
    return {
      set textContent(value) { text = String(value); },
      get innerHTML() { return text.replace(/[&<>]/g, ch => ENTITIES[ch]); },
    };
  },
};

const server = await createServer({
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
});
// 复习页：只取它导出的纯函数，不构造 DOM、不启动复习会话。
const reviewPage = await server.ssrLoadModule('/src/pages/review.ts');
await server.close();

const { canSubmitDictation, dictationCardHtml, dictationRevealHtml } = reviewPage;

const results = [];
let failed = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed++;
}

const word = {
  id: 1,
  thai: 'สวัสดี',
  romanization: 'sà-wàt-dii',
  meaning: '你好',
  pos: '感叹词',
  toneMark: 'low-low',
  example: 'สวัสดีครับ',
  exampleRoman: '',
  exampleMeaning: '',
  note: '',
};

// ---------- 1. 提交门槛：空与纯空白不允许提交 ----------
for (const empty of ['', ' ', '   ', '\t', '\n', ' \t\n ']) {
  check(`空输入 ${JSON.stringify(empty)} 不允许提交`, canSubmitDictation(empty) === false);
}
check('泰文输入允许提交', canSubmitDictation('ก') === true);
check('前后带空格的泰文输入允许提交', canSubmitDictation('  สวัสดี  ') === true);
check('任意非空文本都允许提交（不自动判拼写）', canSubmitDictation('hello') === true);

// ---------- 2. 提交前卡片：只有中文，绝不出现泰文答案 ----------
{
  const html = dictationCardHtml(word);
  check('卡片显示中文释义', html.includes('你好'));
  check('卡片显示词性', html.includes('感叹词'));
  check('卡片不含泰文答案', !html.includes(word.thai));
  check('卡片不含罗马音', !html.includes(word.romanization));
  check('卡片不含例句', !html.includes(word.example));
  check('卡片不含声调标签', !html.includes('tag-tone'));
  check('提供泰文输入框（lang=th）', html.includes('id="dictation-input"') && html.includes('lang="th"'));
  check('输入框关闭自动更正/大写/拼写检查',
    html.includes('autocomplete="off"') && html.includes('autocapitalize="off"')
    && html.includes('autocorrect="off"') && html.includes('spellcheck="false"'));
  check('提交按钮初始为禁用（空输入不可提交）',
    /id="btn-submit-dictation"[^>]*disabled/.test(html));
  check('提交按钮文案为「提交答案」', html.includes('提交答案'));
  check('答案展示区初始隐藏', /id="dictation-reveal"[^>]*style="display:none;"/.test(html));
  check('「你的答案」标签初始隐藏', /id="dictation-user-label"[^>]*style="display:none;"/.test(html));
}

// ---------- 3. 提交后展示：正确泰文 + 罗马音 + 声调 + 例句 ----------
{
  const html = dictationRevealHtml(word);
  check('展示正确泰文', html.includes(word.thai));
  check('展示罗马音', html.includes(word.romanization));
  check('展示逐音节声调标签', html.includes('tag-tone') && html.includes('低调'));
  check('展示泰文例句', html.includes(word.example));
  check('提示用户自行评分', html.includes('自行评分'));
  check('标注「正确答案」', html.includes('正确答案'));
}

// ---------- 4. 可选字段缺失时不产生空节点 ----------
{
  const bare = { id: 2, thai: 'กิน', meaning: '吃', toneMark: '' };
  const cardHtml = dictationCardHtml(bare);
  const revealHtml = dictationRevealHtml(bare);
  check('无词性时卡片不渲染词性节点', !cardHtml.includes('dictation-pos'));
  check('无罗马音时不渲染 card-roman', !revealHtml.includes('card-roman'));
  check('无声调时不渲染声调标签', !revealHtml.includes('tag-tone'));
  check('无例句时不渲染例句', !revealHtml.includes('font-family:var(--font-thai); margin-top:8px'));
  check('仅有泰文与释义也能正常展示答案', revealHtml.includes('กิน'));
}

// ---------- 5. 转义：词条内容按 HTML 注入处理 ----------
{
  const evil = {
    id: 3,
    thai: '<img src=x onerror=alert(1)>',
    meaning: '<b>你好</b>&<i>再见</i>',
    pos: '<script>alert(2)</script>',
    toneMark: '',
    example: '<iframe></iframe>',
  };
  const cardHtml = dictationCardHtml(evil);
  const revealHtml = dictationRevealHtml(evil);
  check('释义中的标签被转义', cardHtml.includes('&lt;b&gt;') && !cardHtml.includes('<b>你好'));
  check('词性中的 script 被转义', !cardHtml.includes('<script>'));
  check('泰文答案中的标签被转义', !revealHtml.includes('<img src=x'));
  check('例句中的 iframe 被转义', !revealHtml.includes('<iframe>'));
}

// ---------- 汇总 ----------
console.log(`\n中译泰默写回归：${results.length} 项检查，失败 ${failed} 项`);
for (const r of results) {
  if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}
if (failed > 0) process.exit(1);
console.log('全部通过 ✓');