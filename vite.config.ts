import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';

export default defineConfig({
  server: {
    open: true,
    host: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    target: 'ES2022',
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'data/*.json'],
      manifest: {
        name: '萨瓦迪卡·泰语学习',
        short_name: '泰语学习',
        description: '中文母语者的泰语学习工具，间隔复习 + 声调训练',
        // theme_color 对齐顶栏起始色，background_color 对齐页面底色（决定启动闪屏颜色）
        theme_color: '#d97b29',
        background_color: '#fffaf0',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'zh-CN',
        categories: ['education'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          // maskable 单独一张：主体缩到 86% 居中，圆形/方形遮罩都不会裁到人物
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,json,png,svg,woff2}'],
        // 全局字体 woff2 约 2.3MB，超出默认 2MiB 预缓存上限，放宽以支持离线可用
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // 全站资源已本地化，离线时任意路径导航都回落到已预缓存的 index.html
        navigateFallback: 'index.html',
      },
    }),
  ],
});
