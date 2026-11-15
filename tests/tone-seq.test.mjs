// 多音节声调回归测试：序列解析、CSV 导入导出的行列报错、逐音节判分与显示。
// 运行：node tests/tone-seq.test.mjs
// 隔离性：只在 node 进程内的 fake-indexeddb（内存实现）里加载模块和读写词条，进程退出即消失，
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
const tones = await server.ssrLoadModule('/src/lib/tones.ts');
const utils = await server.ssrLoadModule('/src/lib/utils.ts');
const vocab = await server.ssrLoadModule('/src/db/vocabulary.ts');
const training = await server.ssrLoadModule('/src/pages/tone-training.ts');
// 词库表单页：只取它导出的纯规则函数，不构造 DOM。
const vocabPage = await server.ssrLoadModule('/src/pages/vocabulary.ts');
await server.close();

const { TONES, parseToneSeq, normalizeToneSeq, toneSeqToStorage, toneSeqZh, MAX_TONE_SYLLABLES } = tones;
const { toneTagsHtml } = utils;
const { parseCSV, exportWordsToCSV, addWord, updateWord, getAllWords } = vocab;
const { gradeToneSeq, toneSyllableHints } = training;
const { canAddToneSyllable, validateToneSlots, toneOptionLabel,
  csvSpecHeader, csvSpecExample, csvAgentSpec } = vocabPage;

const results = [];
let failed = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed++;
}
const json = (v) => JSON.stringify(v);
const eq = (a, b) => json(a) === json(b);

// ---------- 1. 序列解析：分隔写法与旧标签 ----------
const seqCases = [
  ['mid-high', ['mid', 'high']],
  ['平-高', ['mid', 'high']],
  ['falling-high', ['falling', 'high']],
  ['low-low-mid', ['low', 'low', 'mid']],
  ['mid/high', ['mid', 'high']],
  ['mid / high', ['mid', 'high']],
  ['mid→high', ['mid', 'high']],
  ['中平 → 低调', ['mid', 'low']],
  ['falling high', ['falling', 'high']],
  ['mid_high', ['mid', 'high']],
  ['mid、高', ['mid', 'high']],
  [' mid - high ', ['mid', 'high']],
  // 单值旧数据天然是长度为 1 的序列
  ['low', ['low']],
  ['低', ['low']],
  ['高升', ['high']],
  ['MID', ['mid']],
];
for (const [raw, expected] of seqCases) {
  check(`解析 ${json(raw)} → ${json(expected)}`, eq(normalizeToneSeq(raw), expected),
    `实际 ${json(normalizeToneSeq(raw))}`);
}
check('数组入参同样按顺序解析', eq(normalizeToneSeq(['low', 'low', 'mid']), ['low', 'low', 'mid']),
  json(normalizeToneSeq(['low', 'low', 'mid'])));
check('数组入参也认旧标签', eq(normalizeToneSeq(['平', '高']), ['mid', 'high']), json(normalizeToneSeq(['平', '高'])));
check('空值/未标注写法解析为空序列',
  ['', '无', 'none', '-', '—', 'unknown', 'n/a', '   ', null, undefined].every(v => normalizeToneSeq(v).length === 0));

// ---------- 2. 异常项定位：哪一项、原文是什么 ----------
{
  const r = parseToneSeq('mid-超');
  check('部分非法：合法项不入库（整行按异常处理）', eq(r.tones, ['mid']) && r.invalid.length === 1, json(r));
  check('部分非法：报出第 2 个音节及其原文',
    eq(r.invalid[0], { index: 2, value: '超' }), json(r.invalid));
}
{
  const r = parseToneSeq('也许-high-嗯');
  check('多个非法项：逐一报出序号与原文',
    eq(r.invalid, [{ index: 1, value: '也许' }, { index: 3, value: '嗯' }]), json(r.invalid));
  check('多个非法项：合法项仍按原顺序保留', eq(r.tones, ['high']), json(r.tones));
}
check('单值非法仍按第 1 个音节上报', eq(parseToneSeq('也许').invalid, [{ index: 1, value: '也许' }]),
  json(parseToneSeq('也许')));

