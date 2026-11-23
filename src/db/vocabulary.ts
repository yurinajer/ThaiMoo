import { db, getOrCreateDailyStat, type Word } from './index';
import { MAX_TONE_SYLLABLES, isToneBlank, normalizeToneSeq, parseToneSeq, toneSeqToStorage } from '../lib/tones';
export type { Word } from './index';

// 「今日新词」按入库计：手动添加、CSV 导入、参考词库加入生词本三条路径都汇到 addWord，
// 计数记在这里就不怕以后新增入库入口漏计。备份恢复走 db.words.bulkAdd 不经过本函数，
// 所以不会把整个旧词库冒充成今天新学的词。删除词不回退计数（历史学习量不做减法）。
export async function addWord(word: Omit<Word, 'id' | 'createdAt' | 'updatedAt'>): Promise<number> {
  const now = Date.now();
  const newWord: Word = {
    ...word,
    createdAt: now,
    updatedAt: now,
  };
  const id = await db.words.add(newWord);
  const stat = await getOrCreateDailyStat();
  stat.newWords++;
  await db.dailyStats.put(stat);
  return id;
}

export async function updateWord(id: number, changes: Partial<Word>): Promise<void> {
  await db.words.update(id, { ...changes, updatedAt: Date.now() });
}

export async function deleteWord(id: number): Promise<void> {
  await deleteWords([id]);
}

export async function deleteWords(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const doomed = new Set(ids);

  await db.transaction(
    'rw',
    [db.words, db.reviewStates, db.errorRecords, db.stubbornWords, db.minimalPairGroups, db.voiceClips, db.speedStatuses],
    async () => {
      await db.words.bulkDelete(ids);
      await db.reviewStates.bulkDelete(ids);
      await db.stubbornWords.bulkDelete(ids);
      // 速刷状态主键也是 wordId，词没了留着就是孤儿行，按同一个 id 直接收掉。
      await db.speedStatuses.bulkDelete(ids);
      await db.errorRecords.where('wordId').anyOf(ids).delete();
      await db.voiceClips.where('wordId').anyOf(ids).delete();
      // 对比组的 wordIds 是普通数组字段、没有索引，只能整表过一遍再回写。
      // 全空的组直接收掉：一个词都不剩就没有可对比的对象；只剩 1 个词的组保留，
      // 页面自己会提示「有效单词不足 2 个」，用户还能继续往里加词。
      const groups = await db.minimalPairGroups.toArray();
      for (const group of groups) {
        const kept = group.wordIds.filter(id => !doomed.has(id));
        if (kept.length === 0) await db.minimalPairGroups.delete(group.id!);
        else if (kept.length !== group.wordIds.length) await db.minimalPairGroups.update(group.id!, { wordIds: kept });
      }
    }
  );

  return ids.length;
}

export async function getWord(id: number): Promise<Word | undefined> {
  return await db.words.get(id);
}

export async function getAllWords(): Promise<Word[]> {
  return await db.words.orderBy('createdAt').reverse().toArray();
}

export async function searchWords(query: string): Promise<Word[]> {
  const q = query.toLowerCase();
  return await db.words
    .filter(w =>
      w.thai.includes(q) ||
      w.meaning.toLowerCase().includes(q) ||
      w.tags.some(t => t.toLowerCase().includes(q)) ||
      w.note.toLowerCase().includes(q)
    )
    .toArray();
}

export async function getWordCount(): Promise<number> {
  return await db.words.count();
}

export async function findDuplicate(thai: string, excludeId?: number): Promise<Word | undefined> {
  return await db.words.where('thai').equals(thai).first();
}

