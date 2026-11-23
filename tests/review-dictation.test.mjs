// 中译泰默写回归测试：默写改成可选后的正面/背面内容、提交门槛、答案不提前泄露、转义；
// 外加朗读小喇叭的回归（跟读入口已删除、录音数据层保留、喇叭不翻卡、热区与避让）。
// 运行：node tests/review-dictation.test.mjs
// 隔离性：只在 node 进程内的 fake-indexeddb（内存实现）里加载模块，进程退出即消失，
// 不会接触浏览器里的 ThaiLearnDB、本地学习数据或线上数据。
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
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

const { canSubmitDictation, dictationQuestionHtml, dictationAnswerHtml } = reviewPage;

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

// ---------- 2. 正面（题干面）：只有中文，绝不出现泰文答案 ----------
{
  const html = dictationQuestionHtml(word);
  check('正面显示中文释义', html.includes('你好'));
  check('正面显示词性', html.includes('感叹词'));
  check('正面不含泰文答案', !html.includes(word.thai));
  check('正面不含罗马音', !html.includes(word.romanization));
  check('正面不含例句', !html.includes(word.example));
  check('正面不含声调标签', !html.includes('tag-tone'));
  check('正面不含「你的答案」「正确答案」字样', !html.includes('你的答案') && !html.includes('正确答案'));
  check('提供「默写」入口按钮', /id="btn-dictation-toggle"[^>]*>默写</.test(html));
  check('默写入口默认收起（aria-expanded=false）', /id="btn-dictation-toggle"[^>]*aria-expanded="false"/.test(html));
  check('默写区默认收起（panel 带 hidden）', /id="dictation-panel"[^>]*\shidden/.test(html));
  check('提供泰文输入框（lang=th）', html.includes('id="dictation-input"') && html.includes('lang="th"'));
  check('输入框关闭自动更正/大写/拼写检查',
    html.includes('autocomplete="off"') && html.includes('autocapitalize="off"')
    && html.includes('autocorrect="off"') && html.includes('spellcheck="false"'));
  check('提交按钮初始为禁用（空输入不可提交）',
    /id="btn-submit-dictation"[^>]*disabled/.test(html));
  check('提交按钮文案为「提交答案」', html.includes('提交答案'));
  check('正面提示可以直接翻卡看答案', html.includes('翻转'));
}

// ---------- 3. 背面（答案面）：泰文 + 罗马音 + 声调 + 详情，默写对照区默认隐藏 ----------
{
  const html = dictationAnswerHtml(word);
  check('展示正确泰文', html.includes(word.thai));
  check('展示罗马音', html.includes(word.romanization));
  check('展示逐音节声调标签', html.includes('tag-tone') && html.includes('低调'));
  check('展示泰文例句', html.includes(word.example));
  check('标注「正确答案」', html.includes('正确答案'));
  check('「你的答案」标签初始隐藏', /id="dictation-user-label"[^>]*style="display:none;"/.test(html));
  check('「你的答案」内容区初始隐藏且为空', /id="dictation-user-answer"[^>]*style="display:none;"><\/div>/.test(html));
  check('评分提示初始隐藏', /id="dictation-score-hint"[^>]*style="display:none;"/.test(html));
  check('答案面不含喇叭（喇叭在卡盒右上角，由 JS 控制显隐）', !html.includes('card-speak'));
  check('答案面提示可翻回中文', html.includes('翻回中文'));
}

