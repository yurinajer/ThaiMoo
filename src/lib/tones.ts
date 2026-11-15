export type ToneId = 'mid' | 'low' | 'falling' | 'high' | 'rising';

export interface ToneDef {
  id: ToneId;
  num: number;
  thai: string;
  zh: string;
  en: string;
  symbol: string;
  markChar: string;
}

export const TONES: ToneDef[] = [
  { id: 'mid', num: 1, thai: 'สามัญ', zh: '中平调', en: 'Mid', symbol: '˧', markChar: '' },
  { id: 'low', num: 2, thai: 'เอก', zh: '低调', en: 'Low', symbol: '˨˩', markChar: '่' },
  { id: 'falling', num: 3, thai: 'โท', zh: '降调', en: 'Falling', symbol: '˥˩', markChar: '้' },
  { id: 'high', num: 4, thai: 'ตรี', zh: '高调', en: 'High', symbol: '˦˥', markChar: '๊' },
  { id: 'rising', num: 5, thai: 'จัตวา', zh: '升调', en: 'Rising', symbol: '˩˩˦', markChar: '๋' },
];

const BY_ID = new Map(TONES.map(t => [t.id, t]));

// 多音节词按音节顺序标注，上限与表单的“添加音节”一致。
export const MAX_TONE_SYLLABLES = 4;

// Legacy labels written by older versions of tone-rules.json and the word-form
// select. '高升' / '低升' described contour rather than tone class and collided
// with each other, so both spellings must keep resolving.
const ALIASES: Record<string, ToneId> = {
  mid: 'mid', '中平': 'mid', '中平调': 'mid', '平凡': 'mid', '平': 'mid', 'สามัญ': 'mid',
  low: 'low', '低平': 'low', '低调': 'low', '低调平': 'low', '低': 'low', 'เอก': 'low',
  falling: 'falling', '降调': 'falling', '降': 'falling', 'โท': 'falling',
  high: 'high', '高升': 'high', '高调': 'high', '高平': 'high', '高': 'high', 'ตรี': 'high',
  rising: 'rising', '低升': 'rising', '升调': 'rising', '升': 'rising', 'จัตวา': 'rising',
};

const EMPTY = new Set(['', '无', 'none', '-', '—', 'unknown', 'n/a']);

// 词库里「没有标注」的几种写法。导入要按空声调收下，不能报成非法值。
export function isToneBlank(raw: string | null | undefined): boolean {
  const key = (raw ?? '').trim().toLowerCase();
  return key === '' || EMPTY.has(key);
}

export function normalizeToneId(raw: string | null | undefined): ToneId | null {
  const key = (raw ?? '').trim();
  if (isToneBlank(key)) return null;
  return ALIASES[key] ?? ALIASES[key.toLowerCase()] ?? null;
}

export function toneDef(id: ToneId): ToneDef {
  return BY_ID.get(id) ?? TONES[0];
}

// 音节之间的分隔写法：连字符族、斜杠、箭头、竖线、顿号、逗号分号与空白。
// 存储只用 '-'，读侧宽接是为了不因为用户手写的 'mid / high' 丢掉整行。
const SEQ_SEPARATOR = /[-–—――_/／|｜·、,，;；\s→➔➜]+/;

function splitToneSeq(raw: string | string[] | null | undefined): string[] {
  const text = Array.isArray(raw) ? raw.join(' ') : (raw ?? '');
  return String(text).split(SEQ_SEPARATOR).map(part => part.trim()).filter(part => part !== '');
}

export interface ToneSeqIssue {
  index: number;
  value: string;
}

// 逐项解析。任一项认不出来就整体算异常并原样报告：把 'mid-超' 悄悄存成 'mid'
// 会让用户以为标注了双音节，比导入失败更难发现。
export function parseToneSeq(raw: string | string[] | null | undefined): {
  tones: ToneId[];
  invalid: ToneSeqIssue[];
} {
  const tones: ToneId[] = [];
  const invalid: ToneSeqIssue[] = [];
  splitToneSeq(raw).forEach((part, i) => {
    const id = normalizeToneId(part);
    if (id) tones.push(id);
    else invalid.push({ index: i + 1, value: part });
  });
  return { tones, invalid };
}

export function normalizeToneSeq(raw: string | string[] | null | undefined): ToneId[] {
  return parseToneSeq(raw).tones;
}

export function toneSeqToStorage(tones: ToneId[]): string {
  return tones.join('-');
}

export function toneSeqDefs(raw: string | string[] | null | undefined): ToneDef[] {
  return normalizeToneSeq(raw).map(toneDef);
}

export function toneSeqZh(raw: string | string[] | null | undefined): string {
  return toneSeqDefs(raw)
    .map(tone => tone.zh)
    .join(' → ');
}