export async function importWords(words: Omit<Word, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<{ imported: number; duplicates: number; ids: number[] }> {
  let imported = 0;
  let duplicates = 0;
  const ids: number[] = [];

  // dailyStats 必须在事务域里：循环里每个 addWord 都要给「今日新词」计数
  await db.transaction('rw', [db.words, db.dailyStats], async () => {
    for (const word of words) {
      const existing = await db.words.where('thai').equals(word.thai).first();
      if (existing) {
        duplicates++;
        continue;
      }
      ids.push(await addWord(word));
      imported++;
    }
  });

  return { imported, duplicates, ids };
}

// 列标签即导出顺序，新字段一律追加在末尾，历史 7 列导出文件因此仍可按位置解析。
// 有表头时按字段名建立映射，列顺序调整不影响导入；无表头时沿用这里的默认列位。
type CsvField =
  | 'thai' | 'meaning' | 'toneMark' | 'pos' | 'example'
  | 'note' | 'tags' | 'romanization' | 'exampleRoman' | 'exampleMeaning';

// 声调列按音节顺序填写，多音节用 - 连接（mid-high）；读取侧还接受 / → 与空格。
const CSV_FIELDS: Record<string, CsvField> = {
  泰文: 'thai',
  中文: 'meaning',
  声调: 'toneMark',
  词性: 'pos',
  例句: 'example',
  备注: 'note',
  标签: 'tags',
  罗马音: 'romanization',
  例句罗马音: 'exampleRoman',
  例句中文: 'exampleMeaning',
};

// 页面里的「CSV 自动生成规范」直接引用这份列名，说明文字不可能和解析器各说一套。
export const CSV_COLUMNS = Object.keys(CSV_FIELDS);
const DEFAULT_ORDER = Object.values(CSV_FIELDS);
// 报错要指名道姓，所以反查一份“字段→列名”，表头顺序被打乱时也报的是真实列名。
const CSV_LABELS = Object.entries(CSV_FIELDS).reduce((acc, [label, field]) => {
  acc[field] = label;
  return acc;
}, {} as Record<CsvField, string>);
const REQUIRED_LABELS = ['泰文', '中文'];

export interface CSVRow {
  fields: string[];
  fieldQuoted: boolean[];
  comment: boolean;
  line: number;
  raw: string;
  quoteError: string | null;
}

export interface CSVSkip {
  line: number;
  column?: string;
  reason: string;
  raw: string;
}

export interface ParsedCSV {
  words: Omit<Word, 'id' | 'createdAt' | 'updatedAt'>[];
  skipped: CSVSkip[];
}

interface CsvHeader {
  map: (CsvField | null)[];
}

type HeaderRead =
  | { kind: 'none' }
  | { kind: 'bad'; reason: string }
  | { kind: 'ok'; header: CsvHeader };

// 逗号（半/全角）与制表符都是本格式的字段分隔符，所以三种都要转义，
// 否则 "语气词（问句,女性用）" 这类释义会在下一轮导入时错位成多个字段。
// 旧记录可能缺字段，undefined 不能写成 "undefined" 字符串。
function csvCell(value: string | undefined): string {
  const text = value ?? '';
  return /["，,\t\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// 只有字段起始处的双引号才开启引用态，连续两个双引号是转义，闭引号之后必须
// 紧跟分隔符或行尾。其余写法记为引号异常（quoteError），但字段内容仍按原样
// 收集，好让调用方把整行原封不动地上报给用户，而不是静默改写。
function splitCSVRows(text: string): CSVRow[] {
  const rows: CSVRow[] = [];
  let fields: string[] = [];
  let fieldQuoted: boolean[] = [];
  let field = '';
  let fieldWasQuoted = false;
  let inQuotes = false;
  let afterQuote = false;
  let quoteError: string | null = null;
  let line = 1;
  let rowLine = 1;
  let rowStart = 0;

  const endField = () => {
    fields.push(fieldWasQuoted ? field : field.trim());
    fieldQuoted.push(fieldWasQuoted);
    field = '';
    fieldWasQuoted = false;
  };
  const endRow = (endIdx: number) => {
    endField();
    rows.push({
      fields,
      fieldQuoted,
      comment: fields.length > 0 && fields[0].startsWith('#'),
      line: rowLine,
      raw: text.slice(rowStart, endIdx).replace(/[\r\n]+$/, ''),
      quoteError,
    });
    fields = [];
    fieldQuoted = [];
    quoteError = null;
    rowLine = line;
    rowStart = endIdx;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (field.trim() === '' && !afterQuote) {
        inQuotes = true;
        fieldWasQuoted = true;
        field = '';
      } else if (!quoteError) {
        quoteError = '字段内容中出现了不合法的双引号，无法确定字段边界';
        field += ch;
      } else {
        field += ch;
      }
      afterQuote = false;
      continue;
    }
    if (afterQuote && !quoteError && ch !== ',' && ch !== '，' && ch !== '\t' && ch !== '\r' && ch !== '\n') {
      quoteError = '闭引号后紧跟其他字符，无法确定字段边界';
    }
    if (ch === ',' || ch === '，' || ch === '\t') {
      endField();
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      line++;
      endRow(i + 1);
    } else {
      field += ch;
    }
    afterQuote = false;
  }
  if (inQuotes && !quoteError) {
    quoteError = '双引号未闭合，引号之后的内容被并入同一字段';
  }
  if (field !== '' || fields.length > 0 || inQuotes) endRow(text.length);
  return rows;
}

// 表头按字段名识别并建立“列位→字段”映射，所以列顺序可调整、重复出现的表头
// 也只会被跳过；非法表头单独上报，绝不当成词条导入，也不据它推断列映射。
// 字段名不会是泰文；含泰文说明这是数据行，无表头的旧文件继续按列位解析。
const containsThai = (text: string): boolean =>
  [...text].some(ch => ch.charCodeAt(0) >= 0x0e00 && ch.charCodeAt(0) <= 0x0e7f);

function readHeader(fields: string[]): HeaderRead {
  const cells = fields.map(f => f.replace(/^#+/, '').trim());
  const named = cells.filter(c => c !== '');
  if (named.length < 2) return { kind: 'none' };
  if (cells.some(containsThai)) return { kind: 'none' };
  if (!named.every(c => CSV_FIELDS[c]) && !named.some(c => c === '泰文' || c === '中文')) {
    return { kind: 'none' };
  }

  const unknown = named.filter(c => !CSV_FIELDS[c]);
  if (unknown.length > 0) return { kind: 'bad', reason: `表头含未知字段：${unknown.join('、')}` };

  const dupes = named.filter((c, i) => named.indexOf(c) !== i);
  if (dupes.length > 0) {
    return { kind: 'bad', reason: `表头字段重复：${dupes.filter((c, i) => dupes.indexOf(c) === i).join('、')}` };
  }

  const lastNamed = cells.reduce((acc, c, i) => (c === '' ? acc : i), -1);
  if (cells.slice(0, lastNamed + 1).some(c => c === '')) {
    return { kind: 'bad', reason: '表头存在空字段名，列位置无法映射' };
  }

  const missing = REQUIRED_LABELS.filter(r => !named.includes(r));
  if (missing.length > 0) return { kind: 'bad', reason: `表头缺少必需字段：${missing.join('、')}` };

  return { kind: 'ok', header: { map: cells.map(c => CSV_FIELDS[c] ?? null) } };
}

function bracketBalance(text: string): number {
  let depth = 0;
  for (const ch of text) {
    if (ch === '（' || ch === '(') depth++;
    else if (ch === '）' || ch === ')') depth--;
  }
  return depth;
}

// 整行括号收支平衡、但某个未加引号的字段内部不平衡，说明括号里的逗号没被转义，
// 字段已经被拆开——列数看起来正常，位置却不可信。已加引号的字段不参与统计：
// 它的逗号本就被正确转义，同一行里其他字段是否错位与它无关。
function isShiftedRow(fields: string[], fieldQuoted: boolean[]): boolean {
  let total = 0;
  let crossed = false;
  for (let i = 0; i < fields.length; i++) {
    if (fieldQuoted[i]) continue;
    const balance = bracketBalance(fields[i]);
    total += balance;
    if (balance !== 0) crossed = true;
  }
  return crossed && total === 0;
}

const TONE_FORMAT_HINT = '可填 mid / low / falling / high / rising，或旧标签 平 / 低 / 降 / 高 / 升；多音节按顺序写，例如 mid-high';

// 声调列一次给出整条音节序列。哪个音节认不出来就报哪个音节，超出上限就报实际
// 个数——未知声调不能静默清成空值，整行进入 skipped，原文保留在 raw 里。
function toneProblem(raw: string): string | null {
  const label = raw.trim();
  if (isToneBlank(label)) return null;
  const { tones, invalid } = parseToneSeq(label);
  if (invalid.length > 0) {
    const first = invalid[0];
    return `第 ${first.index} 个音节「${first.value}」无法识别（共 ${tones.length + invalid.length} 个音节）。${TONE_FORMAT_HINT}`;
  }
  if (tones.length > MAX_TONE_SYLLABLES) {
    return `写了 ${tones.length} 个音节，最多 ${MAX_TONE_SYLLABLES} 个：${label}`;
  }
  return null;
}

export function parseCSV(text: string): ParsedCSV {
  const rows = splitCSVRows(text.replace(/^\uFEFF/, ''));
  const words: Omit<Word, 'id' | 'createdAt' | 'updatedAt'>[] = [];
  const skipped: CSVSkip[] = [];
  let header: CsvHeader | null = null;

  for (const row of rows) {
    const { fields, line, raw } = row;
    if (fields.every(f => f === '')) continue;

    const read = readHeader(fields);
    if (read.kind === 'bad') {
      skipped.push({ line, reason: read.reason, raw });
      continue;
    }
    if (read.kind === 'ok') {
      // 首个合法表头决定列映射；文件中间重复出现的表头只跳过。
      if (!header) header = read.header;
      continue;
    }
    if (row.comment) continue;

    const reject = (reason: string, column?: string) => skipped.push({ line, column, reason, raw });

    if (row.quoteError) {
      reject(row.quoteError);
      continue;
    }
    if (isShiftedRow(fields, row.fieldQuoted)) {
      reject('字段内逗号未转义，列位置不可信');
      continue;
    }
    if (header && fields.length !== header.map.length) {
      reject(`列数与表头不符（表头 ${header.map.length} 列，本行 ${fields.length} 列）`);
      continue;
    }
    if (!header && fields.length > CSV_COLUMNS.length) {
      reject(`列数超出模板（最多 ${CSV_COLUMNS.length} 列，本行 ${fields.length} 列）`);
      continue;
    }

    const cellOf = (field: CsvField): string => {
      const idx = (header ? header.map : DEFAULT_ORDER).indexOf(field);
      return idx >= 0 ? fields[idx] ?? '' : '';
    };

    const thai = cellOf('thai');
    const meaning = cellOf('meaning');
    if (!thai || !meaning) {
      const missing: string[] = [];
      if (!thai) missing.push(CSV_LABELS.thai);
      if (!meaning) missing.push(CSV_LABELS.meaning);
      reject(`${missing.join('、')}列为空`, missing.join('、'));
      continue;
    }

    const toneCell = cellOf('toneMark');
    const toneIssue = toneProblem(toneCell);
    if (toneIssue) {
      reject(toneIssue, CSV_LABELS.toneMark);
      continue;
    }

    const tagsStr = cellOf('tags');
    words.push({
      thai,
      meaning,
      toneMark: toneSeqToStorage(normalizeToneSeq(toneCell)),
      pos: cellOf('pos'),
      example: cellOf('example'),
      note: cellOf('note'),
      tags: tagsStr ? tagsStr.split(/[;；|]/).map(t => t.trim()).filter(Boolean) : [],
      romanization: cellOf('romanization'),
      exampleRoman: cellOf('exampleRoman'),
      exampleMeaning: cellOf('exampleMeaning'),
      groupId: undefined,
    });
  }

  return { words, skipped };
}

export function exportWordsToCSV(words: Word[]): string {
  const header = '#' + CSV_COLUMNS.join(',');
  const rows = words.map(w =>
    [
      w.thai,
      w.meaning,
      // 认不出的历史脏值原样带出，导出不能替用户悄悄丢掉标注。
      toneSeqToStorage(normalizeToneSeq(w.toneMark)) || w.toneMark || '',
      w.pos,
      w.example,
      w.note,
      w.tags.join(';'),
      w.romanization ?? '',
      w.exampleRoman ?? '',
      w.exampleMeaning ?? '',
    ].map(csvCell).join(',')
  );
  return [header, ...rows].join('\n');
}

export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
