import { escapeHtml, toneTagsHtml } from '../lib/utils';
import { getWord, type Word } from '../db/vocabulary';
import { speakThai, isSpeechAvailable } from '../lib/speech';
import { mountAudioBar, type AudioBarHandle } from './audio-bar';
import { showError } from './toast';

export interface WordDetailOptions {
  extraHtml?: string;
  onEdit?: (word: Word) => void;
}

// 同一时刻只有一个详情抽屉，但抽屉可能被直接顶掉而不走 close()，
// 所以把手放在模块级，保证麦克风和播放器随时收得回来。
let activeBar: AudioBarHandle | null = null;

function row(label: string, valueHtml: string): string {
  return `
    <div class="detail-row">
      <div class="detail-label">${escapeHtml(label)}</div>
      <div class="detail-value">${valueHtml}</div>
    </div>
  `;
}

function empty(text: string): string {
  return `<span class="detail-empty">${escapeHtml(text)}</span>`;
}

function buildBody(word: Word, opts: WordDetailOptions): string {
  const roman = (word.romanization ?? '').trim();
  const tone = toneTagsHtml(word.toneMark, true);
  const pos = (word.pos ?? '').trim();
  const example = (word.example ?? '').trim();
  const exampleRoman = (word.exampleRoman ?? '').trim();
  const exampleMeaning = (word.exampleMeaning ?? '').trim();
  const note = (word.note ?? '').trim();
  const tags = Array.isArray(word.tags) ? word.tags.filter(Boolean) : [];

  const speakBtn = isSpeechAvailable()
    ? `<button class="btn btn-sm btn-outline detail-speak" id="btn-speak" aria-label="朗读泰语">🔊 朗读</button>`
    : '';

  const exampleBlock = example
    ? `
      <div class="detail-example">
        <div class="detail-example-thai">${escapeHtml(example)}</div>
        ${exampleRoman ? `<div class="detail-example-roman">${escapeHtml(exampleRoman)}</div>` : ''}
        ${exampleMeaning ? `<div class="detail-example-cn">${escapeHtml(exampleMeaning)}</div>` : ''}
      </div>
    `
    : empty('暂无例句');

  return `
    <div class="detail-head">
      <div class="detail-head-main">
        <div class="detail-thai">${escapeHtml(word.thai)}</div>
        <div class="detail-meaning">${escapeHtml(word.meaning)}</div>
      </div>
      ${speakBtn}
    </div>

    ${word.id ? `<div id="wd-audio"></div>` : ''}

    ${row('罗马音', roman ? `<span class="detail-roman">${escapeHtml(roman)}</span>` : empty('未填写，可在编辑中补充'))}

    ${row('声调', tone || empty('未标注'))}

    ${row('词性', pos ? `<span class="chip">${escapeHtml(pos)}</span>` : empty('未填写'))}

    ${row('例句', exampleBlock)}

    ${row('备注', note ? escapeHtml(note) : empty('无'))}

    ${row('标签', tags.length
      ? tags.map(t => `<span class="chip">${escapeHtml(t)}</span>`).join(' ')
      : empty('无'))}

    ${opts.onEdit ? `<button class="btn btn-secondary btn-block" id="btn-detail-edit" style="margin-top:16px;">编辑该单词</button>` : ''}

    ${opts.extraHtml ? `<div class="detail-extra">${opts.extraHtml}</div>` : ''}
  `;
}

export function showWordDetail(word: Word, opts: WordDetailOptions = {}): void {
  const previous = document.querySelector('.sheet-overlay');
  if (previous) previous.remove();
  // 上一个抽屉被直接顶掉时没走 close()，麦克风和播放器也得收掉。
  activeBar?.destroy();
  activeBar = null;

  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="单词详情">
      <div class="sheet-header">
        <div class="sheet-handle"></div>
        <h2>单词详情</h2>
        <button class="modal-close" aria-label="关闭">&times;</button>
      </div>
      <div class="sheet-body">${buildBody(word, opts)}</div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => {
    activeBar?.destroy();
    activeBar = null;
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 180);
  };

  const audioHost = overlay.querySelector('#wd-audio');
  if (audioHost instanceof HTMLElement && word.id) {
    activeBar = mountAudioBar(audioHost, word.id, word.thai);
  }

  overlay.querySelector('.modal-close')!.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.querySelector('#btn-speak')?.addEventListener('click', () => {
    const result = speakThai(word.thai);
    if (!result.ok) showError(result.reason || '朗读失败');
  });

  overlay.querySelector('#btn-detail-edit')?.addEventListener('click', () => {
    close();
    opts.onEdit?.(word);
  });
}

export async function showWordDetailById(
  wordId: number,
  opts: WordDetailOptions = {}
): Promise<boolean> {
  if (!wordId || wordId <= 0) return false;
  const word = await getWord(wordId);
  if (!word) return false;
  showWordDetail(word, opts);
  return true;
}
