CREATE TABLE IF NOT EXISTS players (
    sleeper_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    position TEXT,
    team TEXT,
    age REAL,
    value_sf INTEGER DEFAULT 0,
    value_1qb INTEGER DEFAULT 0,
    trend_30d INTEGER DEFAULT 0,
    injury_status TEXT,
    depth_chart_order INTEGER,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS leagues (
    league_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    n_teams INTEGER,
    format TEXT,
    my_roster_id INTEGER,
    config_json TEXT
);

CREATE TABLE IF NOT EXISTS rosters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id TEXT,
    roster_id INTEGER,
    owner_display_name TEXT,
    player_ids_json TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS picks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id TEXT,
    season INTEGER,
    round INTEGER,
    original_owner_id INTEGER,
    current_owner_id INTEGER,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS news_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sleeper_id TEXT,
    player_name TEXT,
    headline TEXT,
    detail TEXT,
    source TEXT,
    published_at TEXT,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id TEXT,
    sleeper_id TEXT,
    player_name TEXT,
    alert_type TEXT,
    severity TEXT,
    old_value TEXT,
    new_value TEXT,
    detail TEXT,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS player_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sleeper_id TEXT,
    injury_status TEXT,
    depth_chart_order INTEGER,
    value_sf INTEGER,
    snapshot_date TEXT,
    UNIQUE(sleeper_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS trade_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id TEXT,
    transaction_id TEXT UNIQUE,
    week INTEGER,
    season INTEGER,
    side_a_roster_id INTEGER,
    side_b_roster_id INTEGER,
    side_a_player_ids_json TEXT,
    side_b_player_ids_json TEXT,
    side_a_pick_ids_json TEXT,
    side_b_pick_ids_json TEXT,
    side_a_total_value INTEGER,
    side_b_total_value INTEGER,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS market_calibration (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id TEXT,
    sleeper_id TEXT,
    player_name TEXT,
    fc_value INTEGER,
    observed_trades INTEGER,
    avg_trade_ratio REAL,
    updated_at TEXT,
    UNIQUE(league_id, sleeper_id)
);

CREATE TABLE IF NOT EXISTS manager_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id TEXT,
    roster_id INTEGER,
    owner_name TEXT,
    trades_analyzed INTEGER,
    qb_premium REAL,
    rb_premium REAL,
    wr_premium REAL,
    te_premium REAL,
    pick_sell_bias REAL,
    accept_rate REAL,
    profile_json TEXT,
    updated_at TEXT,
    UNIQUE(league_id, roster_id)
);

CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_type TEXT,
    status TEXT,
    message TEXT,
    ran_at TEXT
);

CREATE TABLE IF NOT EXISTS league_settings (
    league_id TEXT PRIMARY KEY,
    league_name TEXT,
    is_superflex INTEGER DEFAULT 0,
    is_te_premium INTEGER DEFAULT 0,
    qb_slots INTEGER DEFAULT 1,
    rec_format TEXT DEFAULT 'PPR',
    format_label TEXT DEFAULT '1QB',
    raw_json TEXT,
    updated_at TEXT
);
