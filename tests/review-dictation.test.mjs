// 中译泰默写回归测试：提交门槛、提交前不泄露答案、提交后展示正确答案与转义；
// 外加朗读小喇叭的回归（跟读入口已删除、录音数据层保留、喇叭不翻卡、热区与避让）。
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

// ---------- 6. 朗读小喇叭：跟读入口删除，朗读本身保持原样 ----------
{
  const { readFileSync, existsSync } = await import('node:fs');
  const src = rel => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');
  const css = src('styles/components.css');
  const reviewSrc = src('pages/review.ts');
  const detailSrc = src('components/word-detail.ts');
  const speakSrc = src('components/card-speak.ts');
  const speedSrc = src('pages/speedbrush.ts');
  const moreSrc = src('pages/more.ts');

  const hasFile = rel => existsSync(new URL(`../src/${rel}`, import.meta.url));

  // 跟读：入口和只服务于它的代码都没了
  check('跟读录音组件文件已删除', !hasFile('components/audio-bar.ts'));
  check('麦克风录音模块文件已删除', !hasFile('lib/recorder.ts'));
  check('复习页不再引用录音组件', !/audio-bar|mountAudioBar|recorder/i.test(reviewSrc));
  check('单词详情抽屉不再引用录音组件', !/audio-bar|mountAudioBar|recorder/i.test(detailSrc));
  check('两处界面文案里不再出现「跟读」', !reviewSrc.includes('跟读') && !detailSrc.includes('跟读'));
  check('朗读按钮文案不再出现在卡片里（只剩图标）', !reviewSrc.includes('>朗读<') && !reviewSrc.includes('ab-speak'));

  // 但录音数据层不能跟着删：表、备份、级联清理都保持原样
  check('voiceClips 数据层文件保留', hasFile('db/voiceClips.ts'));
  check('备份仍导出并恢复历史录音', /encodeClipsForBackup\(\)/.test(moreSrc) && /decodeClipsForRestore\(/.test(moreSrc));
  check('删词仍级联清理录音', /db\.voiceClips\.where\('wordId'\)/.test(src('db/vocabulary.ts')));

  // 朗读：仍是原先的 Web Speech 实现，只是换了触发方式
  check('喇叭组件继续用 lib/speech 的 speakThai', /from '..\/lib\/speech'/.test(speakSrc) && /speakThai\(thai,/.test(speakSrc));
  check('语音实现没有重写（仍是泰语 voice + rate 0.8）',
    /new SpeechSynthesisUtterance\(text\)/.test(src('lib/speech.ts')) && /utter\.rate = 0\.8/.test(src('lib/speech.ts')));
  check('复习页与详情抽屉共用同一个喇叭组件',
    /from '..\/components\/card-speak'/.test(reviewSrc) && /from '.\/card-speak'/.test(detailSrc));
  check('详情抽屉改用同款图标并绑定当前词条',
    /speakButtonHtml\(\)/.test(detailSrc) && /bindSpeakButton\(overlay, word\.thai\)/.test(detailSrc));
  check('详情抽屉不再有文字朗读按钮',
    !/btn-speak|detail-speak/.test(detailSrc) && !/🔊/.test(detailSrc) && !/>朗读</.test(detailSrc));
  // 速刷页的喇叭是后来单独裁定的功能：复用同一个组件，不另写一套语音。
  check('速刷页复用同一个喇叭组件',
    /from '..\/components\/card-speak'/.test(speedSrc)
    && /speakButtonHtml\(\)/.test(speedSrc) && /bindSpeakButton\(/.test(speedSrc));
  check('速刷卡的喇叭钉在卡盒右上角、顶部同样避让 60px',
    /\.flashcard \.card-speak \{[^}]*position: absolute/.test(css)
    && /\.flashcard\.speed-card \.flashcard-front,\s*\.flashcard\.speed-card \.flashcard-back \{[^}]*padding-top: 60px;/.test(css));

  // 触发方式：点图标只朗读，不翻卡
  check('喇叭点击先拦掉冒泡，不会翻卡', /e\.stopPropagation\(\)/.test(speakSrc));
  check('朗读失败只提示，不改卡片状态', /showError\(result\.reason \|\| '朗读失败'\)/.test(speakSrc));
  check('喇叭标记为可访问按钮',
    /<button class="card-speak" type="button" aria-label="朗读该单词">/.test(dictationRevealHtml(word)));
  check('喇叭图标是内联 SVG，不用 emoji', /<svg[^>]*aria-hidden="true"/.test(speakSrc) && !/🔊/.test(reviewSrc) && !/🔊/.test(detailSrc));

  // 默写模式：提交前不给读音，提交后喇叭跟答案一起出现
  check('提交前的默写卡片没有喇叭', !dictationCardHtml(word).includes('card-speak'));
  check('提交后的答案区有喇叭', dictationRevealHtml(word).includes('card-speak'));
  check('默写提交后才绑定喇叭', /bindSpeakButton\(reveal, item\.word\.thai\)/.test(reviewSrc));

  // 布局：按钮在卡片内部右侧，不是屏幕悬浮；热区够大且不压内容
  check('喇叭热区至少 44×44', /\.card-speak \{\s*display: inline-flex;[\s\S]*?width: 44px;\s*height: 44px;/.test(css));
  check('喇叭在卡片内部右上角', /\.flashcard \.card-speak \{[^}]*position: absolute;[^}]*right: var\(--spacing-sm\)/.test(css));
  check('卡片本身是定位容器', /\.flashcard \{\s*position: relative;\s*\}/.test(css));
  check('喇叭不使用屏幕固定悬浮', !/\.card-speak \{[^}]*position: (fixed|sticky)/.test(css) && !/position: fixed[^}]*card-speak/.test(css));
  check('卡面顶部避让，词条不被图标压住',
    /\.review-card \.flashcard-front,\s*\.review-card \.flashcard-back \{\s*padding-top: 60px;\s*\}/.test(css));
  check('翻转卡片盒随内容长高：两面同格堆叠，沿用速刷卡的做法',
    /\.flashcard\.review-card \.flashcard-inner \{\s*display: grid;\s*height: auto;\s*\}/.test(css)
    && /\.flashcard\.review-card \.flashcard-front,\s*\.flashcard\.review-card \.flashcard-back \{\s*position: relative;\s*grid-area: 1 \/ 1;\s*\}/.test(css));
  check('六档按钮只保留基础间距，不再为固定高度补硬编码偏移',
    !/\.review-card \+ \.fsrs-buttons/.test(css)
    && /\.fsrs-buttons \{[^}]*margin-top: var\(--spacing-lg\);\s*\}/.test(css));
  check('抽屉里的喇叭靠词头右上，长词换行不顶掉按钮',
    /\.detail-head \.card-speak \{[^}]*flex-shrink: 0/.test(css) && /\.detail-head-main \{\s*min-width: 0;\s*\}/.test(css));
  check('播放中有轻微状态反馈', /\.card-speak\.speaking \{/.test(css) && /classList\.add\('speaking'\)/.test(speakSrc) && /classList\.remove\('speaking'\)/.test(speakSrc));
  check('旧录音条样式已清理', !/\.audio-bar\b/.test(css) && !/\.clip-row\b/.test(css) && !/\.detail-speak\b/.test(css));
  check('恢复流程的文案不再提录音', !/跟读录音/.test(moreSrc) && !/clipNote/.test(moreSrc));

  // 复习页不因为这次改动多出任何写库路径
  check('朗读路径不碰数据库', !/\bdb\./.test(reviewSrc) && !/voiceClips|speedStatuses|reviewStates/.test(reviewSrc));
}

// ---------- 汇总 ----------
console.log(`\n中译泰默写回归：${results.length} 项检查，失败 ${failed} 项`);
for (const r of results) {
  if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}
if (failed > 0) process.exit(1);
console.log('全部通过 ✓');