// ---------- 3. 存储与文案 ----------
check('存储一律用 - 连接', toneSeqToStorage(['mid', 'high']) === 'mid-high');
check('存储单值不带分隔符', toneSeqToStorage(['low']) === 'low');
check('存储空序列为空串', toneSeqToStorage([]) === '');
check('中文文案按顺序带箭头', toneSeqZh('mid-high') === '中平调 → 高调', json(toneSeqZh('mid-high')));
check('旧中文标签也能读出中文文案', toneSeqZh('平-高') === '中平调 → 高调', json(toneSeqZh('平-高')));
check('单音节文案不带箭头', toneSeqZh('低') === '低调', json(toneSeqZh('低')));
check('认不出的值不猜声调，返回空串', toneSeqZh('也许') === '' && toneSeqZh('') === '');
check(`音节上限常量为 ${MAX_TONE_SYLLABLES}`, MAX_TONE_SYLLABLES === 4, `实际 ${MAX_TONE_SYLLABLES}`);

// ---------- 4. 卡片/详情渲染：一个音节一枚标签 ----------
{
  const html = toneTagsHtml('mid-high');
  const tagCount = (html.match(/class="tag tag-tone"/g) ?? []).length;
  check('双音节渲染两枚标签', tagCount === 2, json(html));
  check('标签顺序与音节顺序一致', html.indexOf('中平调') < html.indexOf('高调'), json(html));
  check('标签之间有连接箭头', (html.match(/tone-seq-arrow/g) ?? []).length === 1, json(html));
}
{
  const html = toneTagsHtml('low-low-mid');
  check('三音节渲染三枚标签', (html.match(/class="tag tag-tone"/g) ?? []).length === 3, json(html));
}
check('单音节仍渲染一枚标签且无箭头',
  toneTagsHtml('low') === '<span class="tone-seq"><span class="tag tag-tone">低调</span></span>',
  json(toneTagsHtml('low')));
check('withSymbol 追加 IPA 调值', toneTagsHtml('low', true).includes('˨˩'), json(toneTagsHtml('low', true)));
check('未标注渲染为空串', toneTagsHtml('') === '' && toneTagsHtml('也许') === '');
check('历史超上限数据不裁剪，原样逐音节显示',
  (toneTagsHtml('mid-mid-mid-mid-mid').match(/class="tag tag-tone"/g) ?? []).length === 5,
  json(toneTagsHtml('mid-mid-mid-mid-mid')));

// ---------- 5. CSV 导入：多音节按顺序收下 ----------
function importRows(...toneCells) {
  const body = toneCells.map((t, i) => `w${i + 1},释义${i + 1},${t}`).join('\n');
  return parseCSV(`泰文,中文,声调\n${body}\n`);
}
{
  const r = importRows('mid-high', '平-高', 'falling high', 'mid/high', 'mid→high');
  check('CSV 声调列接受多种多音节写法', r.skipped.length === 0 && r.words.length === 5, json(r.skipped));
  check('CSV 声调列统一按 - 存储',
    eq(r.words.map(w => w.toneMark), ['mid-high', 'mid-high', 'falling-high', 'mid-high', 'mid-high']),
    json(r.words.map(w => w.toneMark)));
}
{
  const r = importRows('low-low-mid');
  check('CSV 三音节按顺序存储', r.words[0]?.toneMark === 'low-low-mid', json(r.words[0]?.toneMark));
}
{
  const r = importRows('low', '低', '高升', '-', '无', '');
  check('单音节旧数据导入结果不变',
    r.skipped.length === 0 && eq(r.words.map(w => w.toneMark), ['low', 'low', 'high', '', '', '']),
    json(r.words.map(w => w.toneMark)));
}
{
  const r = importRows('mid-mid-mid-mid');
  check(`恰好 ${MAX_TONE_SYLLABLES} 个音节可以导入`, r.skipped.length === 0 && r.words[0].toneMark === 'mid-mid-mid-mid', json(r));
}

