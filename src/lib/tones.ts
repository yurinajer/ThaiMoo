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

export function normalizeToneId(raw: string | null | undefined): ToneId | null {
  const key = (raw ?? '').trim();
  if (!key || EMPTY.has(key.toLowerCase())) return null;
  return ALIASES[key] ?? ALIASES[key.toLowerCase()] ?? null;
}

export function toneDef(id: ToneId): ToneDef {
  return BY_ID.get(id) ?? TONES[0];
}

export function toneZh(raw: string | null | undefined): string {
  const id = normalizeToneId(raw);
  return id ? toneDef(id).zh : '';
}

export function toneThai(raw: string | null | undefined): string {
  const id = normalizeToneId(raw);
  return id ? toneDef(id).thai : '';
}

export function toneLabel(raw: string | null | undefined): string {
  const id = normalizeToneId(raw);
  if (!id) return '';
  const t = toneDef(id);
  return `${t.zh} · ${t.thai}`;
}

export function toneSymbol(raw: string | null | undefined): string {
  const id = normalizeToneId(raw);
  return id ? toneDef(id).symbol : '';
}

export function toneNum(raw: string | null | undefined): number {
  const id = normalizeToneId(raw);
  return id ? toneDef(id).num : 0;
}

export function toneMarkChar(raw: string | null | undefined): string {
  const id = normalizeToneId(raw);
  return id ? toneDef(id).markChar : '';
}
