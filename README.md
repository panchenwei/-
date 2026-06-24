# IELTS 同义词专项训练网页

这是一个本地可直接打开的静态网页项目，用来练习《雅思阅读同义词专项训练》`List 1-20` 的全部内容。

## 功能

- 20 个章节完整展示
- `Paraphrases` 按词汇脉络卡片化展示
- `Matching Practice` 改为拖拽配对
- `Choices` 保持单选题
- `Test Yourself` 改为全量拖拽归类
- 每个大题都有独立 `Check` 按钮
- 错题会立即显示正确答案
- 左侧导航栏可折叠
- 设置面板支持按章节清空重做
- 作答进度自动保存在浏览器本地

## 打开方式

直接双击打开：

- `index.html`

也可以在 PowerShell 中运行：

```powershell
Start-Process ".\index.html"
```

## GitHub Pages

这个仓库已经补好了 GitHub Pages 所需文件：

- `.nojekyll`
- `.github/workflows/pages.yml`

推送到 `main` 后，可以在 GitHub 仓库里这样开启：

1. 打开仓库 `Settings`
2. 进入 `Pages`
3. 在 `Build and deployment` 里把 `Source` 设为 `GitHub Actions`

启用后，站点地址通常是：

```text
https://panchenwei.github.io/-/
```

## 项目结构

```text
ielts-synonyms-web/
├─ index.html
├─ styles.css
├─ app.js
├─ data/
│  ├─ chapters.json
│  └─ chapters.js
└─ scripts/
   └─ parse-markdown.js
```

## 重新生成题库数据

这个项目当前已经自带生成好的 `data/chapters.json` 和 `data/chapters.js`。

如果你想根据原始资料重新生成，可以在本目录运行：

```powershell
node .\scripts\parse-markdown.js
```

默认会自动读取上一级目录中的：

- `MinerU_markdown_雅思阅读同义词专项训练-XMXDF雅思阅读组_list_1-20_2069782957729349632.md`
- `雅思阅读同义词专项训练-XMXDF雅思阅读组 list 1-20.pdf`

## 说明

- 这是纯前端项目，不依赖后端。
- 推荐使用 Chrome 或 Edge 打开。
- 进度保存在浏览器 `localStorage` 中，清理浏览器站点数据后进度会消失。
