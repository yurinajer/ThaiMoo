# 🚀 快速开始指南

## 第一步：安装 Node.js

你的系统目前没有安装 Node.js，需要先安装才能构建项目。

### 方法一：官网下载（推荐）

1. 访问 https://nodejs.org/
2. 下载 **LTS 版本**（长期支持版），当前推荐 v20.x 或 v22.x
3. 运行安装程序，一路"下一步"即可
4. 安装完成后，打开命令提示符（CMD）或 PowerShell，输入：
   ```bash
   node --version
   npm --version
   ```
   如果显示版本号，说明安装成功

### 方法二：使用 winget（Windows 10/11 自带）

打开 PowerShell，运行：
```powershell
winget install OpenJS.NodeJS.LTS
```

### 方法三：使用 Chocolatey

如果你已安装 Chocolatey：
```powershell
choco install nodejs-lts
```

## 第二步：安装项目依赖

打开命令提示符或 PowerShell，进入项目目录：

```bash
cd "C:\Users\86186\Documents\Qoder\2026-11-07\1b422ce1\thai-learn"
npm install
```

这会安装所有必需的依赖包（dexie、ts-fsrs、vite 等），大约需要 1-2 分钟。

## 第三步：启动开发服务器

```bash
npm run dev
```

启动后，终端会显示类似这样的信息：
```
  VITE v6.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

在浏览器中打开 **http://localhost:5173/** 即可看到应用。

## 第四步：构建生产版本

当你准备部署或离线使用时：

```bash
npm run build
```

构建完成后，所有文件会在 `dist/` 目录中。你可以：

### 本地预览构建结果
```bash
npm run preview
```

### 部署到 GitHub Pages
1. 将 `dist/` 目录的内容推送到仓库的 `gh-pages` 分支
2. 在 GitHub 仓库设置中启用 Pages

### 部署到 Cloudflare Pages
1. 连接 GitHub 仓库到 Cloudflare Pages
2. 设置构建命令：`npm run build`
3. 设置输出目录：`dist`

## 第五步：复制到 D 盘（可选）

如果你想把项目移到 D 盘以节省 C 盘空间：

```bash
# 复制整个项目到 D 盘
xcopy "C:\Users\86186\Documents\Qoder\2026-11-07\1b422ce1\thai-learn" "D:\thai-learn" /E /I /H

# 然后在 D 盘运行
cd D:\thai-learn
npm install
npm run dev
```

## 📱 添加到手机主屏幕

### Android (Chrome)
1. 用手机浏览器打开应用网址
2. 点击菜单 → "添加到主屏幕"
3. 确认后即可像普通 App 一样使用

### iOS (Safari)
1. 用 Safari 打开应用网址
2. 点击底部分享按钮
3. 选择"添加到主屏幕"

## 🔧 常见问题

### Q: npm install 失败怎么办？
A: 
- 检查网络连接
- 尝试使用淘宝镜像：`npm config set registry https://registry.npmmirror.com`
- 删除 `node_modules` 文件夹后重新运行 `npm install`

### Q: 端口 5173 被占用怎么办？
A: Vite 会自动使用下一个可用端口（5174、5175 等），终端会显示实际使用的端口

### Q: 修改代码后需要重新构建吗？
A: 开发模式下（`npm run dev`）不需要，Vite 会自动热更新。只有准备部署时才需要 `npm run build`

### Q: 数据会丢失吗？
A: 数据存储在浏览器的 IndexedDB 中，清除浏览器数据会丢失。建议定期导出词库（CSV）

### Q: 可以离线使用吗？
A: 可以！首次访问后，PWA 会缓存所有资源，之后即使没有网络也能正常使用

## 📂 项目文件说明

```
thai-learn/
├── public/data/          # 泰语规则数据（可编辑的 JSON 文件）
│   ├── consonants.json       # 44个辅音分类表
│   ├── tone-rules.json       # 声调推导规则
│   ├── spelling-rules.json   # 拼写-读音对照规则
│   └── grammar-points.json   # 语法知识点
├── src/                  # 源代码
│   ├── pages/                # 各个页面
│   ├── db/                   # 数据库操作
│   ├── lib/                  # 工具库
│   └── components/           # UI 组件
└── dist/                 # 构建输出（部署用）
```

## 🎨 自定义内容

### 修改泰语规则
直接编辑 `public/data/` 下的 JSON 文件，然后重新构建。

### 修改主题颜色
编辑 `src/styles/variables.css` 中的 `--orange-400` 等变量。

### 添加新的语法知识点
编辑 `public/data/grammar-points.json`，按照现有格式添加新的条目。

---

**祝你学习愉快！🍊🐕**

如有问题，请查看 README.md 获取更多详细信息。
