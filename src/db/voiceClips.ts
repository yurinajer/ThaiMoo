import { db, type VoiceClip } from './index';
import { blobToBase64, base64ToBlob } from '../lib/base64';
export type { VoiceClip } from './index';

// JSON 备份里不能直接放 Blob（序列化会变成 {}），所以导出时转 base64。
export interface VoiceClipBackup {
  id: number;
  wordId: number;
  mime: string;
  durationMs?: number;
  createdAt: number;
  data: string;
}

export async function getClipsForWord(wordId: number): Promise<VoiceClip[]> {
  return await db.voiceClips.where('wordId').equals(wordId).sortBy('createdAt');
}

export async function addClip(
  wordId: number,
  blob: Blob,
  durationMs?: number
): Promise<number> {
  return await db.voiceClips.add({
    wordId,
    blob,
    mime: blob.type || 'audio/webm',
    durationMs,
    createdAt: Date.now(),
  });
}

export async function deleteClip(id: number): Promise<void> {
  await db.voiceClips.delete(id);
}

export async function encodeClipsForBackup(): Promise<VoiceClipBackup[]> {
  const clips = await db.voiceClips.toArray();
  const rows: VoiceClipBackup[] = [];
  for (const clip of clips) {
    rows.push({
      id: clip.id as number,
      wordId: clip.wordId,
      mime: clip.mime,
      durationMs: clip.durationMs,
      createdAt: clip.createdAt,
      data: await blobToBase64(clip.blob),
    });
  }
  return rows;
}

// 恢复走 bulkPut 而不是 clear + bulkAdd：表里可能有这份备份之后新录的内容，
// 清空会把它们一起带走；按 id 覆盖既能还原备份里的录音，也不动多余的行。
// 单条解不开就跳过，不能让一段坏录音拖垮整份恢复。
export function decodeClipsForRestore(payload: unknown): VoiceClip[] {
  if (!Array.isArray(payload)) return [];
  const rows: VoiceClip[] = [];
  for (const raw of payload as Partial<VoiceClipBackup>[]) {
    if (!raw || typeof raw.data !== 'string' || typeof raw.wordId !== 'number' || typeof raw.createdAt !== 'number') continue;
    const mime = raw.mime || 'audio/webm';
    let blob: Blob;
    try {
      blob = base64ToBlob(raw.data, mime);
    } catch {
      continue;
    }
    rows.push({
      id: typeof raw.id === 'number' ? raw.id : undefined,
      wordId: raw.wordId,
      blob,
      mime,
      durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : undefined,
      createdAt: raw.createdAt,
    });
  }
  return rows;
}
