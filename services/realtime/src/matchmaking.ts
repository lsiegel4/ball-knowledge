import type {
  APIGatewayProxyWebsocketEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { randomUUID } from "node:crypto";
import {
  GetCommand,
  UpdateCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { doc, GAMES, CONNECTIONS, MATCHMAKING, push } from "./shared";
import { startRound } from "./game";

const QUEUE_KEY = { pk: "queue" };
const MAX_ATTEMPTS = 5;
const GAME_TTL_SECONDS = 2 * 60 * 60;

const isConditionFail = (e: unknown) =>
  (e as { name?: string }).name === "ConditionalCheckFailedException";

const isGone = (e: unknown) => (e as { name?: string }).name === "GoneException";

export const findMatch = async (
  event: APIGatewayProxyWebsocketEventV2
): Promise<APIGatewayProxyResultV2> => {
  const { connectionId: me, domainName, stage } = event.requestContext;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const queue = await doc.send(
      new GetCommand({ TableName: MATCHMAKING, Key: QUEUE_KEY })
    );
    const waiter: string | undefined = queue.Item?.waitingConn;

    // Already waiting (duplicate findMatch) — idempotent.
    if (waiter === me) {
      await push(domainName, stage, me, { type: "waiting" });
      return { statusCode: 200 };
    }

    if (!waiter) {
      // Case A: claim the empty slot as the waiter.
      try {
        await doc.send(
          new UpdateCommand({
            TableName: MATCHMAKING,
            Key: QUEUE_KEY,
            UpdateExpression: "SET waitingConn = :me",
            ConditionExpression: "attribute_not_exists(waitingConn)",
            ExpressionAttributeValues: { ":me": me },
          })
        );
      } catch (e) {
        if (isConditionFail(e)) continue; // someone else became waiter, retry
        throw e;
      }
      // Confirm the socket is still alive. If the push fails (socket closed
      // between claim and now — a slow cold start can outlive the socket),
      // roll back the claim so we never leave a dead waiter in the queue.
      try {
        await push(domainName, stage, me, { type: "waiting" });
      } catch (e) {
        if (!isGone(e)) throw e;
        await doc
          .send(
            new UpdateCommand({
              TableName: MATCHMAKING,
              Key: QUEUE_KEY,
              UpdateExpression: "REMOVE waitingConn",
              ConditionExpression: "waitingConn = :me",
              ExpressionAttributeValues: { ":me": me },
            })
          )
          .catch((err) => {
            if (!isConditionFail(err)) throw err;
          });
      }
      return { statusCode: 200 };
    }

    // Case B: grab THIS specific waiter. Guarding the value (not just presence)
    // prevents the ABA problem where a stale read pairs with the wrong player.
    try {
      await doc.send(
        new UpdateCommand({
          TableName: MATCHMAKING,
          Key: QUEUE_KEY,
          UpdateExpression: "REMOVE waitingConn",
          ConditionExpression: "waitingConn = :them",
          ExpressionAttributeValues: { ":them": waiter },
        })
      );
    } catch (e) {
      if (isConditionFail(e)) continue; // waiter changed, retry
      throw e;
    }

    await startGame(domainName, stage, waiter, me);
    return { statusCode: 200 };
  }

  await push(domainName, stage, me, {
    type: "matchError",
    message: "matchmaking busy, try again",
  });
  return { statusCode: 200 };
};

async function startGame(
  domainName: string,
  stage: string,
  connA: string,
  connB: string
): Promise<void> {
  const gameId = randomUUID();

  await doc.send(
    new PutCommand({
      TableName: GAMES,
      Item: {
        gameId,
        status: "active",
        players: [{ connectionId: connA }, { connectionId: connB }],
        scores: [0, 0],
        round: 1,
        category: null,
        picks: {},
        deadline: null,
        expireAt: Math.floor(Date.now() / 1000) + GAME_TTL_SECONDS,
      },
    })
  );

  // Link each live socket to the game. Guard on the row still existing so a
  // socket that dropped mid-match isn't resurrected as a phantom row.
  await Promise.all(
    [connA, connB].map((c) =>
      doc
        .send(
          new UpdateCommand({
            TableName: CONNECTIONS,
            Key: { connectionId: c },
            UpdateExpression: "SET gameId = :g",
            ConditionExpression: "attribute_exists(connectionId)",
            ExpressionAttributeValues: { ":g": gameId },
          })
        )
        .catch((e) => {
          if (!isConditionFail(e)) throw e;
        })
    )
  );

  await Promise.all(
    [connA, connB].map((c) =>
      push(domainName, stage, c, { type: "matchFound", gameId, round: 1 }).catch(
        () => undefined // opponent may have vanished; abandonment handled later
      )
    )
  );

  // Kick off round 1: assign a category + deadline, push roundStart to both.
  await startRound(domainName, stage, gameId, 1, [
    { connectionId: connA },
    { connectionId: connB },
  ]);
}
