"""Build H2H categories from raw season files, write to DynamoDB.

A player is valid for a category if ANY of their seasons satisfies its rule.
Thresholds are parameterized so the pool scales by adding values, not code.

Run: .venv/bin/python category_transform.py   (reads same S3 raw as transform.py)
"""
import json
from decimal import Decimal
from typing import Callable

import boto3

import config

# Drop categories with fewer than this many valid players — too thin to give
# players obscure options to hunt for.
MIN_VALID = 12

s3 = boto3.client("s3", region_name=config.AWS_REGION)
dynamodb = boto3.resource("dynamodb", region_name=config.AWS_REGION)
table = dynamodb.Table(config.CATEGORIES_TABLE)
players_table = dynamodb.Table(config.PLAYERS_TABLE)

Row = dict
Pred = Callable[[Row], bool]


def load_season(season: str) -> list[Row]:
    obj = s3.get_object(Bucket=config.RAW_BUCKET, Key=config.raw_key(season))
    return json.loads(obj["Body"].read())


def num(row: Row, field: str) -> float:
    return row.get(field) or 0


def total_templates() -> list[tuple[str, str, Pred]]:
    specs = [
        ("pts", "PTS", "Scored {t}+ points in a season", [1500, 1800, 2000, 2200]),
        ("reb", "REB", "Grabbed {t}+ rebounds in a season", [600, 800, 1000]),
        ("ast", "AST", "Dished {t}+ assists in a season", [400, 600, 800]),
        ("fg3m", "FG3M", "Made {t}+ threes in a season", [150, 200, 250]),
        ("stl", "STL", "Recorded {t}+ steals in a season", [120, 150]),
        ("blk", "BLK", "Recorded {t}+ blocks in a season", [120, 180]),
    ]
    out = []
    for prefix, field, label, thresholds in specs:
        for t in thresholds:
            out.append(
                (
                    f"{prefix}_season_{t}",
                    label.format(t=t),
                    lambda r, f=field, t=t: num(r, f) >= t,
                )
            )
    return out


def per_game_templates(min_gp: int = 40) -> list[tuple[str, str, Pred]]:
    specs = [
        ("ppg", "PTS", "Averaged {t}+ PPG in a season", [20, 25, 28]),
        ("rpg", "REB", "Averaged {t}+ RPG in a season", [8, 10, 12]),
        ("apg", "AST", "Averaged {t}+ APG in a season", [6, 8, 10]),
    ]
    out = []
    for prefix, field, label, thresholds in specs:
        for t in thresholds:
            out.append(
                (
                    f"{prefix}_{t}",
                    label.format(t=t),
                    lambda r, f=field, t=t, m=min_gp: num(r, "GP") >= m
                    and num(r, f) / (num(r, "GP") or 1) >= t,
                )
            )
    return out


def rate_templates() -> list[tuple[str, str, Pred]]:
    return [
        (
            "fg_pct_50",
            "Shot 50%+ from the field in a season (40+ games)",
            lambda r: num(r, "GP") >= 40 and num(r, "FGA") >= 300 and num(r, "FG_PCT") >= 0.50,
        ),
        (
            "fg3_pct_40",
            "Shot 40%+ from three in a season (100+ makes)",
            lambda r: num(r, "FG3M") >= 100 and num(r, "FG3_PCT") >= 0.40,
        ),
        (
            "ft_pct_90",
            "Shot 90%+ from the line in a season (40+ games)",
            lambda r: num(r, "GP") >= 40 and num(r, "FTA") >= 125 and num(r, "FT_PCT") >= 0.90,
        ),
    ]


def feat_templates() -> list[tuple[str, str, Pred]]:
    return [
        ("td3_season_5", "Had 5+ triple-doubles in a season",
         lambda r: num(r, "TD3") >= 5),
        ("td3_season_10", "Had 10+ triple-doubles in a season",
         lambda r: num(r, "TD3") >= 10),
        ("dd2_season_40", "Had 40+ double-doubles in a season",
         lambda r: num(r, "DD2") >= 40),
        ("dd2_season_60", "Had 60+ double-doubles in a season",
         lambda r: num(r, "DD2") >= 60),
    ]


def team_templates(seasons: list[list[Row]]) -> list[tuple[str, str, Pred]]:
    abbrevs = sorted(
        {row["TEAM_ABBREVIATION"] for season in seasons for row in season
         if row.get("TEAM_ABBREVIATION")}
    )
    return [
        (f"team_{abbr}", f"Played for {abbr}",
         lambda r, a=abbr: r.get("TEAM_ABBREVIATION") == a)
        for abbr in abbrevs
    ]


def load_players() -> dict[str, tuple[str, float]]:
    """playerId -> (name, global fameScore). Fame is the input we re-rank per category."""
    out: dict[str, tuple[str, float]] = {}
    kwargs = {"ProjectionExpression": "playerId, #n, fameScore",
              "ExpressionAttributeNames": {"#n": "name"}}
    while True:
        res = players_table.scan(**kwargs)
        for it in res["Items"]:
            out[it["playerId"]] = (it["name"], float(it["fameScore"]))
        if "LastEvaluatedKey" not in res:
            return out
        kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]


def category_fame(valid_ids: set[str], players: dict[str, tuple[str, float]]) -> dict:
    """Re-rank valid players by global fame WITHIN this set (percentile 0-1).

    Most-obscure-in-category -> 0, most-famous -> 1. This spreads narrow elite
    categories (where everyone is globally famous) across the full range.
    """
    members = [pid for pid in valid_ids if pid in players]
    members.sort(key=lambda pid: players[pid][1])  # ascending global fame
    denom = len(members) - 1 or 1
    return {
        pid: {
            "name": players[pid][0],
            "fame": Decimal(str(round(rank / denom, 4))),
        }
        for rank, pid in enumerate(members)
    }


def build(players: dict[str, tuple[str, float]]) -> list[dict]:
    seasons = [load_season(s) for s in config.seasons()]

    templates = (
        total_templates()
        + per_game_templates()
        + rate_templates()
        + feat_templates()
        + team_templates(seasons)
    )

    categories = []
    for cid, label, pred in templates:
        valid: set[str] = set()
        for season in seasons:
            for row in season:
                if pred(row):
                    valid.add(str(row["PLAYER_ID"]))
        if len(valid) >= MIN_VALID:
            categories.append(
                {"categoryId": cid, "label": label, "valid": category_fame(valid, players)}
            )
    return categories


def write(categories: list[dict]) -> None:
    with table.batch_writer() as batch:
        for c in categories:
            batch.put_item(Item=c)


def main() -> None:
    players = load_players()
    print(f"loaded {len(players)} player fame scores")
    categories = build(players)
    write(categories)
    print(f"wrote {len(categories)} categories to {config.CATEGORIES_TABLE}")
    for c in sorted(categories, key=lambda c: len(c["valid"])):
        print(f"  {len(c['valid']):4d}  {c['categoryId']:20s}  {c['label']}")


if __name__ == "__main__":
    main()
