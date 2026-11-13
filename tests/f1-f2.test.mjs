// F1（声调标签别名）+ F2（CSV 导入导出完整性）回归测试。
// 全部数据只存在于内存：不调用 addWord / importWords，不打开 Dexie，不写 IndexedDB。
// 运行：node tests/f1-f2.test.mjs
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true },
  // 只做 SSR 取模块，不需要依赖预构建，否则关闭服务时会给扫描器报无用错误。
  optimizeDeps: { noDiscovery: true, include: [] },
});
const { normalizeToneId } = await server.ssrLoadModule('/src/lib/tones.ts');
const { parseCSV, exportWordsToCSV } = await server.ssrLoadModule('/src/db/vocabulary.ts');
await server.close();

const results = [];
let failed = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed++;
}
const json = (v) => JSON.stringify(v);
const strip = (w) => {
  const { groupId, id, createdAt, updatedAt, ...rest } = w;
  return rest;
};
function word(o) {
  return {
    thai: '', meaning: '', toneMark: '', pos: '', example: '', note: '', tags: [],
    romanization: '', exampleRoman: '', exampleMeaning: '',
    id: 1, createdAt: 1, updatedAt: 1, ...o,
  };
}
function roundTrip(o) {
  const w = word(o);
  const csv = exportWordsToCSV([w]);
  const parsed = parseCSV(csv);
  return { csv, parsed, expected: strip(w) };
}
function assertRoundTrip(name, o, extra) {
  const { csv, parsed, expected } = roundTrip(o);
  check(`${name}：重新解析无异常`, parsed.skipped.length === 0, `skipped=${json(parsed.skipped)} csv=${json(csv)}`);
  const got = parsed.words[0] ? strip(parsed.words[0]) : null;
  check(`${name}：往返一致`, json(got) === json(expected), `期望 ${json(expected)}，实际 ${json(got)}，导出行 ${json(csv.split('\n')[1] ?? '')}`);
  if (extra) extra(csv, parsed);
}

// ---------- 1. F1 别名映射 ----------
const aliases = [
  ['平', 'mid'], ['低', 'low'],
  ['中平', 'mid'], ['中平调', 'mid'], ['平凡', 'mid'], ['สามัญ', 'mid'], ['mid', 'mid'], ['MID', 'mid'],
  ['低平', 'low'], ['低调', 'low'], ['低调平', 'low'], ['เอก', 'low'], ['low', 'low'],
  ['降', 'falling'], ['降调', 'falling'], ['โท', 'falling'], ['falling', 'falling'],
  ['高', 'high'], ['高升', 'high'], ['高调', 'high'], ['高平', 'high'], ['ตรี', 'high'], ['high', 'high'],
  ['升', 'rising'], ['低升', 'rising'], ['升调', 'rising'], ['จัตวา', 'rising'], ['rising', 'rising'],
];
for (const [raw, id] of aliases) {
  check(`别名 ${raw} → ${id}`, normalizeToneId(raw) === id, `实际 ${json(normalizeToneId(raw))}`);
}
check('别名前后空格仍被裁剪', normalizeToneId(' 平 ') === 'mid' && normalizeToneId(' 低 ') === 'low');
for (const raw of ['', '无', 'none', '-', '—', 'unknown', 'n/a', '平-平', '也许']) {
  check(`未知/空标签 ${json(raw)} → null`, normalizeToneId(raw) === null, `实际 ${json(normalizeToneId(raw))}`);
}
check('未知标签 null 仍保持原逻辑（null 而非猜测值）', normalizeToneId(undefined) === null && normalizeToneId(null) === null);

// ---------- 2. 导出转义 ----------
const commaCase = {
  thai: 'คะ', meaning: '语气词（问句,女性用）', toneMark: 'high', pos: '助词',
  example: 'คุณชื่ออะไรคะ（你叫什么名字？）', note: '陈述和请求句尾用 ค่ะ', tags: ['语气词'],
};
const commaCsv = exportWordsToCSV([word(commaCase)]).split('\n')[1];
check('导出：含逗号字段加双引号', /"语气词（问句,女性用）"/.test(commaCsv), json(commaCsv));

