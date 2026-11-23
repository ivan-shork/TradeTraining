import Database from 'better-sqlite3'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

let db: Database.Database | null = null

/**
 * 数据目录解析：优先读位置标记文件 data-location.json（{"dataDir": "..."}），
 * 允许把数据库迁到任意磁盘（如 D 盘）；无标记时用默认 userData（C 盘）。
 * dev 与打包后应用名不同，两个候选位置都检查。
 */
function resolveDataDir(): string {
  const appData = process.env.APPDATA
  if (appData) {
    for (const dir of ['tradetraining', 'TradeTraining']) {
      const marker = path.join(appData, dir, 'data-location.json')
      try {
        const cfg = JSON.parse(fs.readFileSync(marker, 'utf-8')) as { dataDir?: string }
        if (cfg?.dataDir && fs.existsSync(cfg.dataDir)) return cfg.dataDir
      } catch { /* 无标记或损坏，跳过 */ }
    }
  }
  return app.getPath('userData')
}

export function getDbPath(): string {
  return path.join(resolveDataDir(), 'tradetraining.db')
}

export function getDb(): Database.Database {
  if (db) return db
  const dbPath = getDbPath()
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(`
CREATE TABLE IF NOT EXISTS instruments (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  invest_type TEXT,
  list_date TEXT,
  t0_eligible INTEGER DEFAULT 0,
  in_blacklist INTEGER DEFAULT 0,
  in_watchlist INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS kline_cache (
  code TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  open REAL, high REAL, low REAL, close REAL,
  vol REAL, amount REAL, adj_factor REAL DEFAULT 1,
  PRIMARY KEY (code, trade_date)
);
CREATE INDEX IF NOT EXISTS idx_kline_code ON kline_cache(code, trade_date);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  freq_default TEXT NOT NULL DEFAULT 'D',
  start_date TEXT NOT NULL,
  end_date TEXT,
  seed INTEGER NOT NULL,
  step_limit INTEGER NOT NULL DEFAULT 120,
  context_bars INTEGER NOT NULL DEFAULT 120,
  init_cash REAL NOT NULL,
  match_model TEXT NOT NULL DEFAULT 'A',
  status TEXT NOT NULL DEFAULT 'ongoing',
  created_at TEXT NOT NULL,
  settled_at TEXT
);

CREATE TABLE IF NOT EXISTS session_state (
  session_id INTEGER PRIMARY KEY,
  revealed_count INTEGER NOT NULL,
  cash REAL NOT NULL,
  position_qty INTEGER NOT NULL,
  avg_cost REAL NOT NULL,
  realized_pnl REAL NOT NULL,
  equity_curve TEXT NOT NULL DEFAULT '[]',
  pending_order TEXT,
  last_freq TEXT DEFAULT 'D',
  last_buy_date TEXT
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  side TEXT NOT NULL,
  price REAL NOT NULL,
  qty INTEGER NOT NULL,
  fee REAL NOT NULL DEFAULT 0,
  note TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',
  match_model TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'filled',
  UNIQUE(session_id, seq)
);

CREATE TABLE IF NOT EXISTS drawings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  tool_type TEXT NOT NULL,
  points_json TEXT NOT NULL,
  style_json TEXT DEFAULT '{}',
  visible INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settlements (
  session_id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  trade_days INTEGER NOT NULL,
  weeks INTEGER NOT NULL,
  revealed_steps INTEGER NOT NULL,
  context_bars INTEGER NOT NULL,
  init_cash REAL NOT NULL,
  end_asset REAL NOT NULL,
  pnl_amount REAL NOT NULL,
  total_return REAL NOT NULL,
  period_change REAL NOT NULL,
  excess_return REAL NOT NULL,
  excess_pnl REAL NOT NULL,
  max_drawdown REAL NOT NULL,
  buy_count INTEGER NOT NULL,
  sell_count INTEGER NOT NULL,
  win_rate REAL NOT NULL,
  profit_loss_ratio REAL NOT NULL,
  avg_holding_days REAL NOT NULL,
  note_complete_rate REAL NOT NULL,
  tag_dist TEXT DEFAULT '{}',
  match_model TEXT NOT NULL,
  settled_at TEXT NOT NULL,
  equity_curve TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`)
  return db
}
