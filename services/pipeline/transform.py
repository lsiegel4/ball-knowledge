"""Aggregate raw season files into per-player records + fameScore, write to DynamoDB.

Run: .venv/bin/python transform.py   (after ingest.py)
"""
import json
import unicodedata
from decimal import Decimal

import boto3

import config


def fold(s: str) -> str:
    """Lowercase + strip diacritics so 'Jokić' matches a 'jokic' query."""
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nfkd if not unicodedata.combining(c)).lower()

s3 = boto3.client("s3", region_name=config.AWS_REGION)
table = boto3.resource("dynamodb", region_name=config.AWS_REGION).Table(
    config.PLAYERS_TABLE
)


def load_season(season: str) -> list[dict]:
    obj = s3.get_object(Bucket=config.RAW_BUCKET, Key=config.raw_key(season))
    return json.loads(obj["Body"].read())


def aggregate() -> dict[str, dict]:
    players: dict[str, dict] = {}
    for season in config.seasons():
        start_year = int(season[:4])
        for row in load_season(season):
            pid = str(row["PLAYER_ID"])
            p = players.setdefault(
                pid,
                {
                    "playerId": pid,
                    "name": row["PLAYER_NAME"],
                    "teams": set(),
                    "firstSeason": start_year,
                    "pts": 0.0,
                    "gp": 0.0,
                    "min": 0.0,
                },
            )
            p["name"] = row["PLAYER_NAME"]
            p["firstSeason"] = min(p["firstSeason"], start_year)
            if row.get("TEAM_ABBREVIATION"):
                p["teams"].add(row["TEAM_ABBREVIATION"])
            p["pts"] += row.get("PTS") or 0
            p["gp"] += row.get("GP") or 0
            p["min"] += row.get("MIN") or 0
    return players


def add_fame_scores(players: dict[str, dict]) -> None:
    def norm(vals: list[float]) -> dict:
        lo, hi = min(vals), max(vals)
        span = hi - lo or 1.0
        return lambda v: (v - lo) / span

    ids = list(players)
    n_pts = norm([players[i]["pts"] for i in ids])
    n_gp = norm([players[i]["gp"] for i in ids])
    n_min = norm([players[i]["min"] for i in ids])

    for i in ids:
        p = players[i]
        p["composite"] = 0.5 * n_pts(p["pts"]) + 0.3 * n_min(p["min"]) + 0.2 * n_gp(p["gp"])

    # fameScore = percentile rank of composite (uniform 0-1 spread).
    ranked = sorted(ids, key=lambda i: players[i]["composite"])
    denom = len(ranked) - 1 or 1
    for rank, i in enumerate(ranked):
        players[i]["fameScore"] = rank / denom


def write(players: dict[str, dict]) -> None:
    with table.batch_writer() as batch:
        for p in players.values():
            batch.put_item(
                Item={
                    "playerId": p["playerId"],
                    "name": p["name"],
                    "nameLower": p["name"].lower(),
                    "nameSearch": fold(p["name"]),
                    "teams": sorted(p["teams"]),
                    "firstSeason": p["firstSeason"],
                    "careerPoints": int(p["pts"]),
                    "careerGames": int(p["gp"]),
                    "fameScore": Decimal(str(round(p["fameScore"], 4))),
                }
            )


def main() -> None:
    players = aggregate()
    print(f"aggregated {len(players)} players")
    add_fame_scores(players)
    write(players)
    print(f"wrote {len(players)} players to {config.PLAYERS_TABLE}")

    top = sorted(players.values(), key=lambda p: -p["fameScore"])[:5]
    for p in top:
        print(f"  fame {p['fameScore']:.3f}  {p['name']}  ({int(p['pts'])} pts)")


if __name__ == "__main__":
    main()
