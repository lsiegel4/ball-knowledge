import type {
  APIGatewayProxyWebsocketEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import {
  GetCommand,
  UpdateCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { doc, GAMES, CONNECTIONS, CATEGORIES, push } from "./shared";

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

type Category = {
  categoryId: string;
  label: string;
  // Category-relative fame prior: playerId -> { name, fame in [0,1] within this set }.
  valid: Record<string, { name: string; fame: number }>;
};

async function randomCategory(): Promise<Category> {
  const ids = await doc.send(
    new ScanCommand({ TableName: CATEGORIES, ProjectionExpression: "categoryId" })
  );
  const pool = ids.Items ?? [];
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  const full = await doc.send(
    new GetCommand({ TableName: CATEGORIES, Key: { categoryId: chosen.categoryId } })
  );
  const c = full.Item!;
  return { categoryId: c.categoryId, label: c.label, valid: c.valid };
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

  // Membership + fame both come from the category itself — no players lookup.
  const entry = (game.category.valid as Category["valid"])[playerId];
  if (!entry) {
    await push(domainName, stage, me, { type: "invalidPick" });
    return { statusCode: 200 };
  }

  const pick = {
    playerId,
    playerName: entry.name,
    fameScore: Number(entry.fame),
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

// Client's countdown hit 0. Resolve the round with whatever picks landed:
// one pick -> no-show loses; no picks -> replay. Idempotent across both clients.
export const roundTimeout = async (
  event: APIGatewayProxyWebsocketEventV2
): Promise<APIGatewayProxyResultV2> => {
  const { connectionId: me, domainName, stage } = event.requestContext;

  const conn = await doc.send(
    new GetCommand({ TableName: CONNECTIONS, Key: { connectionId: me } })
  );
  const gameId: string | undefined = conn.Item?.gameId ?? undefined;
  if (!gameId) return { statusCode: 200 };

  const g = await doc.send(new GetCommand({ TableName: GAMES, Key: { gameId } }));
  const game = g.Item;
  if (!game || game.status !== "active" || !game.category) return { statusCode: 200 };

  // Only resolve once the deadline has genuinely passed.
  if (Date.now() <= Number(game.deadline)) return { statusCode: 200 };

  await resolveRound(domainName, stage, game);
  return { statusCode: 200 };
};

async function resolveRound(
  domainName: string,
  stage: string,
  game: Record<string, any>
): Promise<void> {
  const gameId: string = game.gameId;
  const players = game.players as Player[];
  const p0 = game.picks?.["0"];
  const p1 = game.picks?.["1"];
  const scores = [Number(game.scores[0]), Number(game.scores[1])];
  const round = Number(game.round);

  // Outcome. Missing picks only happen on timeout: a no-show loses; both
  // no-show (or same player / identical fame) is a replay.
  let winnerIndex: number | null = null;
  let replay = false;
  if (p0 && p1) {
    if (p0.playerId === p1.playerId || Number(p0.fameScore) === Number(p1.fameScore)) {
      replay = true;
    } else {
      winnerIndex = Number(p0.fameScore) < Number(p1.fameScore) ? 0 : 1;
    }
  } else if (p0 && !p1) {
    winnerIndex = 0;
  } else if (!p0 && p1) {
    winnerIndex = 1;
  } else {
    replay = true;
  }
  if (winnerIndex !== null) scores[winnerIndex] += 1;

  const over = winnerIndex !== null && scores[winnerIndex] >= WIN_SCORE;

  // Single-resolver guard: only the invocation that sees the round still live
  // (same deadline, still active) resolves. It then changes deadline/status,
  // so any concurrent submit/timeout for this round fails the condition.
  const guard = {
    ConditionExpression: "deadline = :curD AND #s = :active",
    names: { "#s": "status" } as Record<string, string>,
    values: { ":curD": Number(game.deadline), ":active": "active" } as Record<string, unknown>,
  };

  try {
    if (over) {
      await doc.send(
        new UpdateCommand({
          TableName: GAMES,
          Key: { gameId },
          UpdateExpression: "SET scores = :s, #s = :finished",
          ConditionExpression: guard.ConditionExpression,
          ExpressionAttributeNames: guard.names,
          ExpressionAttributeValues: { ...guard.values, ":s": scores, ":finished": "finished" },
        })
      );
    } else {
      const nextRound = replay ? round : round + 1;
      const category = await randomCategory();
      await doc.send(
        new UpdateCommand({
          TableName: GAMES,
          Key: { gameId },
          UpdateExpression:
            "SET scores = :s, #r = :nr, category = :c, deadline = :d, picks = :empty",
          ConditionExpression: guard.ConditionExpression,
          ExpressionAttributeNames: { ...guard.names, "#r": "round" },
          ExpressionAttributeValues: {
            ...guard.values,
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

  const reveal = (p: any) =>
    p ? { playerId: p.playerId, playerName: p.playerName, fameScore: p.fameScore } : null;

  await pushBoth(domainName, stage, players, {
    type: "roundResult",
    round,
    replay,
    winnerIndex,
    scores,
    picks: [reveal(p0), reveal(p1)],
  });

  if (over) {
    await pushBoth(domainName, stage, players, { type: "matchOver", scores, winnerIndex });
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

// A socket bound to an active game dropped. Finish the game; the other player
// wins by abandonment. Guarded so a double-disconnect resolves once.
export async function abandonGame(
  domainName: string,
  stage: string,
  gameId: string,
  leaverConnectionId: string
): Promise<void> {
  const g = await doc.send(new GetCommand({ TableName: GAMES, Key: { gameId } }));
  const game = g.Item;
  if (!game || game.status !== "active") return;

  const players = game.players as Player[];
  const winnerIndex = players.findIndex((p) => p.connectionId !== leaverConnectionId);

  try {
    await doc.send(
      new UpdateCommand({
        TableName: GAMES,
        Key: { gameId },
        UpdateExpression: "SET #s = :finished",
        ConditionExpression: "#s = :active",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":finished": "finished", ":active": "active" },
      })
    );
  } catch (e) {
    if (isConditionFail(e)) return; // already finished
    throw e;
  }

  if (winnerIndex >= 0) {
    await push(domainName, stage, players[winnerIndex].connectionId, {
      type: "opponentLeft",
      winnerIndex,
      scores: [Number(game.scores[0]), Number(game.scores[1])],
    }).catch(() => undefined);
  }
}