const quoteCase = { thai: 'ครับ', meaning: '男用敬语，句末说"ครับ"即可', toneMark: 'high', note: '引号："x""y"' };
const quoteCsv = exportWordsToCSV([word(quoteCase)]).split('\n')[1];
check('导出：内部双引号翻倍', /""/.test(quoteCsv), json(quoteCsv));

const nlCase = { thai: 'ได้', meaning: '可以', note: '第一行\n第二行' };
const nlCsv = exportWordsToCSV([word(nlCase)]);
check('导出：含换行字段加双引号', /"第一行\n第二行"/.test(nlCsv), json(nlCsv));

assertRoundTrip('普通字段', {
  thai: 'กิน', meaning: '吃', toneMark: 'mid', pos: '动词',
  example: 'กินข้าว', note: '日常', tags: ['日常', '食物'],
  romanization: 'gin', exampleRoman: 'gin kâao', exampleMeaning: '吃饭',
});
assertRoundTrip('含逗号释义', commaCase);
assertRoundTrip('含双引号释义', quoteCase);
assertRoundTrip('含换行释义', nlCase);
assertRoundTrip('全角逗号释义', { thai: 'สวัสดี', meaning: '你好，问候语', toneMark: 'low', pos: '感叹词' });
assertRoundTrip('泰文与 Paiboon+ 字符', {
  thai: 'ผู้หญิง', meaning: '女人', toneMark: 'high', romanization: 'pôo-yǐng',
  example: 'ค่ะ', exampleRoman: 'kâ', note: 'IPA /kʰaʔ˥˩/ 中平 ˧ 低 ˨˩ 降 ˥˩ 高 ˦˥ 升 ˩˩˦',
  tags: ['常用'], exampleMeaning: '是的（女用）',
});
{
  const r = parseCSV('#泰文,中文,声调,词性,例句,备注,标签,罗马音,例句罗马音,例句中文\nมา,来,低调,动词,,,,maa,,\nคะ,语气词,高,助词,,,,ka,,\n');
  check('CSV 声调列旧中文标签归一化为 canonical id',
    r.words[0]?.toneMark === 'low' && r.words[1]?.toneMark === 'high',
    json(r.words.map(w => w.toneMark)));
}

// ---------- 3. 表头识别 ----------
{
  const legacy = { thai: 'กิน', meaning: '吃', toneMark: 'mid', tags: [], id: 1, createdAt: 1, updatedAt: 1 };
  const csv = exportWordsToCSV([legacy]);
  const r = parseCSV(csv);
  check('旧记录缺字段：不写出 undefined', !csv.includes('undefined'), json(csv));
  check('旧记录缺字段：回读为空字符串', r.words.length === 1 && r.words[0].pos === '' && r.skipped.length === 0, json(r));
}
const currentHeader = '#泰文,中文,声调,词性,例句,备注,标签,罗马音,例句罗马音,例句中文';
{
  const r = parseCSV(`${currentHeader}\nกิน,吃,mid,动词,กินข้าว,,日常;食物,gin,gin kâao,吃饭\nมา,来,升调,动词,,,,maa,,来\n`);
  check('有表头 CSV：解析出 2 条', r.words.length === 2, json(r.words));
  check('有表头 CSV：表头未被当成单词', !r.words.some(w => w.thai === '泰文'), json(r.words.map(w => w.thai)));
  check('有表头 CSV：无异常上报', r.skipped.length === 0, json(r.skipped));
  check('有表头 CSV：字段按表头名映射', json(strip(r.words[0])) === json(strip(word({
    thai: 'กิน', meaning: '吃', toneMark: 'mid', pos: '动词', example: 'กินข้าว', note: '',
    tags: ['日常', '食物'], romanization: 'gin', exampleRoman: 'gin kâao', exampleMeaning: '吃饭',
  }))), json(r.words[0]));
  check('有表头 CSV：声调标签归一化', r.words[1].toneMark === 'rising', json(r.words[1].toneMark));
}
{
  const r = parseCSV('泰文,中文,声调,词性,例句,备注,标签\nสวัสดี,你好,平,感叹词,,,日常\nมา,来,低,动词,,,问候\n');
  check('无 # 的旧版表头同样被跳过', r.words.length === 2 && !r.words.some(w => w.thai === '泰文'), json(r.words));
  check('旧版表头：平→mid、低→low 生效', r.words[0].toneMark === 'mid' && r.words[1].toneMark === 'low',
    json(r.words.map(w => w.toneMark)));
  check('旧版表头：无异常上报', r.skipped.length === 0, json(r.skipped));
}
{
  const r = parseCSV(`${currentHeader}\nมากินข้าว吧,去吃饭吧,mid,短语,,,,maa gin kâao ba,,\n${currentHeader}\nน้ำ,水,低,名词,,,,nam,,\n`);
  check('重复出现的表头行不会被导入', r.words.length === 2 && !r.words.some(w => w.thai === '泰文'), json(r.words.map(w => w.thai)));
}
{
  const r = parseCSV('สวัสดี,你好,平,感叹词,,,日常\nมา,来,低,动词,,,问候\n');
  check('历史无表头 CSV：首行仍作为数据导入', r.words.length === 2 && r.words[0].thai === 'สวัสดี', json(r.words));
  check('历史无表头 CSV：无异常上报', r.skipped.length === 0, json(r.skipped));
}
{
  const r = parseCSV('# 这是注释行\nสวัสดี,你好,mid,感叹词\n');
  check('# 注释行仍被忽略', r.words.length === 1 && r.skipped.length === 0, json(r));
}