// ---------- 3b. 答案面与泰→中 共用同一套详情字段 ----------
{
  const full = { ...word, exampleRoman: 'sà-wàt-dii khráp', exampleMeaning: '你好（男生说的）', note: '用于见面打招呼' };
  const back = dictationAnswerHtml(full);
  check('答案面展示例句罗马音', back.includes(full.exampleRoman));
  check('答案面展示例句释义', back.includes(full.exampleMeaning));
  check('答案面展示备注', back.includes('用于见面打招呼'));
  check('正面不受详情字段影响，仍然不含例句罗马音', !dictationQuestionHtml(full).includes(full.exampleRoman));
  const reviewSrcForReuse = readFileSync(new URL('../src/pages/review.ts', import.meta.url), 'utf8');
  check('泰文侧（泰→中 正面与中→泰 背面）复用同一个题面构造',
    (reviewSrcForReuse.match(/thaiFaceHtml\(/g) || []).length >= 3);
  check('两个方向的详情区复用同一段构造，不各写一套',
    (reviewSrcForReuse.match(/wordDetailsHtml\(/g) || []).length >= 3);
}

// ---------- 4. 可选字段缺失时不产生空节点 ----------
{
  const bare = { id: 2, thai: 'กิน', meaning: '吃', toneMark: '' };
  const questionHtml = dictationQuestionHtml(bare);
  const answerHtml = dictationAnswerHtml(bare);
  check('无词性时正面不渲染词性节点', !questionHtml.includes('dictation-pos'));
  check('无罗马音时不渲染 card-roman', !answerHtml.includes('card-roman'));
  check('无声调时不渲染声调标签', !answerHtml.includes('tag-tone'));
  check('无例句时不渲染例句', !answerHtml.includes('font-family:var(--font-thai); margin-top:8px'));
  check('无备注时不渲染备注', !answerHtml.includes('📝'));
  check('仅有泰文与释义也能正常展示答案', answerHtml.includes('กิน'));
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
    exampleRoman: '<svg onload=alert(3)>',
    exampleMeaning: '<a href=javascript:alert(4)>link</a>',
    note: '<style>body{display:none}</style>',
  };
  const questionHtml = dictationQuestionHtml(evil);
  const answerHtml = dictationAnswerHtml(evil);
  check('释义中的标签被转义', questionHtml.includes('&lt;b&gt;') && !questionHtml.includes('<b>你好'));
  check('词性中的 script 被转义', !questionHtml.includes('<script>'));
  check('泰文答案中的标签被转义', !answerHtml.includes('<img src=x'));
  check('例句中的 iframe 被转义', !answerHtml.includes('<iframe>'));
  check('例句罗马音被转义', !answerHtml.includes('<svg onload'));
  check('例句释义被转义', !answerHtml.includes('<a href=javascript'));
  check('备注被转义', !answerHtml.includes('<style>body'));
}

// ---------- 6. 朗读小喇叭：跟读入口删除，朗读本身保持原样 ----------
{
  const { existsSync } = await import('node:fs');
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
    /<button class="card-speak" type="button" aria-label="朗读该单词">/.test(speakSrc));
  check('喇叭图标是内联 SVG，不用 emoji', /<svg[^>]*aria-hidden="true"/.test(speakSrc) && !/🔊/.test(reviewSrc) && !/🔊/.test(detailSrc));

  // 中→泰：读音等于答案，所以喇叭要等答案面露出（翻卡或提交默写）才亮、才绑
  check('两种题型都在卡盒里渲染同一个喇叭',
    (reviewSrc.match(/speakButtonHtml\(\)/g) || []).length >= 2);
  check('默写正面与答案面都不内嵌喇叭', !dictationQuestionHtml(word).includes('card-speak')
    && !dictationAnswerHtml(word).includes('card-speak'));
  check('中→泰 开卡时先把喇叭藏起来', /speakBtn\.style\.display = 'none';/.test(reviewSrc));
  check('答案露出后才点亮并绑定喇叭',
    /const revealAnswer = \(\): void => \{[\s\S]*?speakBtn\.style\.display = '';[\s\S]*?bindSpeakButton\(card, item\.word\.thai\);/.test(reviewSrc));
  check('泰→中 保持原样：开卡即绑定喇叭',
    /if \(mode === 'thai-to-cn'\) \{\s*bindSpeakButton\(card, item\.word\.thai\);/.test(reviewSrc));

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

// ---------- 7. 交互规则：翻卡不靠默写，默写只是可选练习 ----------
{
  const src = rel => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');
  const css = src('styles/components.css');
  const reviewSrc = src('pages/review.ts');
  const speedSrc = src('pages/speedbrush.ts');

  // 旧的强制默写外壳彻底退役
  check('中→泰 不再套独立的默写卡外壳',
    !/className = 'dictation-card'/.test(reviewSrc) && !/id="dictation-card"/.test(reviewSrc));
  check('默写卡走公共翻卡外壳', /card\.className = 'flashcard review-card';/.test(reviewSrc));
  check('旧的 .dictation-reveal 卡片与样式一并退役',
    !/dictation-reveal/.test(reviewSrc) && !/\.dictation-reveal\b/.test(css));

  // 翻卡：两个方向共用一个监听，翻面判断里不含任何默写条件
  const flipHandler = (reviewSrc.match(/card\.addEventListener\('click', \(\) => \{[\s\S]*?\n    \}\);/) || [''])[0];
  check('翻卡监听只有一处，两种题型共用',
    (reviewSrc.match(/card\.addEventListener\('click'/g) || []).length === 1);
  check('翻卡处理器里不检查默写，翻面就露答案',
    flipHandler.includes('revealAnswer()') && !flipHandler.includes('canSubmitDictation'));

  // 露答案：六档按钮与评分状态只由「答案是否露出」驱动，而且只做一次
  const revealBody = (reviewSrc.match(/const revealAnswer = \(\): void => \{[\s\S]*?\n    \};/) || [''])[0];
  check('六档按钮出现只由答案露出驱动',
    revealBody.includes("fsrsButtons.style.display = 'grid'") && !revealBody.includes('canSubmitDictation'));
  check('答案露出只结算一次，重复翻面不重复绑喇叭', /if \(answerShown\) return;/.test(revealBody));

  // 可选默写：入口在正面，面板里的点击不冒泡成翻卡
  check('中→泰 标签文案写明默写只是可选项',
    /data-mode="cn-to-thai">中文 → 泰文 · 可选默写<\/button>/.test(reviewSrc));
  check('默写入口点击不冒泡，面板点击也不冒泡',
    /toggle\.addEventListener\('click', \(e\) => \{\s*e\.stopPropagation\(\);/.test(reviewSrc)
    && /panel\.addEventListener\('click', \(e\) => e\.stopPropagation\(\)\);/.test(reviewSrc));
  check('默写面板靠 hidden 收起', /panel\.hidden = !panel\.hidden;/.test(reviewSrc)
    && /#dictation-panel\[hidden\] \{\s*display: none;\s*\}/.test(css));
  check('入口文案随状态回显（已默写）', /toggle\.textContent = '已默写';/.test(reviewSrc));

  // 提交默写：写进「你的答案」再翻到答案面，全程不碰数据库
  const submitBody = (reviewSrc.match(/const submitAnswer = \(\) => \{[\s\S]*?\n      \};/) || [''])[0];
  check('提交默写只是本地翻面，不写库也不改排期',
    submitBody.length > 0
    && !/gradeReview|addErrorRecord|saveSpeedStatus|\bdb\./.test(submitBody)
    && !/await /.test(submitBody));
  check('提交后翻到答案面并露出评分按钮',
    /isFlipped = true;\s*card\.classList\.add\('flipped'\);\s*revealAnswer\(\);/.test(submitBody));
  check('提交后收起面板并把提交入口置灰，重复点击不会再走一遍提交流程',
    submitBody.includes('submitBtn.disabled = true;') && submitBody.includes('panel.hidden = true;'));
  check('「你的答案」用 textContent 写入，不拼 HTML',
    /userAnswer\.textContent = input\.value;/.test(reviewSrc) && !/userAnswer\.innerHTML/.test(reviewSrc));
  check('提交门槛仍然只挡默写本身',
    (reviewSrc.match(/canSubmitDictation\(input\.value\)/g) || []).length === 2);

  // 详情抽屉/速刷等既有入口不受本次改动波及
  check('速刷页没有引用复习页的默写构造', !/dictationQuestionHtml|dictationAnswerHtml|pages\/review/.test(speedSrc));
  check('卡面泰文长词按字符折行，不顶穿卡盒',
    /\.flashcard\.review-card \.thai-text-lg \{\s*overflow-wrap: anywhere;\s*\}/.test(css));
}

// ---------- 汇总 ----------
console.log(`\n中译泰默写回归：${results.length} 项检查，失败 ${failed} 项`);
for (const r of results) {
  if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}
if (failed > 0) process.exit(1);
console.log('全部通过 ✓');