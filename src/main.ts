import './styles/main.css';
import './styles/components.css';
import './styles/polka-transparent-cards.css';
import { initRouter } from './router';

document.addEventListener('DOMContentLoaded', () => {
  initRouter();
  // 申请持久化存储，降低手机系统在存储压力下清掉本地学习数据的概率。
  // 只影响浏览器保留策略，不读写 IndexedDB；被拒绝时保持默认的 best-effort 行为。
  void navigator.storage?.persist?.().catch(() => undefined);
});
