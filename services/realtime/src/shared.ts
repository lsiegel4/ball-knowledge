import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";

export const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const CONNECTIONS = process.env.CONNECTIONS_TABLE!;
export const GAMES = process.env.GAMES_TABLE!;
export const MATCHMAKING = process.env.MATCHMAKING_TABLE!;
export const CATEGORIES = process.env.CATEGORIES_TABLE!;
export const PLAYERS = process.env.PLAYERS_TABLE!;

// Push a JSON message to a client socket. domain/stage come from the event's
// requestContext — that's the WS API's own management endpoint.
export async function push(
  domainName: string,
  stage: string,
  connectionId: string,
  payload: unknown
): Promise<void> {
  const client = new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`,
  });
  await client.send(
    new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(payload),
    })
  );
}