// ---------- 3b. 表头字段名映射与非法表头 ----------
{
  const r = parseCSV('#中文,泰文,罗马音,声调\n你好,สวัสดี,sà-wàt-dii,中平\n吃饭,กิน,gin,mid\n');
  check('乱序表头：按字段名映射',
    json(r.words.map(w => [w.thai, w.meaning, w.romanization, w.toneMark])) === json([['สวัสดี', '你好', 'sà-wàt-dii', 'mid'], ['กิน', '吃饭', 'gin', 'mid']]),
    json(r.words));
  check('乱序表头：无异常上报', r.skipped.length === 0, json(r.skipped));
  check('乱序表头：表头未列出的字段为空', r.words.every(w => w.example === '' && w.note === '' && json(w.tags) === json([])), json(r.words[0]));
}
{
  const r = parseCSV('泰文,中文,泰文\nกิน,吃,mid\n');
  check('重复表头字段：表头不当成词条', r.words.every(w => w.thai !== '泰文'), json(r.words));
  check('重复表头字段：明确上报', r.skipped.length === 1 && /表头字段重复：泰文/.test(r.skipped[0].reason) && r.skipped[0].line === 1, json(r.skipped));
}
{
  const r = parseCSV('泰文,中文,拼音\nกิน,吃,mid\n');
  check('未知表头字段：明确上报', r.skipped.some(s => /表头含未知字段：拼音/.test(s.reason)), json(r.skipped));
  check('未知表头字段：表头不当成词条', !r.words.some(w => w.thai === '泰文'), json(r.words));
  check('未知表头字段：数据行退回默认列位解析', r.words.length === 1 && r.words[0].thai === 'กิน' && r.words[0].meaning === '吃', json(r.words));
}
{
  const r = parseCSV('泰文,,中文,词性\nกิน,吃,mid,动词\n');
  check('表头空字段名：明确上报', r.skipped.some(s => /表头存在空字段名/.test(s.reason)), json(r.skipped));
  check('表头空字段名：不当成词条导入', !r.words.some(w => w.thai === '泰文'), json(r.words));
}
{
  const r = parseCSV('声调,词性,例句,备注,标签\nมา,来,低,动词,กินข้าว\n');
  check('表头缺必需字段：明确上报', r.skipped.length === 1 && /表头缺少必需字段：泰文、中文/.test(r.skipped[0].reason), json(r.skipped));
  check('表头缺必需字段：表头不当成词条', !r.words.some(w => w.thai === '声调'), json(r.words));
  check('表头缺必需字段：数据行退回默认列位', r.words.length === 1 && r.words[0].thai === 'มา' && r.words[0].toneMark === 'low', json(r.words));
}
{
  const r = parseCSV(`${currentHeader}\r\nกิน,吃,mid,动词,,,,gin,,\r\n`);
  check('CRLF 文件：表头识别、数据解析一致', r.words.length === 1 && r.words[0].thai === 'กิน' && r.skipped.length === 0, json(r));
  check('CRLF 文件：行尾符不残留在末列', r.words[0].exampleMeaning === '', json(r.words[0]));
}
{
  const bom = String.fromCharCode(0xfeff);
  const r = parseCSV(`${bom}${currentHeader}\nกิน,吃,mid,动词,,,,gin,,\n`);
  check('BOM：表头识别不受影响', r.words.length === 1 && r.skipped.length === 0, json(r));
  check('BOM：不混入首列内容', r.words[0].thai === 'กิน' && !r.words[0].thai.includes(bom), json(r.words[0]));
  const r2 = parseCSV(`${bom}มา,来,低\n`);
  check('BOM + 无表头：首行仍按数据导入且首列干净', r2.words.length === 1 && r2.words[0].thai === 'มา', json(r2.words));
}

