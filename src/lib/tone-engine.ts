import { TONES, toneDef, normalizeToneId, type ToneDef, type ToneId } from './tones';

interface ConsonantInfo {
  char: string;
  name: string;
  pronunciation: string;
  meaning: string;
}

interface ConsonantClass {
  name: string;
  nameThai: string;
  consonants: ConsonantInfo[];
}

interface ConsonantData {
  description: string;
  classes: {
    mid: ConsonantClass;
    high: ConsonantClass;
    low: ConsonantClass;
  };
  specialRules: Record<string, unknown>;
}

interface ToneRuleData {
  description: string;
  tones: { id: string; name: string; symbol: string; mark: string }[];
  toneMarks: { char: string; name: string; position: string }[];
  rules: {
    midConsonant: {
      description: string;
      consonantClass: string;
      cases: ToneCase[];
    };
    highConsonant: {
      description: string;
      consonantClass: string;
      cases: ToneCase[];
    };
    lowConsonant: {
      description: string;
      consonantClass: string;
      cases: ToneCase[];
    };
  };
}

interface ToneCase {
  condition: string;
  vowelLength?: string;
  finalType?: string;
  toneMark?: string;
  result: string;
  resultName: string;
}

let consonantData: ConsonantData | null = null;
let toneRuleData: ToneRuleData | null = null;

async function loadConsonantData(): Promise<ConsonantData> {
  if (!consonantData) {
    const resp = await fetch('/data/consonants.json');
    consonantData = await resp.json();
  }
  return consonantData!;
}

async function loadToneRuleData(): Promise<ToneRuleData> {
  if (!toneRuleData) {
    const resp = await fetch('/data/tone-rules.json');
    toneRuleData = await resp.json();
  }
  return toneRuleData!;
}

export function getConsonantClass(char: string): 'mid' | 'high' | 'low' | null {
  if (!consonantData) return null;
  for (const [cls, data] of Object.entries(consonantData.classes)) {
    if (data.consonants.some(c => c.char === char)) {
      return cls as 'mid' | 'high' | 'low';
    }
  }
  return null;
}

export function getToneMarkFromWord(word: string): string | null {
  const marks = ['่', '้', '๊', '๋'];
  for (const mark of marks) {
    if (word.includes(mark)) return mark;
  }
  return null;
}

export function getInitialConsonant(word: string): string | null {
  const cleaned = word.replace(/[่้๊๋็์๎ๆ๏๚๛]/g, '');
  if (cleaned.length === 0) return null;
  return cleaned[0];
}

export function getFinalConsonant(word: string): string | null {
  const cleaned = word.replace(/[่้๊๋็์๎ๆ๏๚๛]/g, '');
  if (cleaned.length <= 1) return null;
  return cleaned[cleaned.length - 1];
}

export function hasLongVowel(word: string): boolean {
  const longVowels = ['า', 'ี', 'ื', 'ู', 'เ', 'แ', 'โ', 'ใ', 'ไ'];
  return longVowels.some(v => word.includes(v));
}

// 塞音尾与 -ศ -ษ -ส（读作 /t/）构成死音节；-ญ -ณ -ฬ 读作 /n/，属活音节。
const DEAD_FINALS = ['ก', 'ข', 'ฃ', 'ค', 'ฅ', 'ฆ', 'จ', 'ช', 'ซ', 'ฌ', 'ฎ', 'ฏ', 'ฐ', 'ฑ', 'ฒ',
  'ด', 'ต', 'ถ', 'ท', 'ธ', 'บ', 'ป', 'ผ', 'ฝ', 'พ', 'ฟ', 'ภ', 'ศ', 'ษ', 'ส'];
const SHORT_VOWEL_FINALS = ['ะ', 'ั', 'ิ', 'ึ', 'ุ'];

export function isLiveSyllable(word: string): boolean {
  const cleaned = word.replace(/[่้๊๋็์๎ๆ๏๚๛]/g, '');
  if (cleaned.length === 0) return false;
  const last = cleaned[cleaned.length - 1];
  if (DEAD_FINALS.includes(last)) return false;
  // 短元音结尾且无尾辅音同样是死音节（จะ、คะ）
  if (SHORT_VOWEL_FINALS.includes(last)) return false;
  return true;
}

export interface ToneDerivation {
  steps: string[];
  result: ToneId;
  resultName: string;
  resultThai: string;
}

export async function deriveTone(word: string): Promise<ToneDerivation | null> {
  const [cData, tData] = await Promise.all([loadConsonantData(), loadToneRuleData()]);
  consonantData = cData;
  toneRuleData = tData;

  const initial = getInitialConsonant(word);
  if (!initial) return null;

  const consonantClass = getConsonantClass(initial);
  if (!consonantClass) return null;

  const steps: string[] = [];
  const className = consonantClass === 'mid' ? '中' : consonantClass === 'high' ? '高' : '低';
  steps.push(`① 首辅音 ${initial} → ${className}辅音`);

  const longVowel = hasLongVowel(word);
  steps.push(`② 元音 → ${longVowel ? '长元音' : '短元音'}`);

  const final = getFinalConsonant(word);
  const live = isLiveSyllable(word);
  steps.push(`③ 尾辅音 → ${final || '无'} (${live ? '活音节' : '死音节'})`);

  const toneMark = getToneMarkFromWord(word);
  const markName = toneMark
    ? tData.toneMarks.find(m => m.char === toneMark)?.name || toneMark
    : '无';
  steps.push(`④ 声调符号 → ${markName}`);

  const ruleKey = `${consonantClass}Consonant` as keyof typeof tData.rules;
  const rule = tData.rules[ruleKey];
  if (!rule) return null;

  // tone-rules.json spells the unmarked condition as "none". Normalising that
  // sentinel to null is what lets an unmarked word reach its own cases instead
  // of failing every branch and returning null.
  let result: ToneCase | undefined;

  for (const c of rule.cases) {
    const caseMark = c.toneMark && c.toneMark !== 'none' ? c.toneMark : null;
    if (caseMark !== toneMark) continue;
    if (c.vowelLength === 'long' && !longVowel) continue;
    if (c.vowelLength === 'short' && longVowel) continue;
    if (c.finalType === 'live' && !live) continue;
    if (c.finalType === 'dead' && live) continue;
    result = c;
    break;
  }

  if (!result) return null;

  // Canonical id wins over whatever the JSON happens to spell, so the derivation
  // can never drift from the tone table used by the quiz.
  const toneId = normalizeToneId(result.result) ?? normalizeToneId(result.resultName);
  if (!toneId) return null;
  const def = toneDef(toneId);

  steps.push(`⑤ 规则匹配 → ${def.zh} ${def.thai} (${def.symbol})`);

  return {
    steps,
    result: toneId,
    resultName: def.zh,
    resultThai: def.thai,
  };
}

export async function getAllConsonants(): Promise<{
  mid: ConsonantInfo[];
  high: ConsonantInfo[];
  low: ConsonantInfo[];
}> {
  const data = await loadConsonantData();
  return {
    mid: data.classes.mid.consonants,
    high: data.classes.high.consonants,
    low: data.classes.low.consonants,
  };
}

export async function getToneOptions(): Promise<ToneDef[]> {
  await loadToneRuleData();
  return TONES;
}
