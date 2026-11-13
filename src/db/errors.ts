import { db, type ErrorRecord, type StubbornWord, getStubbornThreshold, todayStr } from './index';

export async function addErrorRecord(
  wordId: number,
  errorType: string,
  question: string,
  userAnswer: string,
  correctAnswer: string,
  trackStubborn: boolean = true
): Promise<void> {
  const record: ErrorRecord = {
    wordId,
    errorType,
    question,
    userAnswer,
    correctAnswer,
    timestamp: Date.now(),
    date: todayStr(),
  };
  await db.errorRecords.add(record);
  if (trackStubborn && wordId > 0) {
    await updateStubbornWord(wordId);
  }
}

export async function getTodayErrors(): Promise<ErrorRecord[]> {
  const today = todayStr();
  return await db.errorRecords.where('date').equals(today).reverse().sortBy('timestamp');
}

export async function getWordErrors(wordId: number): Promise<ErrorRecord[]> {
  return await db.errorRecords.where('wordId').equals(wordId).reverse().sortBy('timestamp');
}

export async function getWordErrorCount(wordId: number): Promise<number> {
  return await db.errorRecords.where('wordId').equals(wordId).count();
}

async function updateStubbornWord(wordId: number): Promise<void> {
  const threshold = await getStubbornThreshold();
  const count = await getWordErrorCount(wordId);

  if (count >= threshold) {
    const existing = await db.stubbornWords.get(wordId);
    if (!existing) {
      const stubborn: StubbornWord = {
        wordId,
        errorCount: count,
        addedAt: Date.now(),
        mastered: 0,
      };
      await db.stubbornWords.add(stubborn);
    } else {
      await db.stubbornWords.update(wordId, { errorCount: count });
    }
  }
}

export async function getStubbornWords(): Promise<StubbornWord[]> {
  return await db.stubbornWords.where('mastered').equals(0).toArray();
}

export async function getStubbornWordIds(): Promise<number[]> {
  const stubborn = await getStubbornWords();
  return stubborn.map(s => s.wordId);
}

export async function markStubbornMastered(wordId: number): Promise<void> {
  await db.stubbornWords.update(wordId, { mastered: 1 });
}

export async function getStubbornCount(): Promise<number> {
  return await db.stubbornWords.where('mastered').equals(0).count();
}

export async function getTodayErrorCount(): Promise<number> {
  const today = todayStr();
  return await db.errorRecords.where('date').equals(today).count();
}

export async function clearTodayErrors(): Promise<void> {
  const today = todayStr();
  await db.errorRecords.where('date').equals(today).delete();
}