// ---------- 4. 异常行安全处理 ----------
{
  const r = parseCSV('泰文,中文,声调,词性,例句,备注,标签\nมา,来,低\n');
  check('列数少于表头：不导入', r.words.length === 0, json(r.words));
  check('列数少于表头：上报原因', r.skipped.length === 1 && /列数与表头不符/.test(r.skipped[0].reason), json(r.skipped));
}
{
  const r = parseCSV('กิน,吃,mid,动词,กินข้าว,日常,食物,gin,gin kâao,吃饭,多余列\n');
  check('无表头但列数超模板：不导入', r.words.length === 0, json(r.words));
  check('无表头但列数超模板：上报原因', r.skipped.length === 1 && /列数超出模板/.test(r.skipped[0].reason), json(r.skipped));
}
{
  const r = parseCSV('泰文,中文,声调,词性,例句,备注,标签\n,来,低,动词,,,问候\n');
  check('缺泰文：不导入且上报', r.words.length === 0 && /缺少泰文或中文/.test(r.skipped[0]?.reason ?? ''), json(r));
}
{
  const r = parseCSV('泰文,中文,声调,词性,例句,备注,标签\n"คะ","语气词（问句,女性用）",高,助词,"คุณชื่ออะไรคะ（你叫什么名字？）","他说""你好""",\n');
  check('引号与转义双引号不改变列数', r.words.length === 1 && r.skipped.length === 0, json(r));
  check('引号内逗号保留在同一列', r.words[0]?.meaning === '语气词（问句,女性用）', json(r.words[0]));
  check('"" 还原为单个双引号', r.words[0]?.note === '他说"你好"', json(r.words[0]?.note));
}
{
  const r = parseCSV('泰文,中文,声调,词性,例句,备注,标签\n"แพงไป",太贵了,mid,固定短语,แพงไปค่ะ（太贵了,能便宜一点吗？）,ไป 放形容词后,标签\n');
  check('合法引号字段 + 同行未转义逗号：错位仍被拦截', r.words.length === 0, json(r.words));
  check('合法引号字段 + 同行未转义逗号：原因为未转义逗号', r.skipped.length === 1 && /字段内逗号未转义/.test(r.skipped[0].reason), json(r.skipped));
  check('合法引号字段 + 同行未转义逗号：保留原始行内容', (r.skipped[0]?.raw ?? '').startsWith('"แพงไป"'), json(r.skipped[0]?.raw));
}

