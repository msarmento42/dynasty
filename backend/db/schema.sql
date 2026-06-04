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

CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_type TEXT,
    status TEXT,
    message TEXT,
    ran_at TEXT
);
