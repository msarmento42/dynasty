#!/usr/bin/env python3
"""
Dynasty Fantasy Football Trade Analyzer
Pulls live data from Sleeper + FantasyCalc to surface trade opportunities.
"""

import json
import urllib.request
import sys
from dataclasses import dataclass, field
from typing import Optional

# ─── Config ────────────────────────────────────────────────────────────────────
SLEEPER_USER_ID = "465276267160137728"
DYNASTY_LEAGUES = {
    "1330499939976880128": {
        "name": "The Odin Invitational",
        "my_roster_id": 4,
        "teams": 12,
        "format": "SF",   # SuperFlex
        "ppr": 1.0,
        "tep": 0.75,
    },
    "1315139749693886464": {
        "name": "Four Horsemen Vol. 8",
        "my_roster_id": 3,
        "teams": 4,
        "format": "4QB",  # 4 QB starters
        "ppr": 1.0,
        "tep": 0.75,
    },
    "1312285408079380481": {
        "name": "Four Horsemen All-Stars 2024",
        "my_roster_id": 4,
        "teams": 4,
        "format": "4QB",
        "ppr": 1.0,
        "tep": 0.75,
    },
}

# ─── Helpers ──────────────────────────────────────────────────────────────────
def fetch(url: str) -> dict | list:
    req = urllib.request.Request(url, headers={"User-Agent": "dynasty-analyzer/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())

def fmt_val(v: int) -> str:
    return f"{v:,}"

# ─── Data fetch ───────────────────────────────────────────────────────────────
print("📡 Fetching dynasty values from FantasyCalc...")
fc_sf_raw   = fetch("https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=1")
fc_1qb_raw  = fetch("https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=1&numTeams=12&ppr=1")

# Build lookup: sleeper_id → value dict
def build_fc_lookup(raw):
    out = {}
    for item in raw:
        p = item["player"]
        sid = p.get("sleeperId")
        if sid:
            out[str(sid)] = {
                "name": p["name"],
                "position": p["position"],
                "team": p.get("maybeTeam", "FA"),
                "age": round(p.get("maybeAge") or 0, 1),
                "value": item["value"],
                "rank": item["overallRank"],
                "pos_rank": item["positionRank"],
                "trend30": item.get("trend30Day", 0),
            }
    return out

fc_sf  = build_fc_lookup(fc_sf_raw)
fc_1qb = build_fc_lookup(fc_1qb_raw)

print(f"  SF: {len(fc_sf)} players | 1QB: {len(fc_1qb)} players\n")

# ─── Per-league analysis ──────────────────────────────────────────────────────
for league_id, cfg in DYNASTY_LEAGUES.items():
    league_name = cfg["name"]
    my_roster_id = cfg["my_roster_id"]
    fmt = cfg["format"]
    # SF and 4QB both benefit from QB-premium values
    fc = fc_sf if fmt in ("SF", "4QB") else fc_1qb

    print("=" * 70)
    print(f"🏈  {league_name}  [{fmt} | {cfg['teams']} teams | PPR {cfg['ppr']} | TEP +{cfg['tep']}]")
    print("=" * 70)

    # Fetch all rosters
    rosters_raw = fetch(f"https://api.sleeper.app/v1/league/{league_id}/rosters")
    # Fetch user map
    users_raw = fetch(f"https://api.sleeper.app/v1/league/{league_id}/users")
    user_map = {u["user_id"]: (u.get("metadata", {}) or {}).get("team_name") or u.get("display_name", "Unknown")
                for u in users_raw}

    # Build roster structs
    @dataclass
    class Roster:
        roster_id: int
        owner_id: str
        team_name: str
        players: list[str]
        valued: list[dict] = field(default_factory=list)
        pos_totals: dict = field(default_factory=dict)

    rosters = []
    for r in rosters_raw:
        rid = r["roster_id"]
        oid = r.get("owner_id") or ""
        tname = user_map.get(oid, f"Team {rid}")
        players = r.get("players") or []
        rosters.append(Roster(rid, oid, tname, players))

    # Attach values to each roster
    POSITIONS = ["QB", "RB", "WR", "TE"]
    for ro in rosters:
        valued = []
        for pid in ro.players:
            info = fc.get(str(pid))
            if info:
                valued.append({"id": pid, **info})
            else:
                valued.append({"id": pid, "name": f"[{pid}]", "position": "UNK",
                               "team": "?", "age": 0, "value": 0, "rank": 999,
                               "pos_rank": 99, "trend30": 0})
        valued.sort(key=lambda x: -x["value"])
        ro.valued = valued

        # Top-N value by position (starting quality)
        STARTERS = {"QB": 2, "RB": 4, "WR": 6, "TE": 2}
        for pos in POSITIONS:
            pos_players = [p for p in valued if p["position"] == pos]
            top_n = STARTERS[pos]
            ro.pos_totals[pos] = sum(p["value"] for p in pos_players[:top_n])

    # League averages by position
    league_avg = {}
    for pos in POSITIONS:
        vals = [ro.pos_totals.get(pos, 0) for ro in rosters if ro.pos_totals.get(pos, 0) > 0]
        league_avg[pos] = sum(vals) / len(vals) if vals else 0

    # Find my roster
    my_roster = next((r for r in rosters if r.roster_id == my_roster_id), None)
    if not my_roster:
        print("  ⚠️  Could not locate your roster\n")
        continue

    # ── My Roster ────────────────────────────────────────────────────────────
    print(f"\n📋  YOUR ROSTER: {my_roster.team_name}  (roster #{my_roster_id})")
    print(f"    {len(my_roster.players)} players\n")

    for pos in POSITIONS:
        pos_players = [p for p in my_roster.valued if p["position"] == pos]
        if not pos_players:
            continue
        print(f"  {pos}:")
        for p in pos_players[:8]:  # show up to 8 per position
            trend = f"  ↑{p['trend30']}" if p['trend30'] > 200 else (f"  ↓{abs(p['trend30'])}" if p['trend30'] < -200 else "")
            print(f"    {p['name']:<25} {p['team']:<5} age={p['age']:<5} val={fmt_val(p['value']):<8} #{p['pos_rank']} overall#{p['rank']}{trend}")
        if len(pos_players) > 8:
            print(f"    ... +{len(pos_players)-8} more")

    # ── Position Strength vs League Avg ──────────────────────────────────────
    print(f"\n📊  POSITION STRENGTH vs LEAGUE AVERAGE")
    my_strengths = []
    my_weaknesses = []
    for pos in POSITIONS:
        mine = my_roster.pos_totals.get(pos, 0)
        avg  = league_avg.get(pos, 0)
        if avg == 0:
            continue
        diff_pct = ((mine - avg) / avg) * 100
        bar = "█" * min(int(abs(diff_pct) / 5), 10)
        direction = "+" if diff_pct >= 0 else "-"
        arrow = "▲" if diff_pct >= 0 else "▼"
        print(f"  {pos:<5} mine={fmt_val(mine):<9} avg={fmt_val(int(avg)):<9} {arrow} {abs(diff_pct):.0f}% {bar}")
        if diff_pct > 10:
            my_strengths.append((pos, diff_pct))
        elif diff_pct < -10:
            my_weaknesses.append((pos, diff_pct))

    # ── Trade Targets ─────────────────────────────────────────────────────────
    print(f"\n🎯  TRADE OPPORTUNITIES")
    print(f"    Your surpluses: {[p for p,_ in my_strengths] or 'none'}")
    print(f"    Your deficits:  {[p for p,_ in my_weaknesses] or 'none'}")
    print()

    if not my_strengths or not my_weaknesses:
        print("    ℹ️  No clear surplus/deficit gaps — roster is balanced or analysis needs more data.\n")
        continue

    # Find teams with inverse needs
    for other in rosters:
        if other.roster_id == my_roster_id:
            continue

        buy_from_them = []  # they have surplus in my weakness positions
        sell_to_them  = []  # they have deficit in my surplus positions

        for pos, pct in my_weaknesses:
            their_val = other.pos_totals.get(pos, 0)
            avg = league_avg.get(pos, 0)
            if avg > 0 and their_val > avg * 1.10:
                buy_from_them.append((pos, their_val, avg))

        for pos, pct in my_strengths:
            their_val = other.pos_totals.get(pos, 0)
            avg = league_avg.get(pos, 0)
            if avg > 0 and their_val < avg * 0.90:
                sell_to_them.append((pos, their_val, avg))

        if buy_from_them and sell_to_them:
            print(f"  ↔️  {other.team_name}")
            for pos, tv, av in buy_from_them:
                print(f"      BUY  their {pos}: {fmt_val(tv)} vs avg {fmt_val(int(av))} (+{((tv-av)/av*100):.0f}%) — they can spare it")
            for pos, tv, av in sell_to_them:
                print(f"      SELL my   {pos}: they have {fmt_val(tv)} vs avg {fmt_val(int(av))} (-{((av-tv)/av*100):.0f}%) — they need it")

            # Suggest specific players to target / offer
            print(f"      💡 Target (buy): ", end="")
            for pos, _, _ in buy_from_them[:2]:
                their_pos = [p for p in other.valued if p["position"] == pos][:3]
                names = [f"{p['name']} ({fmt_val(p['value'])})" for p in their_pos]
                print(f"{pos}: {', '.join(names)}", end="  ")
            print()
            print(f"      💡 Offer  (sell): ", end="")
            for pos, _, _ in sell_to_them[:2]:
                my_pos = [p for p in my_roster.valued if p["position"] == pos][:3]
                names = [f"{p['name']} ({fmt_val(p['value'])})" for p in my_pos]
                print(f"{pos}: {', '.join(names)}", end="  ")
            print("\n")

    print()

print("✅  Analysis complete.")
