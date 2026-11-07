import { createElement } from '../lib/utils';
import { navigateTo } from '../router';

export function renderMorePage(container: HTMLElement): void {
  const header = createElement('div', { className: 'page-header' });
  header.innerHTML = `<h1>🍊 更多功能</h1>`;
  container.appendChild(header);

  const content = createElement('div', { className: 'page-content' });
  container.appendChild(content);

  const modules = [
    { icon: '🎵', name: '声调规则训练', desc: '看泰文选声调，展示推导步骤', route: '/tone-training' },
    { icon: '🔤', name: '辅音分类', desc: '高/中/低辅音卡片与测验', route: '/consonants' },
    { icon: '📝', name: '拼写读音对照', desc: '不发音字母、尾辅音转换', route: '/spelling' },
    { icon: '👂', name: '长短音辨析', desc: '形近词对比练习', route: '/minimal-pairs' },
    { icon: '📖', name: '语法句型', desc: '语序、ไหม、ไม่、แล้ว等', route: '/grammar' },
    { icon: '💬', name: '口语吞音笔记', desc: '记录口语变形', route: '/colloquial' },
    { icon: '📕', name: '错词本', desc: '今日错词与顽固词', route: '/error-book' },
    { icon: '📚', name: '参考词库', desc: '搜索参考词，手动加入学习', route: '/reference' },
  ];

  content.innerHTML = `
    <div class="section animate-fade-in">
      ${modules.map((m, i) => `
        <div class="card module-item" data-route="${m.route}" style="cursor:pointer; margin-bottom:8px; display:flex; align-items:center; gap:16px; animation-delay:${i * 0.05}s;">
          <span style="font-size:1.8rem;">${m.icon}</span>
          <div style="flex:1;">
            <div style="font-weight:600; font-size:0.95rem;">${m.name}</div>
            <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">${m.desc}</div>
          </div>
          <span style="color:var(--text-muted); font-size:1.2rem;">›</span>
        </div>
      `).join('')}
    </div>
  `;

  content.querySelectorAll('.module-item').forEach(item => {
    item.addEventListener('click', () => {
      const route = item.getAttribute('data-route');
      if (route) navigateTo(route);
    });
  });
}
