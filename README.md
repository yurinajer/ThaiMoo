# 🍊 萨瓦迪卡·泰语学习

一款专为中文母语者设计的泰语学习 PWA（渐进式网页应用），支持离线使用，可添加到手机主屏幕。

## ✨ 功能特色

### 核心功能
- **📚 词库管理**：手动添加单词、CSV 批量导入/导出、自动查重
- **✏️ 间隔复习**：基于 ts-fsrs 算法的智能复习调度
- **📕 错词本**：自动收集今日错词，累计错误≥3次进入顽固词
- **📊 进度面板**：连续打卡天数、累计词汇、复习统计

### 专项训练
- **🎵 声调规则训练**：看泰文选声调，展示完整推导步骤（辅音类别→元音长短→尾音→声调符号→结果）
- **🔤 辅音分类**：高/中/低辅音卡片浏览与测验
- **📝 拼写读音对照**：不发音字母、尾辅音转换规则学习
- **👂 长短音辨析**：形近词对比练习，支持自定义对比组
- **📖 语法句型**：语序、ไหม、ไม่、แล้ว、จะ、量词等知识点
- **💬 口语吞音笔记**：记录泰国人口语中的吞音、连读现象
- **📚 参考词库**：内置基础词汇，可搜索并手动加入学习

## 🛠️ 技术栈

- **纯前端**：HTML + CSS + TypeScript
- **构建工具**：Vite
- **存储**：IndexedDB (Dexie.js)
- **间隔复习**：ts-fsrs
- **PWA**：vite-plugin-pwa
- **样式**：纯 CSS（橘色主题 #ffb06b）

## 📦 安装与运行

### 前置要求

1. **安装 Node.js**（v18 或更高版本）
   - 下载地址：https://nodejs.org/
   - Windows : 选择 "Windows Installer (.js)" 
   - macOS：选择 "macOS Installer (.pkg)"
   - Linux：使用包管理器或从源码编译

2. **验证安装**
   ```bash
   node --version  # 应显示 v18.x.x 或更高
   npm --version   # 应显示 9.x.x 或更高
   ```

### 安装步骤

```bash
# 1. 进入项目目录
cd thai-learn

# 2. 安装依赖
npm install

# 3. 启动开发服务器
npm run dev

# 4. 在浏览器中打开 http://localhost:5173
```

### 构建生产版本

```bash
# 构建
npm run build

# 预览构建结果
npm run preview

# 构建产物在 dist/ 目录
```

## 📱 PWA 使用说明

### 添加到主屏幕

**Android (Chrome)**：
1. 打开应用网址
2. 点击浏览器菜单（右上角三个点）
3. 选择"添加到主屏幕"或"安装应用"

**iOS (Safari)**：
1. 打开应用网址
2. 点击底部分享按钮（方框+向上箭头）
3. 选择"添加到主屏幕"

### 离线使用

首次访问后，应用会缓存所有资源，之后即使没有网络也能正常使用。

## 📂 项目结构

```
thai-learn/
├── index.html              # 入口页面
├── package.json            # 项目配置
├── vite.config.ts          # Vite 构建配置
├── tsconfig.json           # TypeScript 配置
├── public/
│   ├── icons/              # PWA 图标
│   └── data/               # 泰语规则数据（JSON）
│       ├── consonants.json     # 44个辅音分类
│       ├── tone-rules.json     # 声调规则
│       ├── spelling-rules.json # 拼读规则
│       └── grammar-points.json # 语法知识点
├── src/
│   ├── main.ts             # 入口
│   ├── router.ts           # SPA 路由
│   ├── styles/             # 样式文件
│   ├── db/                 # IndexedDB 数据层
│   ├── lib/                # 工具库
│   ├── pages/              # 页面组件
│   └── components/         # UI 组件
└── dist/                   # 构建输出
```

## 🎨 自定义泰语规则

所有泰语规则数据都存放在 `public/data/` 目录下的 JSON 文件中，你可以直接编辑这些文件来：

- 修正辅音分类
- 调整声调规则
- 添加拼读对照规则
- 修改语法知识点

修改后重新构建即可生效。

## 🚀 部署

### GitHub Pages

```bash
# 1. 构建
npm run build

# 2. 将 dist/ 目录推送到 gh-pages 分支
git subtree push --prefix dist origin gh-pages

# 3. 在 GitHub 仓库设置中启用 Pages
```

### Cloudflare Pages

1. 连接 GitHub 仓库
2. 设置构建命令：`npm run build`
3. 设置输出目录：`dist`
4. 部署

### 本地静态服务器

```bash
# 使用 Python
cd dist && python3 -m http.server 8080

# 使用 Node.js
npx serve dist
```

## 📝 数据备份

所有数据存储在浏览器 IndexedDB 中，清除浏览器数据会丢失所有学习记录。

**备份方法**：
- 词库：在词库页面点击"导出 CSV"
- 其他数据：暂不支持导出，建议定期截图保存进度

## 🐛 已知问题

- 首次加载可能较慢（需要缓存资源）
- iOS Safari 的 PWA 支持有限制，部分功能可能无法使用
- 数据不跨设备同步

## 📄 许可证

MIT License

## 🙏 致谢

- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) - 间隔重复算法
- [Dexie.js](https://dexie.org/) - IndexedDB 封装库
- [Vite](https://vitejs.dev/) - 构建工具

---

**开始你的泰语学习之旅吧！🍊🐕**