// ---------- 6. CSV 导入报错：行 / 列 / 原因 ----------
{
  const r = parseCSV('泰文,中文,声调\nมา,来,mid-超\nได้,可以,mid\n');
  check('非法音节：整行不导入，正常行不受影响',
    r.words.length === 1 && r.words[0].thai === 'ได้' && r.skipped.length === 1, json(r));
  const s = r.skipped[0];
  check('非法音节：报出行号', s?.line === 2, json(s));
  check('非法音节：报出列名', s?.column === '声调', json(s));
  check('非法音节：报出第几个音节与原文',
    /第 2 个音节「超」无法识别/.test(s?.reason ?? ''), json(s?.reason));
  check('非法音节：说明总音节数', /共 2 个音节/.test(s?.reason ?? ''), json(s?.reason));
  check('非法音节：给出可填格式', /mid \/ low \/ falling \/ high \/ rising/.test(s?.reason ?? ''), json(s?.reason));
  check('非法音节：保留整行原文', (s?.raw ?? '') === 'มา,来,mid-超', json(s?.raw));
}
{
  const r = importRows('mid-mid-mid-mid-mid');
  check('超出音节上限：整行不导入', r.words.length === 0 && r.skipped.length === 1, json(r));
  check('超出音节上限：原因写明实际个数与上限',
    /写了 5 个音节，最多 4 个/.test(r.skipped[0]?.reason ?? ''), json(r.skipped[0]?.reason));
  check('超出音节上限：定位到声调列', r.skipped[0]?.column === '声调' && r.skipped[0]?.line === 2, json(r.skipped[0]));
}
{
  const r = parseCSV('泰文,中文,声调,词性\n,来,low,动词\nได้,可以,mid,动词\n');
  check('缺泰文：报出行列与原因',
    r.skipped.length === 1 && r.skipped[0].line === 2 && r.skipped[0].column === '泰文' && /泰文列为空/.test(r.skipped[0].reason),
    json(r.skipped));
}
{
  const r = parseCSV('泰文,中文,声调\nมา,来\n');
  check('列数少于表头：仍报列数问题', r.skipped.length === 1 && /列数与表头不符/.test(r.skipped[0].reason), json(r.skipped));
}
{
  const r = parseCSV('#中文,泰文,声调\n你好,สวัสดี,平-高\n');
  check('乱序表头：按列名取声调，报错也报真实列名',
    r.words.length === 1 && r.words[0].toneMark === 'mid-high', json(r));
  const bad = parseCSV('#中文,泰文,声调\n你好,สวัสดี,平-也许\n');
  check('乱序表头：非法音节报的是声调列而不是默认列位',
    bad.skipped.length === 1 && bad.skipped[0].column === '声调' && /第 2 个音节「也许」/.test(bad.skipped[0].reason),
    json(bad.skipped));
}

// ---------- 7. CSV 导出：多音节用 - 连接且可回读 ----------
function word(o) {
  return {
    thai: '', meaning: '', toneMark: '', pos: '', example: '', note: '', tags: [],
    romanization: '', exampleRoman: '', exampleMeaning: '',
    id: 1, createdAt: 1, updatedAt: 1, ...o,
  };
}
{
  const csv = exportWordsToCSV([word({ thai: 'สวัสดี', meaning: '你好', toneMark: 'low-low-mid' })]);
  check('导出声调列用 - 连接', csv.split('\n')[1].split(',')[2] === 'low-low-mid', json(csv));
  const back = parseCSV(csv);
  check('导出的多音节文件可原样回读',
    back.words.length === 1 && back.words[0].toneMark === 'low-low-mid' && back.skipped.length === 0, json(back));
}
{
  const csv = exportWordsToCSV([word({ thai: 'มา', meaning: '来', toneMark: '低' })]);
  check('导出把旧中文标签写成 canonical id', csv.split('\n')[1].split(',')[2] === 'low', json(csv));
  check('旧标签导出后回读结果一致', parseCSV(csv).words[0]?.toneMark === 'low', json(parseCSV(csv).words[0]));
}
{
  const csv = exportWordsToCSV([word({ thai: '-x', meaning: '历史脏值', toneMark: '也许' })]);
  check('认不出的历史脏值原样带出，导出不替用户丢标注',
    csv.split('\n')[1].includes('也许'), json(csv));
}
{
  const words = [
    word({ id: 1, thai: 'a', meaning: '甲', toneMark: 'mid' }),
    word({ id: 2, thai: 'b', meaning: '乙', toneMark: 'mid-high' }),
    word({ id: 3, thai: 'c', meaning: '丙', toneMark: '' }),
    word({ id: 4, thai: 'd', meaning: '丁', toneMark: 'falling-rising-low-high' }),
  ];
  const back = parseCSV(exportWordsToCSV(words));
  check('混合单/多音节导出→导入逐条一致',
    back.skipped.length === 0 && eq(back.words.map(w => w.toneMark), words.map(w => w.toneMark)),
    json(back.words.map(w => w.toneMark)));
}
{
  // 声调与语气词的性别/礼貌用法是两个独立属性，解析声调不得动释义。
  const r = parseCSV('#泰文,中文,声调,备注\n"คะ","语气词（问句,女性用）",high,"陈述和请求句尾用 ค่ะ"\n');
  check('声调解析不影响性别/礼貌释义',
    r.words.length === 1 && r.words[0].meaning === '语气词（问句,女性用）' && r.words[0].toneMark === 'high'
    && r.words[0].note === '陈述和请求句尾用 ค่ะ', json(r));
}

