// 网页录音走 getUserMedia + MediaRecorder。iOS「添加到主屏幕」的 standalone 容器
// 历史上不放开麦克风，Safari 标签页和外嵌 WebView 的行为也不一致，所以调用方必须
// 保留「选录音文件」这条回退路径：文件选择器在任何环境都能用，用户用系统语音备忘录
// 录完再选进来。
export interface LiveRecording {
  stop: () => Promise<{ blob: Blob; durationMs: number }>;
  cancel: () => void;
}

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return MIME_CANDIDATES.find(m => MediaRecorder.isTypeSupported(m)) ?? '';
}

export function canRecordLive(): boolean {
  return window.isSecureContext
    && typeof MediaRecorder !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia;
}

export async function startLiveRecording(): Promise<{ recording?: LiveRecording; error?: string }> {
  if (!window.isSecureContext) return { error: '当前不是安全上下文，浏览器不允许调用麦克风' };
  if (!canRecordLive()) return { error: '当前浏览器不支持网页录音，请用「选录音文件」导入' };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    const name = (e as DOMException)?.name ?? '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      return { error: '麦克风权限被拒绝。手机上请到系统设置里给本应用放开麦克风，或用「选录音文件」导入。' };
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
      return { error: '没有检测到可用麦克风' };
    }
    return { error: '麦克风打开失败，请重试或用「选录音文件」导入' };
  }

  let recorder: MediaRecorder;
  try {
    const mime = pickMime();
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  } catch {
    stream.getTracks().forEach(t => t.stop());
    return { error: '当前浏览器不支持任何录音编码格式' };
  }

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

  const release = () => stream.getTracks().forEach(t => t.stop());
  const startedAt = Date.now();

  // timeslice 让 Safari 在长时间录音里也能持续吐出数据；只用 onstop 收流的写法在
  // 部分 iOS 版本上会得到空 Blob。
  recorder.start(250);

  return {
    recording: {
      stop: () => new Promise((resolve, reject) => {
        recorder.onstop = () => {
          release();
          resolve({ blob: new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }), durationMs: Date.now() - startedAt });
        };
        recorder.onerror = () => {
          release();
          reject(new Error('录音中断'));
        };
        recorder.stop();
      }),
      cancel: () => {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* 已经停掉就无需处理 */ }
        release();
      },
    },
  };
}
