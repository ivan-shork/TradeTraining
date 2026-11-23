# TradeTraining · ETF K线训练助手

本地桌面端的"历史行情盲盒回放 + 手动模拟交易"训练器：随机抽一只 ETF、随机截取一段历史行情，逐步揭示 K 线，边走边决定买、卖、持有，训练盘感、仓位管理与决策纪律。

## 技术栈

- Electron + React + TypeScript + Vite
- `klinecharts` v9（K线图与画线工具）
- `better-sqlite3`（本地单文件库 `tradetraining.db`）
- 数据源：Tushare（`fund_basic` / `fund_daily` / `fund_adj` / `trade_cal`）

## 快速开始

```bash
npm install

# 开发模式（Vite + Electron）
npm run dev

# 类型检查
npm run typecheck

# 生产构建（主进程 + 渲染进程）
npm run build

# Windows 打包
npm run build:win
```

## 首次使用

1. 启动后进入 **设置 → 数据**，填写 Tushare Token（仅存本地），点"测试连接"。
2. 点 **全量同步**（首次约需数分钟~数小时，取决于积分频次；支持断点续传与进度条）。
3. 回到主页，点 **ETF 训练 → 开始训练**，空格步进，右侧下单。

## 目录结构

```
electron/          主进程（数据层 + 训练引擎 + IPC）
  db.ts            SQLite 建表（instruments/kline_cache/sessions/...）
  tushare.ts       Tushare HTTP 客户端（分批/重试/限速）
  sync.ts          标的池同步 + 日线增量 + 断点续传
  instruments.ts   ETF 过滤与分类打标（宽基/行业/跨境/商品）
  engine.ts        训练引擎：出题/步进/撮合/账户/结算
  ipc.ts           渲染进程桥接
shared/            前后端共享类型与工具
src/               React 界面
  pages/           主页 / 训练 / 结算 / 复盘 / 设置
  components/      K线图(klinecharts) / 下单面板 / 资金曲线 / 开局弹窗
```

## 架构说明（可扩展）

按"训练引擎 + 标的适配器"抽象：`engine.ts` 与标的类型无关，只处理随机出题、揭示步进、撮合成交、资金账户、结算。新增训练类型 = 新增一个 Adapter + 一份默认规则 + 一个入口卡片，不动核心引擎。

## 默认参数

初始资金 200,000 · 上下文 120 根 · 步数上限 120（可 60/120/250/不限）· 前复权 · 交易单位 100 份 · T+1 · 手续费万 1 · 撮合模型 A（当前收盘价，可切 B 下一根开盘价）· 不支持做空。

## 快捷键

`空格` 步进（300ms 防抖）· `B/S` 买卖方向 · `←` 回看（禁交易）· `Esc` 回到最新