// ---------- 8. 声调训练：逐音节判分 ----------
{
  const v = gradeToneSeq(['mid', 'high'], ['mid', 'high']);
  check('全对：逐音节都判正确', v.every(x => x.correct) && eq(v.map(x => x.index), [1, 2]), json(v));
}
{
  const v = gradeToneSeq(['mid', 'high'], ['mid', 'low']);
  check('第二个音节答错：只有第 2 项判错',
    v[0].correct === true && v[1].correct === false, json(v));
  check('答错的音节保留正确答案与所选答案',
    v[1].answer === 'high' && v[1].picked === 'low', json(v[1]));
}
{
  const v = gradeToneSeq(['low', 'falling'], ['low']);
  check('未作答的音节判错而不是判空通过',
    v[1].correct === false && v[1].picked === null, json(v[1]));
}
check('单音节判分与旧行为一致',
  gradeToneSeq(['falling'], ['falling'])[0].correct === true && gradeToneSeq(['falling'], ['high'])[0].correct === false);
check('四音节逐音节独立判定',
  eq(gradeToneSeq(['low', 'low', 'mid', 'high'], ['low', 'mid', 'low', 'high']).map(x => x.correct), [true, false, false, true]),
  json(gradeToneSeq(['low', 'low', 'mid', 'high'], ['low', 'mid', 'low', 'high'])));

// ---------- 9. 声调训练：罗马音音节提示 ----------
check('罗马音段数与音节数一致时按段给出提示',
  eq(toneSyllableHints('sà-wàt-dii', 3), ['sà', 'wàt', 'dii']), json(toneSyllableHints('sà-wàt-dii', 3)));
check('罗马音段数对不上时不提示（宁缺勿错）',
  toneSyllableHints('sà-wàt-dii', 2) === null && toneSyllableHints('gin', 2) === null);
check('单音节罗马音提示正常', eq(toneSyllableHints('gin', 1), ['gin']), json(toneSyllableHints('gin', 1)));
check('缺罗马音时不提示', toneSyllableHints('', 1) === null && toneSyllableHints(undefined, 1) === null);

// ---------- 10. 词库表单：音节上限（D1） ----------
const MAX = MAX_TONE_SYLLABLES;
const FIVE = ['mid', 'low', 'falling', 'high', 'rising'];
check('只有一行时可以添加', canAddToneSyllable(['']) === true);
check(`已有 ${MAX} 行时禁止添加`, canAddToneSyllable(FIVE.slice(0, MAX)) === false);
check('空行也占额度：一实三空不能再加（旧版绕过路径）', canAddToneSyllable(['mid', '', '', '']) === false);
check('整组空行同样不能加', canAddToneSyllable(['', '', '', '']) === false);
check('历史超长数据不能继续加行', canAddToneSyllable(FIVE) === false);
{
  // 按钮处理函数就是「canAddToneSyllable 放行才 push」，这里按同一规则连点 20 次。
  const slots = [''];
  for (let i = 0; i < 20; i++) if (canAddToneSyllable(slots)) slots.push('');
  check(`连点 20 次最多 ${MAX} 行`, slots.length === MAX, json(slots));
}
{
  const slots = FIVE.slice(0, MAX);
  slots.splice(3, 1);
  const freed = canAddToneSyllable(slots);
  if (canAddToneSyllable(slots)) slots.push('');
  check('删除一行释放额度，补回后仍不越界',
    freed === true && slots.length === MAX && canAddToneSyllable(slots) === false, json(slots));
}

