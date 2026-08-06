import os

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

# Raw landing bucket (override via env; default = deployed DataStack bucket).
RAW_BUCKET = os.environ.get(
    "RAW_BUCKET", "ballknowledge-data-rawbucket0c3ee094-uwshcejqhk7k"
)

PLAYERS_TABLE = os.environ.get("PLAYERS_TABLE", "ball-knowledge-players")
CATEGORIES_TABLE = os.environ.get("CATEGORIES_TABLE", "ball-knowledge-categories")

# LeagueDashPlayerStats only covers 1996-97+. Pre-1996 backfill is a separate
# task (per-player career stats or a historical dataset seed).
FIRST_SEASON_START = 1996
LAST_SEASON_START = 2025

# Politeness delay between stats.nba.com calls (seconds).
REQUEST_DELAY = 0.6


def seasons() -> list[str]:
    return [
        f"{y}-{str(y + 1)[-2:]}"
        for y in range(FIRST_SEASON_START, LAST_SEASON_START + 1)
    ]


def raw_key(season: str) -> str:
    return f"raw/players/{season}/regular_season.json"
