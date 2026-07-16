import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { todayET } from "./lib/day";

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const PLAYERS = process.env.PLAYERS_TABLE!;
const PICKS = process.env.DAILY_PICKS_TABLE!;

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> => {
  const userId = event.requestContext.authorizer.jwt.claims.sub as string;

  let playerId: string | undefined;
  try {
    playerId = JSON.parse(event.body ?? "{}").playerId;
  } catch {
    return json(400, { error: "invalid JSON body" });
  }
  if (!playerId) return json(400, { error: "playerId required" });

  // Look up name + fameScore server-side. Never trust client-sent scores.
  const player = await doc.send(
    new GetCommand({ TableName: PLAYERS, Key: { playerId } })
  );
  if (!player.Item) return json(400, { error: "unknown playerId" });

  const day = todayET();
  await doc.send(
    new PutCommand({
      TableName: PICKS,
      Item: {
        day,
        userId,
        playerId,
        playerName: player.Item.name,
        fameScore: player.Item.fameScore,
        submittedAt: new Date().toISOString(),
      },
    })
  );

  return json(200, { day, playerId, playerName: player.Item.name });
};
