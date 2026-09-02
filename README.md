# Qoder 积分用量浏览器插件

一个 Chrome 浏览器插件，用于查看 [Qoder](https://qoder.com) 平台的积分用量和花费明细。

## 功能

- 📊 按天聚合展示积分用量和花费
- 📅 支持查看昨天 / 今天 / 近7天 / 近30天
- 💰 美元花费自动换算人民币
- 📈 汇总统计：总积分、总花费、日均积分、日均花费
- 🏷️ 按模型类别分组（GPT-4、Claude、Performance 等）
- ✅ 区分 Charged（已计费）/ Not Charged（未计费）

## 安装

1. 打开 Chrome，访问 `chrome://extensions`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本插件目录（`qoder-credits-extension/`）
5. 登录 [qoder.com](https://qoder.com) 后，点击工具栏插件图标即可使用

## 使用

- 点击插件图标弹出独立面板
- 默认加载「今天」的数据
- 点击顶部按钮切换时间范围
- 表格按日期倒序排列，每天末尾显示小计
- 顶部汇总行显示总积分、总花费、日均积分、日均花费

## 技术栈

- 纯原生 JS + HTML + CSS，零外部依赖
- Chrome Extension Manifest V3
- Popup 模式，不注入 content script

## 项目结构

```
qoder-credits-extension/
├── manifest.json     # 插件清单（Manifest V3）
├── popup.html        # popup 页面骨架
├── popup.js          # 入口控制器
├── api.js            # API 请求与分页模块
├── aggregator.js     # 数据聚合模块
├── renderer.js       # 表格渲染模块
├── styles.css        # 样式
├── icons/            # 图标
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## API 接口

插件调用 Qoder 官方接口获取数据：

```
GET https://qoder.com/api/v1/me/usages/big_model_credits/histories
  ?page=1&page_size=100
  &start_time={start}&end_time={end}
  &order_by=begin_at&order=-1
```

- 自动携带 qoder.com 登录态 cookie（`credentials: include`）
- 支持 `next_token` 分页，自动拉取全量数据
- 15s 超时保护，最大 50 页限制

## License

MIT
