import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const USERS = process.env.USERS_TABLE!;

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

  const res = await doc.send(
    new GetCommand({ TableName: USERS, Key: { pk: `USER#${userId}` } })
  );
  const u = res.Item;

  return json(200, {
    handle: u?.handle ?? null,
    wins: Number(u?.wins ?? 0),
    losses: Number(u?.losses ?? 0),
    played: Number(u?.played ?? 0),
  });
};
