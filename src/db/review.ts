import { db, type ReviewState, todayStr, getOrCreateDailyStat } from './index';
import { createEmptyCard, type Card, type Grade, State } from 'ts-fsrs';

export async function getReviewState(wordId: number): Promise<ReviewState | undefined> {
  return await db.reviewStates.get(wordId);
}

export async function getAllReviewStates(): Promise<ReviewState[]> {
  return await db.reviewStates.toArray();
}

export async function getDueReviewStates(): Promise<ReviewState[]> {
  const now = Date.now();
  return await db.reviewStates.where('nextReview').belowOrEqual(now).toArray();
}

export async function getNewWordsWithoutReview(count?: number): Promise<number[]> {
  const allStates = await db.reviewStates.toArray();
  const reviewedIds = new Set(allStates.map(s => s.wordId));

  const allWords = await db.words.toArray();
  const newWordIds = allWords
    .filter(w => w.id !== undefined && !reviewedIds.has(w.id))
    .map(w => w.id!);

  if (count !== undefined) {
    return newWordIds.slice(0, count);
  }
  return newWordIds;
}

export async function getTodayNewWordCount(): Promise<number> {
  const stat = await getOrCreateDailyStat();
  return stat.newWords;
}

export async function getTodayReviewCount(): Promise<number> {
  const stat = await getOrCreateDailyStat();
  return stat.reviewsDone;
}

function reviewStateToCard(state: ReviewState): Card {
  return {
    due: new Date(state.nextReview),
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: state.reps,
    lapses: state.lapses,
    state: state.state as State,
    last_review: state.lastReview ? new Date(state.lastReview) : undefined,
  };
}

function cardToReviewState(wordId: number, card: Card): ReviewState {
  return {
    wordId,
    difficulty: card.difficulty,
    stability: card.stability,
    reps: card.reps,
    lapses: card.lapses,
    lastReview: card.last_review?.getTime() || Date.now(),
    nextReview: card.due.getTime(),
    state: card.state as number,
  };
}

export async function gradeReview(wordId: number, grade: Grade): Promise<{ card: Card; nextDue: Date }> {
  const { FSRS } = await import('ts-fsrs');
  const fsrs = new FSRS({});
  const state = await getReviewState(wordId);

  let card: Card;
  if (!state) {
    card = createEmptyCard();
  } else {
    card = reviewStateToCard(state);
  }

  const now = new Date();
  const schedulingCards = fsrs.repeat(card, now);
  const newCard = schedulingCards[grade].card;

  const newState = cardToReviewState(wordId, newCard);
  await db.reviewStates.put(newState);

  const stat = await getOrCreateDailyStat();
  stat.reviewsDone++;
  await db.dailyStats.put(stat);

  return {
    card: newCard,
    nextDue: newCard.due,
  };
}

export async function initNewWordReview(wordId: number): Promise<void> {
  const existing = await getReviewState(wordId);
  if (existing) return;

  const card = createEmptyCard();
  const state = cardToReviewState(wordId, card);
  await db.reviewStates.put(state);

  const stat = await getOrCreateDailyStat();
  stat.newWords++;
  await db.dailyStats.put(stat);
}

export async function getDueCount(): Promise<number> {
  const due = await getDueReviewStates();
  return due.length;
}

export async function getNewWordCount(): Promise<number> {
  const newWords = await getNewWordsWithoutReview();
  return newWords.length;
}
