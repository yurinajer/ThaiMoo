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

export function isLiveSyllable(word: string): boolean {
  const liveFinals = ['ม', 'น', 'ง', 'ย', 'ว', 'ล', 'ร'];
  const cleaned = word.replace(/[่้๊๋็์๎ๆ๏๚๛]/g, '');
  if (cleaned.length === 0) return false;
  const last = cleaned[cleaned.length - 1];
  if (liveFinals.includes(last)) return true;
  if (/[าีืูเแโใไะำ]/.test(cleaned) && !/[กขคฆดตทธบปพฟศษสฮ]/.test(cleaned.slice(-1))) return true;
  return false;
}

export interface ToneDerivation {
  steps: string[];
  result: string;
  resultName: string;
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

  let result: ToneCase | undefined;

  for (const c of rule.cases) {
    if (c.toneMark && c.toneMark !== toneMark) continue;
    if (!c.toneMark && toneMark) continue;
    if (c.vowelLength === 'long' && !longVowel) continue;
    if (c.vowelLength === 'short' && longVowel) continue;
    if (c.finalType === 'live' && !live) continue;
    if (c.finalType === 'dead' && live) continue;
    result = c;
    break;
  }

  if (!result) {
    result = rule.cases.find(c => !c.toneMark && !c.vowelLength && !c.finalType);
  }

  if (!result) return null;

  steps.push(`⑤ 规则匹配 → ${result.resultName} ${tData.tones.find(t => t.id === result!.result)?.symbol || ''}`);

  return {
    steps,
    result: result.result,
    resultName: result.resultName,
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

export async function getToneOptions(): Promise<{ id: string; name: string; symbol: string }[]> {
  const data = await loadToneRuleData();
  return data.tones.map(t => ({ id: t.id, name: t.name, symbol: t.symbol }));
}
