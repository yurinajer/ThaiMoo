import { speakThai, isSpeechAvailable } from '../lib/speech';
import { showError } from './toast';

// 卡面右上角的朗读小喇叭。按钮画在卡片内部，跟着当前词条一起换；
// 语音本身还是 lib/speech 的 speakThai，这里只管图标和发声反馈。
const SPEAK_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5v5h3.5L13 18V6L7.5 9.5H4z"/><path d="M16 9.5a3.4 3.4 0 0 1 0 5"/><path d="M18.6 7a7 7 0 0 1 0 10"/></svg>`;

// 纯字符串拼接，不碰 window，方便默写页用导出的 HTML 函数直接断言。
export function speakButtonHtml(): string {
  return `<button class="card-speak" type="button" aria-label="朗读该单词">${SPEAK_ICON}</button>`;
}

export function bindSpeakButton(host: HTMLElement, thai: string): void {
  const btn = host.querySelector<HTMLButtonElement>('.card-speak');
  if (!btn) return;
  if (!isSpeechAvailable()) {
    btn.remove();
    return;
  }

  // 连点会 cancel 掉上一句，上一句的 onend 却晚于这一句开始才回来，
  // 所以用世代号只认最后一次点击的收尾，避免高亮被前一句提前灭掉。
  let generation = 0;
  const stop = (token: number) => {
    if (token === generation) btn.classList.remove('speaking');
  };

  btn.addEventListener('click', (e) => {
    // 卡片整体是翻面热区，喇叭只朗读，不能让点图标变成翻卡。
    e.stopPropagation();
    const token = generation + 1;
    const result = speakThai(thai, () => stop(token));
    // 读失败就不换代：上一句还在响时，它的灭灯回调不能被这次点击顶掉。
    if (!result.ok) {
      showError(result.reason || '朗读失败');
      return;
    }
    generation = token;
    btn.classList.add('speaking');
    // 被打断时浏览器不一定补发 onend，兜底灭灯，省得高亮一直挂着。
    setTimeout(() => stop(token), 8000);
  });
}
