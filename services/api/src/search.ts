import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.PLAYERS_TABLE!;
const LIMIT = 10;

const fold = (s: string) =>
  s.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> => {
  const q = fold(event.queryStringParameters?.q ?? "");
  if (q.length < 2) {
    return { statusCode: 200, body: JSON.stringify({ players: [] }) };
  }

  const matches: { playerId: string; name: string; fameScore: number }[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const res = await doc.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: "contains(nameSearch, :q)",
        ExpressionAttributeValues: { ":q": q },
        ProjectionExpression: "playerId, #n, fameScore",
        ExpressionAttributeNames: { "#n": "name" },
        ExclusiveStartKey: lastKey,
      })
    );
    for (const it of res.Items ?? []) {
      matches.push({
        playerId: it.playerId,
        name: it.name,
        fameScore: Number(it.fameScore),
      });
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  matches.sort((a, b) => b.fameScore - a.fameScore);

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ players: matches.slice(0, LIMIT) }),
  };
};
