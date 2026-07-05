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

CREATE TABLE IF NOT EXISTS player_id_map (
    sleeper_id TEXT PRIMARY KEY,
    espn_id TEXT,
    yahoo_id TEXT,
    rotowire_id TEXT,
    match_confidence REAL,
    match_method TEXT,
    manual_override INTEGER DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS player_comps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sleeper_id TEXT NOT NULL,
    comp_sleeper_id TEXT NOT NULL,
    similarity_score REAL NOT NULL,
    factors_json TEXT,
    computed_at TEXT NOT NULL,
    UNIQUE(sleeper_id, comp_sleeper_id)
);

CREATE TABLE IF NOT EXISTS roster_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id TEXT NOT NULL,
    roster_id INTEGER NOT NULL,
    total_value REAL NOT NULL DEFAULT 0,
    synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS league_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id TEXT,
    taken_at TEXT,
    roster_count INTEGER,
    expected_roster_count INTEGER,
    waiver_pool_count INTEGER,
    rostered_player_ids_json TEXT,
    source_sync_id INTEGER
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

CREATE TABLE IF NOT EXISTS recommendation_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id TEXT,
    sport TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    recommendation_count INTEGER NOT NULL,
    payload_json TEXT NOT NULL
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

-- Baseball module tables
CREATE TABLE IF NOT EXISTS baseball_players (
    mlb_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    position TEXT,
    team TEXT,
    team_id INTEGER,
    level TEXT,
    sport_id INTEGER,
    age INTEGER,
    birth_date TEXT,
    bats TEXT,
    throws TEXT,
    draft_year INTEGER,
    service_years REAL,
    debut_year INTEGER,
    dynasty_value INTEGER DEFAULT 0,
    injury_status TEXT,
    injury_status_updated_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS baseball_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mlb_id INTEGER,
    season INTEGER,
    sport_id INTEGER,
    level TEXT,
    stat_type TEXT,
    stats_json TEXT,
    UNIQUE(mlb_id, season, sport_id, stat_type)
);

CREATE TABLE IF NOT EXISTS baseball_rosters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    roster_name TEXT NOT NULL DEFAULT 'My Baseball Roster',
    mlb_id INTEGER,
    acquired_date TEXT,
    notes TEXT,
    UNIQUE(roster_name, mlb_id)
);

CREATE TABLE IF NOT EXISTS user_preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    value_mode TEXT NOT NULL DEFAULT 'dynasty' CHECK (value_mode IN ('dynasty', 'redraft')),
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS draft_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sport TEXT NOT NULL DEFAULT 'football',
    num_teams INTEGER NOT NULL,
    num_rounds INTEGER NOT NULL,
    user_pick_slot INTEGER NOT NULL,
    mode TEXT NOT NULL DEFAULT 'snake',
    faab_budget INTEGER,
    current_pick INTEGER NOT NULL DEFAULT 1,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS draft_picks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    overall_pick INTEGER NOT NULL,
    round INTEGER NOT NULL,
    pick_in_round INTEGER NOT NULL,
    team_slot INTEGER NOT NULL,
    player_id TEXT,
    player_name TEXT,
    position TEXT,
    faab_spent INTEGER,
    picked_at TEXT,
    UNIQUE(session_id, overall_pick)
);

CREATE TABLE IF NOT EXISTS simulation_scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scenario_id TEXT UNIQUE NOT NULL,
    league_id TEXT NOT NULL,
    name TEXT NOT NULL,
    actions_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    linked_decision_id INTEGER,
    linked_trade_idea_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
