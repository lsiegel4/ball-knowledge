import type {
  APIGatewayProxyWebsocketEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { PutCommand, DeleteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { doc, CONNECTIONS, MATCHMAKING } from "./shared";

// Orphan safety net: a row untouched for 2h self-deletes via TTL.
const TTL_SECONDS = 2 * 60 * 60;

export const connect = async (
  event: APIGatewayProxyWebsocketEventV2
): Promise<APIGatewayProxyResultV2> => {
  await doc.send(
    new PutCommand({
      TableName: CONNECTIONS,
      Item: {
        connectionId: event.requestContext.connectionId,
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
  const connectionId = event.requestContext.connectionId;

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
