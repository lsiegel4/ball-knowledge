import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const USERS = process.env.USERS_TABLE!;
const MATCH_RESULTS = process.env.MATCH_RESULTS_TABLE!;
const RECENT_LIMIT = 10;

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

// Returns the caller's handle + H2H record. handle is null until they claim one
// — the SPA uses that to gate the app behind the choose-a-handle screen.
export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> => {
  const userId = event.requestContext.authorizer.jwt.claims.sub as string;

  const [profile, recent] = await Promise.all([
    doc.send(new GetCommand({ TableName: USERS, Key: { pk: `USER#${userId}` } })),
    // SK is "<endedAt>#<gameId>" — ScanIndexForward false = newest matches first.
    doc.send(
      new QueryCommand({
        TableName: MATCH_RESULTS,
        KeyConditionExpression: "userId = :u",
        ExpressionAttributeValues: { ":u": userId },
        ScanIndexForward: false,
        Limit: RECENT_LIMIT,
      })
    ),
  ]);
  const u = profile.Item;

  return json(200, {
    handle: u?.handle ?? null,
    wins: Number(u?.wins ?? 0),
    losses: Number(u?.losses ?? 0),
    played: Number(u?.played ?? 0),
    recent: (recent.Items ?? []).map((m) => ({
      gameId: m.gameId,
      won: m.won,
      oppHandle: m.oppHandle ?? null,
      myScore: Number(m.myScore),
      oppScore: Number(m.oppScore),
      endedAt: Number(m.endedAt),
    })),
  });
};
