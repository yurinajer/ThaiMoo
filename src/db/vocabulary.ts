import { db, type Word } from './index';
export type { Word } from './index';

export async function addWord(word: Omit<Word, 'id' | 'createdAt' | 'updatedAt'>): Promise<number> {
  const now = Date.now();
  const newWord: Word = {
    ...word,
    createdAt: now,
    updatedAt: now,
  };
  return await db.words.add(newWord);
}

export async function updateWord(id: number, changes: Partial<Word>): Promise<void> {
  await db.words.update(id, { ...changes, updatedAt: Date.now() });
}

export async function deleteWord(id: number): Promise<void> {
  await db.transaction('rw', db.words, db.reviewStates, db.errorRecords, db.stubbornWords, async () => {
    await db.words.delete(id);
    await db.reviewStates.delete(id);
    await db.errorRecords.where('wordId').equals(id).delete();
    await db.stubbornWords.delete(id);
  });
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

export async function importWords(words: Omit<Word, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<{ imported: number; duplicates: number }> {
  let imported = 0;
  let duplicates = 0;

  await db.transaction('rw', db.words, async () => {
    for (const word of words) {
      const existing = await db.words.where('thai').equals(word.thai).first();
      if (existing) {
        duplicates++;
        continue;
      }
      await addWord(word);
      imported++;
    }
  });

  return { imported, duplicates };
}

export function parseCSV(text: string): Omit<Word, 'id' | 'createdAt' | 'updatedAt'>[] {
  const lines = text.trim().split('\n');
  const words: Omit<Word, 'id' | 'createdAt' | 'updatedAt'>[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split(/[,，\t]/).map(s => s.trim());
    if (parts.length < 2) continue;

    const [thai, meaning, toneMark = '', pos = '', example = '', note = '', tagsStr = ''] = parts;
    if (!thai || !meaning) continue;

    const tags = tagsStr ? tagsStr.split(/[;；|]/).map(t => t.trim()).filter(Boolean) : [];

    words.push({ thai, meaning, toneMark, pos, example, note, tags, groupId: undefined });
  }

  return words;
}

export function exportWordsToCSV(words: Word[]): string {
  const header = '泰文,中文,声调,词性,例句,备注,标签';
  const rows = words.map(w =>
    [w.thai, w.meaning, w.toneMark, w.pos, w.example, w.note, w.tags.join(';')].join(',')
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
