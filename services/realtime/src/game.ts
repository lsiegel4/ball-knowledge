import type {
  APIGatewayProxyWebsocketEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import {
  GetCommand,
  UpdateCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { doc, GAMES, CONNECTIONS, CATEGORIES, PLAYERS, push } from "./shared";

const ROUND_MS = 30_000;
const WIN_SCORE = 4;

type Player = { connectionId: string };

const isConditionFail = (e: unknown) =>
  (e as { name?: string }).name === "ConditionalCheckFailedException";

async function pushBoth(
  domainName: string,
  stage: string,
  players: Player[],
  payload: unknown
): Promise<void> {
  await Promise.all(
    players.map((p) =>
      push(domainName, stage, p.connectionId, payload).catch(() => undefined)
    )
  );
}

async function randomCategory(): Promise<{
  categoryId: string;
  label: string;
  validPlayerIds: string[];
}> {
  const ids = await doc.send(
    new ScanCommand({ TableName: CATEGORIES, ProjectionExpression: "categoryId" })
  );
  const pool = ids.Items ?? [];
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  const full = await doc.send(
    new GetCommand({ TableName: CATEGORIES, Key: { categoryId: chosen.categoryId } })
  );
  const c = full.Item!;
  return {
    categoryId: c.categoryId,
    label: c.label,
    validPlayerIds: c.validPlayerIds,
  };
}

// Assign a category + deadline, clear picks, push roundStart to both players.
export async function startRound(
  domainName: string,
  stage: string,
  gameId: string,
  round: number,
  players: Player[]
): Promise<void> {
  const category = await randomCategory();
  const deadline = Date.now() + ROUND_MS;

  await doc.send(
    new UpdateCommand({
      TableName: GAMES,
      Key: { gameId },
      UpdateExpression:
        "SET category = :c, deadline = :d, picks = :empty, #r = :r",
      ExpressionAttributeNames: { "#r": "round" },
      ExpressionAttributeValues: {
        ":c": category,
        ":d": deadline,
        ":empty": {},
        ":r": round,
      },
    })
  );

  await pushBoth(domainName, stage, players, {
    type: "roundStart",
    round,
    category: { categoryId: category.categoryId, label: category.label },
    deadline,
  });
}

export const submitPick = async (
  event: APIGatewayProxyWebsocketEventV2
): Promise<APIGatewayProxyResultV2> => {
  const { connectionId: me, domainName, stage } = event.requestContext;

  const conn = await doc.send(
    new GetCommand({ TableName: CONNECTIONS, Key: { connectionId: me } })
  );
  const gameId: string | undefined = conn.Item?.gameId ?? undefined;
  if (!gameId) {
    await push(domainName, stage, me, { type: "notInGame" });
    return { statusCode: 200 };
  }

  const g = await doc.send(new GetCommand({ TableName: GAMES, Key: { gameId } }));
  const game = g.Item;
  if (!game || game.status !== "active" || !game.category) return { statusCode: 200 };

  const idx = (game.players as Player[]).findIndex((p) => p.connectionId === me);
  if (idx < 0) return { statusCode: 200 };

  let playerId: string | undefined;
  try {
    playerId = JSON.parse(event.body ?? "{}").playerId;
  } catch {
    playerId = undefined;
  }
  if (!playerId) {
    await push(domainName, stage, me, { type: "invalidPick" });
    return { statusCode: 200 };
  }

  if (Date.now() > Number(game.deadline)) {
    await push(domainName, stage, me, { type: "tooLate" });
    return { statusCode: 200 };
  }

  if (!(game.category.validPlayerIds as string[]).includes(playerId)) {
    await push(domainName, stage, me, { type: "invalidPick" });
    return { statusCode: 200 };
  }

  const player = await doc.send(
    new GetCommand({ TableName: PLAYERS, Key: { playerId } })
  );
  if (!player.Item) {
    await push(domainName, stage, me, { type: "invalidPick" });
    return { statusCode: 200 };
  }

  const pick = {
    playerId,
    playerName: player.Item.name,
    fameScore: Number(player.Item.fameScore),
    submittedAt: Date.now(),
  };

  // Lock the pick: first submit per round wins (no changing), and only while
  // the round is live. ALL_NEW lets the SECOND writer detect both picks are in
  // and become the sole resolver.
  let updated;
  try {
    const res = await doc.send(
      new UpdateCommand({
        TableName: GAMES,
        Key: { gameId },
        UpdateExpression: "SET picks.#i = :pick",
        ConditionExpression:
          "attribute_not_exists(picks.#i) AND #s = :active AND :now <= deadline",
        ExpressionAttributeNames: { "#i": String(idx), "#s": "status" },
        ExpressionAttributeValues: {
          ":pick": pick,
          ":active": "active",
          ":now": Date.now(),
        },
        ReturnValues: "ALL_NEW",
      })
    );
    updated = res.Attributes!;
  } catch (e) {
    if (!isConditionFail(e)) throw e;
    await push(domainName, stage, me, { type: "pickRejected" });
    return { statusCode: 200 };
  }

  await push(domainName, stage, me, { type: "pickAccepted", playerName: pick.playerName });

  const picks = updated.picks as Record<string, typeof pick>;
  if (picks["0"] && picks["1"]) {
    await resolveRound(domainName, stage, updated);
  }
  return { statusCode: 200 };
};

async function resolveRound(
  domainName: string,
  stage: string,
  game: Record<string, any>
): Promise<void> {
  const gameId: string = game.gameId;
  const players = game.players as Player[];
  const p0 = game.picks["0"];
  const p1 = game.picks["1"];
  const scores = [Number(game.scores[0]), Number(game.scores[1])];
  const round = Number(game.round);

  const replay =
    p0.playerId === p1.playerId || Number(p0.fameScore) === Number(p1.fameScore);

  let winnerIndex: number | null = null;
  if (!replay) {
    winnerIndex = Number(p0.fameScore) < Number(p1.fameScore) ? 0 : 1;
    scores[winnerIndex] += 1;
  }

  const over = winnerIndex !== null && scores[winnerIndex] >= WIN_SCORE;

  // Guard on both picks still present so only one Lambda resolves this round.
  const cond = {
    ConditionExpression: "attribute_exists(picks.#p0) AND attribute_exists(picks.#p1)",
    ExpressionAttributeNames: { "#p0": "0", "#p1": "1" } as Record<string, string>,
  };

  try {
    if (over) {
      await doc.send(
        new UpdateCommand({
          TableName: GAMES,
          Key: { gameId },
          UpdateExpression: "SET scores = :s, #st = :finished",
          ConditionExpression: cond.ConditionExpression,
          ExpressionAttributeNames: { ...cond.ExpressionAttributeNames, "#st": "status" },
          ExpressionAttributeValues: { ":s": scores, ":finished": "finished" },
        })
      );
    } else {
      // Replay keeps the same round number; a real result advances it.
      const nextRound = replay ? round : round + 1;
      const category = await randomCategory();
      await doc.send(
        new UpdateCommand({
          TableName: GAMES,
          Key: { gameId },
          UpdateExpression:
            "SET scores = :s, #r = :nr, category = :c, deadline = :d, picks = :empty",
          ConditionExpression: cond.ConditionExpression,
          ExpressionAttributeNames: { ...cond.ExpressionAttributeNames, "#r": "round" },
          ExpressionAttributeValues: {
            ":s": scores,
            ":nr": nextRound,
            ":c": category,
            ":d": Date.now() + ROUND_MS,
            ":empty": {},
          },
        })
      );
    }
  } catch (e) {
    if (isConditionFail(e)) return; // another invocation already resolved
    throw e;
  }

  await pushBoth(domainName, stage, players, {
    type: "roundResult",
    round,
    replay,
    winnerIndex,
    scores,
    picks: [
      { playerId: p0.playerId, playerName: p0.playerName, fameScore: p0.fameScore },
      { playerId: p1.playerId, playerName: p1.playerName, fameScore: p1.fameScore },
    ],
  });

  if (over) {
    await pushBoth(domainName, stage, players, {
      type: "matchOver",
      scores,
      winnerIndex,
    });
  } else {
    const g = await doc.send(new GetCommand({ TableName: GAMES, Key: { gameId } }));
    const next = g.Item!;
    await pushBoth(domainName, stage, players, {
      type: "roundStart",
      round: Number(next.round),
      category: { categoryId: next.category.categoryId, label: next.category.label },
      deadline: Number(next.deadline),
    });
  }
}