// ---------- 4b. 引号合法性 ----------
{
  const r = parseCSV('泰文,中文,声调\nมา,"来,低,动词\n');
  check('未闭合引号：不导入', r.words.length === 0, json(r.words));
  check('未闭合引号：上报行号与原因', r.skipped.length === 1 && r.skipped[0].line === 2 && /未闭合/.test(r.skipped[0].reason), json(r.skipped));
}
{
  const r = parseCSV('泰文,中文,声调\nมา,你"好,mid\n');
  check('非法引号位置：不导入', r.words.length === 0, json(r.words));
  check('非法引号位置：上报原因', r.skipped.length === 1 && /不合法的双引号/.test(r.skipped[0].reason) && r.skipped[0].line === 2, json(r.skipped));
}
{
  const r = parseCSV('泰文,中文,声调\n"มา"x,来,mid\n');
  check('闭引号后紧跟字符：不导入并上报', r.words.length === 0 && r.skipped.some(s => /闭引号后紧跟其他字符/.test(s.reason)), json(r));
}
{
  const r = parseCSV('泰文,中文,声调,词性,例句,备注,标签\nได้,"第一行\n第二行",mid,动词,ได้ข้าว,,日常\nมา,来,低,动词,,,\n');
  check('带引号的多行字段：整行仍按合法数据导入', r.words.length === 2 && r.skipped.length === 0, json(r));
  check('带引号的多行字段：换行原样保留在字段内', r.words[0]?.meaning === '第一行\n第二行', json(r.words[0]?.meaning));
  const r2 = parseCSV('泰文,中文\nได้,"第一行\n第二行"\nมา,来,多余\n');
  check('带引号的多行字段：后续行号继续累加', r2.skipped.length === 1 && r2.skipped[0].line === 4, json(r2.skipped));
}

// ---------- 4c. 声调标签 ----------
{
  const r = parseCSV('泰文,中文,声调\nมา,来,也许\n');
  check('未知声调：不导入', r.words.length === 0, json(r.words));
  check('未知声调：上报原因并保留原文', r.skipped.length === 1 && /未知声调标签：也许/.test(r.skipped[0].reason) && r.skipped[0].raw.includes('也许'), json(r.skipped));
}
{
  const r = parseCSV('泰文,中文,声调,词性\nมา,来,,动词\nได้,可以,mid,\n');
  check('空声调与已知声调：正常导入', r.words.length === 2 && r.words[0].toneMark === '' && r.words[1].toneMark === 'mid' && r.skipped.length === 0, json(r));
}
{
  const r = parseCSV('泰文,中文,声调\nมา,来,-\nได้,可以,无\n');
  check('“未标注”写法（-、无）按空声调导入', r.words.length === 2 && r.words.every(w => w.toneMark === ''), json(r.words));
}
{
  const r = parseCSV('泰文,中文,声调\nแพงไป,太贵了,平-平\n');
  check('多音节标签 平-平：作为未支持格式上报，不静默导入', r.words.length === 0 && r.skipped.length === 1 && /暂不支持多音节声调标签/.test(r.skipped[0].reason), json(r));
  check('多音节标签 平-平：原因与原始行都保留标签原文', r.skipped[0]?.reason.includes('平-平') && r.skipped[0]?.raw.includes('平-平'), json(r.skipped[0]));
  const r2 = parseCSV('泰文,中文,声调\nมา,来,低调-低调\nได้,可以,高调/高调\n');
  check('其它分隔写法同样按多音节上报', r2.skipped.length === 2 && r2.skipped.every(s => /暂不支持多音节/.test(s.reason)) && r2.words.length === 0, json(r2.skipped));
}
{
  const r = parseCSV('泰文,中文,声调\nมา,来,低调\nได้,可以,高升\n');
  check('已知声调旧标签：归一化且不报错', r.words.length === 2 && r.words.map(w => w.toneMark).join() === 'low,high' && r.skipped.length === 0, json(r));
}