// ---------- 11. 词库表单：保存校验与 1–4 音节读写 ----------
{
  const msg5 = validateToneSlots(FIVE) ?? '';
  check('5 行拒绝保存并报出当前行数', msg5.includes(String(MAX)) && msg5.includes('当前有 5 行'), msg5);
  const msg7 = validateToneSlots(['mid', 'low', 'falling', 'high', 'rising', 'mid', 'low']) ?? '';
  check('历史 7 行数据同样拒绝保存', msg7.includes('当前有 7 行'), msg7);
  check('1–4 音节正常保存全部放行', [1, 2, 3, 4].every(n => validateToneSlots(FIVE.slice(0, n)) === null));
  check('尾部空行视为未标注，允许保存', validateToneSlots(['mid', 'low', '']) === null);
  check('整组空行（不标注）允许保存', validateToneSlots(['', '', '', '']) === null);
  check('中间空行拒绝保存并指出行号', (validateToneSlots(['mid', '', 'high']) ?? '').includes('第 2 个音节'));
}
{
  // 新增→编辑→重开整条链路，读写都落在内存库里，用的就是表单那三个函数。
  const ids = [];
  for (let n = 1; n <= MAX; n++) {
    const slots = FIVE.slice(0, n);
    const err = validateToneSlots(slots);
    if (err) { check(`${n} 音节不该被拦截`, false, err); continue; }
    ids.push(await addWord({
      thai: `เทส${n}`, meaning: `${n} 音节`, toneMark: toneSeqToStorage(slots),
      romanization: '', pos: '', example: '', exampleRoman: '', exampleMeaning: '', note: '', tags: [],
    }));
  }
  const stored = await getAllWords();
  const byId = new Map(stored.map(x => [x.id, x]));
  check('1–4 音节新增逐条按顺序落库',
    ids.length === MAX && [1, 2, 3, 4].every(n => eq(normalizeToneSeq(byId.get(ids[n - 1]).toneMark), FIVE.slice(0, n))),
    json(ids.map(id => byId.get(id)?.toneMark)));
  const editedSeq = ['rising', 'high', 'low', 'mid'];
  await updateWord(ids[MAX - 1], { toneMark: toneSeqToStorage(editedSeq) });
  const reopened = normalizeToneSeq((await getAllWords()).find(x => x.id === ids[MAX - 1]).toneMark);
  check('编辑 4 音节按新顺序保存', eq(reopened, editedSeq), json(reopened));
  check('重开表单仍是 4 行且加不动', reopened.length === MAX && canAddToneSyllable(reopened) === false, json(reopened));
  const back = parseCSV(exportWordsToCSV([word({ thai: 'เทส', meaning: '四音节', toneMark: toneSeqToStorage(editedSeq) })]));
  check('4 音节导出→导入闭环不变',
    back.skipped.length === 0 && back.words[0]?.toneMark === 'rising-high-low-mid', json(back));
  const tooLong = parseCSV('泰文,中文,声调\nเทส,五音节,mid-low-high-rising-mid\n');
  check('CSV 超上限的导入报错规则不变',
    tooLong.words.length === 0 && json(tooLong.skipped).includes(`最多 ${MAX} 个`), json(tooLong.skipped));
}

// ---------- 12. 声调下拉文案（D2） ----------
{
  const labels = TONES.map(toneOptionLabel);
  check('文案为「编号. 中文调名 英文调名」',
    eq(labels, ['1. 中平调 Mid', '2. 低调 Low', '3. 降调 Falling', '4. 高调 High', '5. 升调 Rising']), json(labels));
  check('文案去掉泰文声调类与括号说明',
    TONES.every((t, i) => !labels[i].includes('(') && !labels[i].includes('（') && !labels[i].includes(t.thai)), json(labels));
  check('文案比旧写法短（旧写法在窄屏会裁掉调名）',
    TONES.every((t, i) => labels[i].length < `${t.num}. ${t.zh} · ${t.thai} (${t.en})`.length), json(labels));
  check('五种调名齐全且各自带英文调名',
    new Set(labels).size === 5 && TONES.every(t => labels.some(l => l.includes(t.zh) && l.includes(t.en))));
}

