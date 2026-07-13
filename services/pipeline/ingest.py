"""Ingest per-season player totals from stats.nba.com into the raw S3 bucket.

One LeagueDashPlayerStats call per season (~46 calls). Idempotent: skips a
season already present in S3 unless FORCE=1. Run: .venv/bin/python ingest.py
"""
import json
import os
import sys
import time

import boto3
from botocore.exceptions import ClientError
from nba_api.stats.endpoints import leaguedashplayerstats

import config

s3 = boto3.client("s3", region_name=config.AWS_REGION)
FORCE = os.environ.get("FORCE") == "1"


def already_ingested(key: str) -> bool:
    try:
        s3.head_object(Bucket=config.RAW_BUCKET, Key=key)
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] == "404":
            return False
        raise


def fetch_season(season: str) -> list[dict]:
    resp = leaguedashplayerstats.LeagueDashPlayerStats(
        season=season,
        season_type_all_star="Regular Season",
        per_mode_detailed="Totals",
        timeout=30,
    )
    return resp.get_normalized_dict()["LeagueDashPlayerStats"]


def main() -> None:
    for season in config.seasons():
        key = config.raw_key(season)

        if not FORCE and already_ingested(key):
            print(f"skip  {season} (already in S3)")
            continue

        try:
            rows = fetch_season(season)
        except Exception as e:  # network/timeout/parse — log and continue
            print(f"FAIL  {season}: {e}", file=sys.stderr)
            continue

        s3.put_object(
            Bucket=config.RAW_BUCKET,
            Key=key,
            Body=json.dumps(rows).encode("utf-8"),
            ContentType="application/json",
        )
        print(f"wrote {season}: {len(rows):>4} players -> s3://{config.RAW_BUCKET}/{key}")
        time.sleep(config.REQUEST_DELAY)


if __name__ == "__main__":
    main()