// ---------- 5. 线上导出的三处问题记录（仅作样本，不写入任何词库） ----------
{
  const bad = [
    'แพงไป,太贵了,平-平,固定短语,แพงไปค่ะ ลดหน่อยได้ไหมคะ（太贵了,能便宜一点吗？）,ไป 放形容词后表“过于”',
    'คะ,语气词（问句,女性用）,高,助词,คุณชื่ออะไรคะ（你叫什么名字？）,陈述和请求句尾用 ค่ะ',
    'ค่ะ,语气词（陈述、请求、回答,女性用）,降,助词,ขอน้ำค่ะ（请给我水）,问句句尾用 คะ',
  ];
  const r = parseCSV(`泰文,中文,声调,词性,例句,备注,标签\n${bad.join('\n')}\n`);
  check('L52/L112/L113：列数看似正常但错位，一条都不导入', r.words.length === 0, json(r.words));
  check('L52/L112/L113：三行全部上报', r.skipped.length === 3, json(r.skipped));
  check('L52/L112/L113：原因为未转义逗号', r.skipped.every(s => /字段内逗号未转义/.test(s.reason)), json(r.skipped));
  check('L52/L112/L113：行号定位到第 2/3/4 行', json(r.skipped.map(s => s.line)) === json([2, 3, 4]), json(r.skipped.map(s => s.line)));

  const fixed = [
    '"คะ","语气词（问句,女性用）",高,助词,"คุณชื่ออะไรคะ（你叫什么名字？）",陈述和请求句尾用 ค่ะ,',
    '"ค่ะ","语气词（陈述、请求、回答,女性用）",降,助词,"ขอน้ำค่ะ（请给我水）",问句句尾用 คะ,',
    // 声调列留空：本轮不为 แพงไป 的多音节标签发明任何值，只验证转义后的字段完整性。
    '"แพงไป",太贵了,,固定短语,"แพงไปค่ะ ลดหน่อยได้ไหมคะ（太贵了,能便宜一点吗？）","ไป 放形容词后表“过于”",',
  ];
  const ok = parseCSV(`泰文,中文,声调,词性,例句,备注,标签\n${fixed.join('\n')}\n`);
  check('转义修复后：三行均可正常导入', ok.words.length === 3 && ok.skipped.length === 0, json(ok));
  check('转义修复后：คะ 释义完整、声调高调', ok.words[0]?.meaning === '语气词（问句,女性用）' && ok.words[0]?.toneMark === 'high', json(ok.words[0]));
  check('转义修复后：ค่ะ 释义完整、声调降调', ok.words[1]?.meaning === '语气词（陈述、请求、回答,女性用）' && ok.words[1]?.toneMark === 'falling', json(ok.words[1]));
  check('转义修复后：แพงไป 例句括号内的逗号留在同一列', ok.words[2]?.example === 'แพงไปค่ะ ลดหน่อยได้ไหมคะ（太贵了,能便宜一点吗？）' && ok.words[2]?.note === 'ไป 放形容词后表“过于”' && json(ok.words[2]?.tags) === json([]), json(ok.words[2]));
  check('转义修复后：空声调按未标注导入', ok.words[2]?.toneMark === '', json(ok.words[2]?.toneMark));
  const label = parseCSV(`泰文,中文,声调,词性,例句,备注,标签\n${fixed[2].replace(',,固定短语', ',平-平,固定短语')}\n`);
  check('แพงไป 原标签 平-平：作为未支持格式上报，不静默写入', label.words.length === 0 && label.skipped.length === 1 && /暂不支持多音节/.test(label.skipped[0].reason), json(label));
}

// ---------- 6. 导出文件自身必须可回读 ----------
{
  const words = [
    word({ ...commaCase, id: 1 }),
    word({ thai: 'แพงไป', meaning: '太贵了', pos: '固定短语', example: 'แพงไปค่ะ ลดหน่อยได้ไหมคะ（太贵了,能便宜一点吗？）', note: 'ไป 放形容词后表“过于”', romanization: 'phaeng bpai' }),
    word({ thai: 'ก๋วยเตี๋ยว', meaning: '米粉', romanization: 'gǔuay-dǐao', tags: ['食物'] }),
  ];
  const r = parseCSV(exportWordsToCSV(words));
  check('导出→导入：行数一致', r.words.length === words.length, json(r.words));
  check('导出→导入：无跳过行', r.skipped.length === 0, json(r.skipped));
  check('导出→导入：逐字段一致', json(r.words.map(strip)) === json(words.map(strip)), json(r.words));
}

// ---------- 输出 ----------
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n        ${r.detail}`}`);
}
console.log(`\n共 ${results.length} 项，通过 ${results.length - failed} 项，失败 ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