// ---------- 13. CSV 自动生成规范：说明必须与解析器同口径 ----------
{
  const header = csvSpecHeader();
  const cols = header.split(',');
  const exportedHeader = exportWordsToCSV([word({ thai: 'ก', meaning: '甲', toneMark: 'mid' })]).split('\n')[0];
  check('说明表头与导出器表头逐字相同', exportedHeader === `#${header}`, `${exportedHeader} != ${header}`);
  check('说明表头列数与导出列数一致', cols.length === exportedHeader.slice(1).split(',').length, String(cols.length));
  check('说明表头同时含泰文与中文', cols[0] === '泰文' && cols[1] === '中文', header);

  // 示例是页面上「可直接粘贴导入」的那段，必须真的能整份导入。
  const example = parseCSV(csvSpecExample());
  check('示例每一行都能导入，零跳过',
    example.words.length === csvSpecExample().split('\n').length - 1 && example.skipped.length === 0, json(example));
  check('示例每行字段数等于表头列数',
    csvSpecExample().split('\n').slice(1).every(l => l.split(',').length === cols.length), csvSpecExample());
  check('示例声调都在上限内且只用 canonical id', example.words.every(w => {
    const seq = normalizeToneSeq(w.toneMark);
    return seq.length <= MAX && seq.join('-') === w.toneMark && w.toneMark.split('-').every(x => x === '' || TONES.some(t => t.id === x));
  }), json(example.words.map(w => w.toneMark)));
  check('示例演示了「不确定就留空」', example.words.some(w => w.toneMark === ''), json(example.words.map(w => w.toneMark)));

  // 说明里两条最容易踩的规矩，用解析器的真实报错反证：少一列、超上限都必须整行拒收。
  const fullRow = csvSpecExample().split('\n')[1];
  const shortCsv = parseCSV(`${header}\n${fullRow.slice(0, fullRow.lastIndexOf(','))}\n`);
  check('说明「字段数必须等于列数」= 解析器真拒收少列的行',
    shortCsv.words.length === 0 && json(shortCsv.skipped).includes('列数与表头不符'), json(shortCsv.skipped));
  const overToneCsv = parseCSV(`${header}\nเทส,测试,${'mid-'.repeat(MAX)}mid${','.repeat(cols.length - 3)}\n`);
  check('说明「最多 4 个音节」= 解析器真拒收超上限的行',
    overToneCsv.words.length === 0 && json(overToneCsv.skipped).includes(`最多 ${MAX} 个`), json(overToneCsv.skipped));
  const twoCol = parseCSV('เทส,测试\n');
  check('说明的简版路径属实：无表头、只写泰文中文也能导入',
    twoCol.words.length === 1 && twoCol.skipped.length === 0, json(twoCol));

  const spec = csvAgentSpec();
  const specLine = (key) => spec.split('\n').find(l => l.includes(key)) ?? `(缺少含「${key}」的行)`;
  const toneLine = specLine('只写 canonical ID');
  check('Agent 指令给出真实表头与列数',
    spec.includes(header) && spec.includes(`${cols.length} 个`), specLine('字段数必须等于表头列数'));
  check('Agent 指令只用 5 个 canonical id 并禁止中文调名',
    TONES.every(t => toneLine.includes(`${t.id}（${t.zh}）`)) && toneLine.includes('不要写中文声调名'), toneLine);
  check('Agent 指令要求半角连字符与音节顺序',
    spec.includes('半角连字符 -') && spec.includes('按单词实际发音的音节顺序'), specLine('半角连字符'));
  check('Agent 指令写明音节上限', spec.includes(`最多 ${MAX} 个音节`), specLine('个音节'));
  check('Agent 指令要求不确定声调与罗马音留空、不许推导',
    spec.includes('不确定的声调一律留空') && spec.includes('罗马音只在确定时填写') && spec.includes('不允许猜测'),
    `${specLine('不确定的声调')} / ${specLine('罗马音')}`);
  check('Agent 指令含输出前自检（字段数/转义/声调 id/音节数）',
    spec.includes('字段数') && spec.includes('转义') && spec.includes('canonical ID') && spec.includes('音节数'),
    specLine('输出前自检'));
  check('Agent 指令只要求输出规范数据，且自带可对照示例',
    spec.includes('只输出符合本规范的 CSV 本体') && spec.includes(csvSpecExample()) && !spec.includes('```'),
    specLine('只输出'));
}

// ---------- 输出 ----------
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n        ${r.detail}`}`);
}
console.log(`\n共 ${results.length} 项，通过 ${results.length - failed} 项，失败 ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
