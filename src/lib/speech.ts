let cachedVoices: SpeechSynthesisVoice[] = [];
let voicesLoaded = false;

function loadVoices(): void {
  if (!('speechSynthesis' in window)) return;
  cachedVoices = window.speechSynthesis.getVoices();
  if (cachedVoices.length) voicesLoaded = true;
}

export function initSpeech(): void {
  if (!('speechSynthesis' in window)) return;
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

function thaiVoice(): SpeechSynthesisVoice | null {
  if (!voicesLoaded) loadVoices();
  return cachedVoices.find(v => v.lang?.toLowerCase().startsWith('th')) ?? null;
}

export function isSpeechAvailable(): boolean {
  return 'speechSynthesis' in window;
}

export function hasThaiVoice(): boolean {
  return thaiVoice() !== null;
}

export function speakThai(text: string): { ok: boolean; reason?: string } {
  if (!isSpeechAvailable()) return { ok: false, reason: '当前浏览器不支持语音合成' };
  if (!text.trim()) return { ok: false, reason: '没有可朗读的内容' };

  const synth = window.speechSynthesis;
  const voice = thaiVoice();
  if (!voice) return { ok: false, reason: '设备未安装泰语语音包' };

  synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.voice = voice;
  utter.lang = voice.lang;
  utter.rate = 0.8;
  utter.pitch = 1;
  synth.speak(utter);
  return { ok: true };
}

export function speakWithFallback(thai: string, example: string): { ok: boolean; reason?: string } {
  const primary = speakThai(thai);
  if (primary.ok && example.trim()) {
    const synth = window.speechSynthesis;
    const voice = thaiVoice();
    if (voice) {
      const utter = new SpeechSynthesisUtterance(example);
      utter.voice = voice;
      utter.lang = voice.lang;
      utter.rate = 0.8;
      synth.speak(utter);
    }
  }
  return primary;
}
