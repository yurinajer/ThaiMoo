import { speakThai, isSpeechAvailable } from '../lib/speech';
import { canRecordLive, startLiveRecording, type LiveRecording } from '../lib/recorder';
import { getClipsForWord, addClip, deleteClip, type VoiceClip } from '../db/voiceClips';
import { showError, showSuccess } from './toast';

// 比这更短的基本是误触，存下来只会占存储又听不出内容。
const MIN_CLIP_MS = 400;

export interface AudioBarHandle {
  destroy: () => void;
}

function clock(ms?: number): string {
  if (!ms || ms < 0) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function stamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function mountAudioBar(
  host: HTMLElement,
  wordId: number,
  thai: string,
  opts: { speak?: boolean } = {}
): AudioBarHandle {
  // 只加自己的类：直接赋 className 会把调用方的容器类（复习页的布局钩子）一起抹掉。
  host.classList.add('audio-bar');

  let live: LiveRecording | null = null;
  let tickTimer = 0;
  let player: HTMLAudioElement | null = null;
  let playerUrl = '';
  let playingId: number | null = null;

  function renderActions(): void {
    const recording = !!live;
    host.innerHTML = `
      <div class="audio-bar-actions">
        ${opts.speak && isSpeechAvailable() ? '<button class="btn btn-sm btn-outline ab-speak">朗读</button>' : ''}
        ${canRecordLive() ? `<button class="btn btn-sm ${recording ? 'btn-danger' : 'btn-secondary'} ab-record">${recording ? '停止' : '跟读录音'}</button>` : ''}
        ${recording ? '<button class="btn btn-sm btn-outline ab-cancel">取消</button>' : ''}
        <button class="btn btn-sm btn-outline ab-file">选录音文件</button>
        <span class="audio-bar-status">${recording ? '录音中 0:00' : ''}</span>
      </div>
      <input type="file" accept="audio/*" class="ab-file-input" hidden />
      <div class="audio-bar-clips"><p class="audio-bar-empty">录音加载中...</p></div>
    `;

    host.querySelector('.ab-speak')?.addEventListener('click', () => {
      const result = speakThai(thai);
      if (!result.ok) showError(result.reason || '朗读失败');
    });
    host.querySelector('.ab-record')?.addEventListener('click', toggleRecord);
    host.querySelector('.ab-cancel')?.addEventListener('click', () => { stopTick(); live?.cancel(); live = null; renderActions(); renderClips(); });
    host.querySelector('.ab-file')!.addEventListener('click', () => (host.querySelector('.ab-file-input') as HTMLInputElement).click());
    host.querySelector('.ab-file-input')!.addEventListener('change', onPickFile);

    void renderClips();
  }

  function stopTick(): void {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = 0;
  }

  async function toggleRecord(): Promise<void> {
    if (live) {
      const recording = live;
      stopTick();
      live = null;
      renderActions();
      renderClips();
      try {
        const { blob, durationMs } = await recording.stop();
        if (durationMs < MIN_CLIP_MS || blob.size === 0) {
          showError('录音太短，没有保存');
          return;
        }
        await addClip(wordId, blob, durationMs);
        showSuccess(`已保存录音 ${clock(durationMs)}`);
        renderClips();
      } catch {
        showError('录音中断，请重试');
      }
      return;
    }

    const status = host.querySelector('.audio-bar-status');
    if (status) status.textContent = '正在申请麦克风...';
    const { recording, error } = await startLiveRecording();
    if (!recording) {
      showError(error || '录音启动失败');
      renderActions();
      return;
    }
    live = recording;
    const startedAt = Date.now();
    renderActions();
    tickTimer = setInterval(() => {
      const cell = host.querySelector('.audio-bar-status');
      if (cell) cell.textContent = `录音中 ${clock(Date.now() - startedAt)}`;
    }, 200);
  }

  async function onPickFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      showError('选中的不是音频文件');
      return;
    }
    await addClip(wordId, file);
    showSuccess('录音已导入');
    renderClips();
  }

  async function renderClips(): Promise<void> {
    const clips = await getClipsForWord(wordId);
    const box = host.querySelector('.audio-bar-clips') as HTMLElement;
    if (!box.isConnected) return;

    if (clips.length === 0) {
      box.innerHTML = `<p class="audio-bar-empty">还没有录音。跟着朗读录一段，或用「选录音文件」导入系统录音。</p>`;
      return;
    }

    box.innerHTML = clips.map(c => `
      <div class="clip-row" data-clip="${c.id}">
        <button class="btn btn-sm btn-outline clip-play">${playingId === c.id ? '停止' : '播放'}</button>
        <span class="clip-meta">${clock(c.durationMs) ? `${clock(c.durationMs)} · ` : ''}${stamp(c.createdAt)}</span>
        <button class="btn btn-icon clip-del" title="删除该录音" style="color:var(--red-400);">✕</button>
      </div>
    `).join('');
  }

  host.addEventListener('click', async (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.clip-row');
    if (!row) return;
    const id = Number(row.dataset.clip);
    if ((e.target as HTMLElement).closest('.clip-del')) {
      await deleteClip(id);
      if (playingId === id) stopPlayback();
      renderClips();
      return;
    }
    if ((e.target as HTMLElement).closest('.clip-play')) {
      const clips = await getClipsForWord(wordId);
      const clip = clips.find(c => c.id === id);
      if (!clip) return;
      if (playingId === id) { stopPlayback(); renderClips(); return; }
      play(clip);
    }
  });

  function play(clip: VoiceClip): void {
    stopPlayback();
    playerUrl = URL.createObjectURL(clip.blob);
    player = new Audio(playerUrl);
    playingId = clip.id!;
    player.onended = () => { stopPlayback(); renderClips(); };
    void player.play().catch(() => { stopPlayback(); showError('这条录音播放失败，可能已损坏'); renderClips(); });
    renderClips();
  }

  function stopPlayback(): void {
    if (player) { player.pause(); player = null; }
    if (playerUrl) { URL.revokeObjectURL(playerUrl); playerUrl = ''; }
    playingId = null;
  }

  renderActions();

  return {
    destroy: () => {
      stopTick();
      live?.cancel();
      live = null;
      stopPlayback();
      host.innerHTML = '';
    },
  };
}
