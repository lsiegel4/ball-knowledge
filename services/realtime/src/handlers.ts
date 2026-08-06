import type {
  APIGatewayProxyWebsocketEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CONNECTIONS = process.env.CONNECTIONS_TABLE!;

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
  await doc.send(
    new DeleteCommand({
      TableName: CONNECTIONS,
      Key: { connectionId: event.requestContext.connectionId },
    })
  );
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
