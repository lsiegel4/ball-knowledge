import type {
  APIGatewayProxyWebsocketEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { PutCommand, DeleteCommand, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { doc, CONNECTIONS, MATCHMAKING } from "./shared";
import { abandonGame } from "./game";

// Orphan safety net: a row untouched for 2h self-deletes via TTL.
const TTL_SECONDS = 2 * 60 * 60;

export const connect = async (
  event: APIGatewayProxyWebsocketEventV2
): Promise<APIGatewayProxyResultV2> => {
  // The authorizer proved this socket's identity at handshake and passed the
  // Cognito sub through as context. Persist it so later handlers (findMatch,
  // submitPick) trust the socket without re-validating the JWT.
  const userId = (event.requestContext as { authorizer?: { userId?: string } })
    .authorizer?.userId;

  await doc.send(
    new PutCommand({
      TableName: CONNECTIONS,
      Item: {
        connectionId: event.requestContext.connectionId,
        userId: userId ?? null,
        gameId: null,
        expireAt: Math.floor(Date.now() / 1000) + TTL_SECONDS,
      },
    })
  );
  return { statusCode: 200 };
};

export const disconnect = async (
  event: APIGatewayProxyWebsocketEventV2
): Promise<APIGatewayProxyResultV2> => {
  const { connectionId, domainName, stage } = event.requestContext;

  // Read the row before deleting to learn if this socket was in a game.
  const conn = await doc.send(
    new GetCommand({ TableName: CONNECTIONS, Key: { connectionId } })
  );
  const gameId: string | undefined = conn.Item?.gameId ?? undefined;

  await doc.send(
    new DeleteCommand({ TableName: CONNECTIONS, Key: { connectionId } })
  );

  // If this socket was the matchmaking waiter, clear the slot so nobody pairs
  // with a dead connection. Guard on the value — no-op if someone else waits.
  await doc
    .send(
      new UpdateCommand({
        TableName: MATCHMAKING,
        Key: { pk: "queue" },
        UpdateExpression: "REMOVE waitingConn",
        ConditionExpression: "waitingConn = :me",
        ExpressionAttributeValues: { ":me": connectionId },
      })
    )
    .catch((e) => {
      if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;
    });

  // Bound to a live game -> opponent wins by abandonment.
  if (gameId) await abandonGame(domainName, stage, gameId, connectionId);

  return { statusCode: 200 };
};

export const echo = async (
  event: APIGatewayProxyWebsocketEventV2
): Promise<APIGatewayProxyResultV2> => {
  const { connectionId, domainName, stage } = event.requestContext;

  // The management API endpoint is the WS API's own domain — that's how a
  // Lambda pushes a message back out to a connected client.
  const client = new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`,
  });

  await client.send(
    new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify({ echo: event.body ?? null }),
    })
  );

  return { statusCode: 200 };
};
