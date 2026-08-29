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
export const CATEGORY_STATS = process.env.CATEGORY_STATS_TABLE!;
export const USERS = process.env.USERS_TABLE!;
export const MATCH_RESULTS = process.env.MATCH_RESULTS_TABLE!;

// One management client per endpoint, reused across pushes within a warm
// invocation (a resolver pushes 4x — no need to rebuild the client each time).
const clients = new Map<string, ApiGatewayManagementApiClient>();
function mgmtClient(endpoint: string): ApiGatewayManagementApiClient {
  let c = clients.get(endpoint);
  if (!c) {
    c = new ApiGatewayManagementApiClient({ endpoint });
    clients.set(endpoint, c);
  }
  return c;
}

// Push a JSON message to a client socket. domain/stage come from the event's
// requestContext — that's the WS API's own management endpoint.
export async function push(
  domainName: string,
  stage: string,
  connectionId: string,
  payload: unknown
): Promise<void> {
  await mgmtClient(`https://${domainName}/${stage}`).send(
    new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(payload),
    })
  );
}
