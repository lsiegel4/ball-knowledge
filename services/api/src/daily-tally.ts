import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { todayET } from "./lib/day";

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const PICKS = process.env.DAILY_PICKS_TABLE!;
const RESULTS = process.env.DAILY_RESULTS_TABLE!;

type Agg = {
  playerId: string;
  playerName: string;
  fameScore: number;
  count: number;
  earliest: string;
  userIds: string[];
};

// Runs ~00:30 ET (05:30 UTC). Tally the ET day that just closed = now - 24h in ET.
export const handler = async (): Promise<void> => {
  const day = todayET(new Date(Date.now() - 24 * 60 * 60 * 1000));

  const byPlayer = new Map<string, Agg>();
  let lastKey: Record<string, unknown> | undefined;
  let totalPicks = 0;

  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: PICKS,
        KeyConditionExpression: "#d = :day",
        ExpressionAttributeNames: { "#d": "day" },
        ExpressionAttributeValues: { ":day": day },
        ExclusiveStartKey: lastKey,
      })
    );
    for (const it of res.Items ?? []) {
      totalPicks++;
      const a = byPlayer.get(it.playerId);
      if (a) {
        a.count++;
        a.userIds.push(it.userId);
        if (it.submittedAt < a.earliest) a.earliest = it.submittedAt;
      } else {
        byPlayer.set(it.playerId, {
          playerId: it.playerId,
          playerName: it.playerName,
          fameScore: Number(it.fameScore),
          count: 1,
          earliest: it.submittedAt,
          userIds: [it.userId],
        });
      }
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  if (totalPicks === 0) {
    console.log(`No picks for ${day}, skipping.`);
    return;
  }

  // Winner = fewest picks, tie -> lower fameScore (obscure), tie -> earliest submit.
  const winner = [...byPlayer.values()].sort(
    (a, b) =>
      a.count - b.count ||
      a.fameScore - b.fameScore ||
      a.earliest.localeCompare(b.earliest)
  )[0];

  const counts = [...byPlayer.values()]
    .map((a) => ({
      playerId: a.playerId,
      playerName: a.playerName,
      count: a.count,
      fameScore: a.fameScore,
    }))
    .sort((a, b) => a.count - b.count);

  await doc.send(
    new PutCommand({
      TableName: RESULTS,
      Item: {
        day,
        totalPicks,
        winner: {
          playerId: winner.playerId,
          playerName: winner.playerName,
          count: winner.count,
          fameScore: winner.fameScore,
        },
        winnerUserIds: winner.userIds,
        counts,
        talliedAt: new Date().toISOString(),
      },
    })
  );

  console.log(
    `Tallied ${day}: ${totalPicks} picks, winner ${winner.playerName} (${winner.count})`
  );
};
