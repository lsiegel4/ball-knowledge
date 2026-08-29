import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const USERS = process.env.USERS_TABLE!;

const HANDLE_RE = /^[a-zA-Z0-9_]{3,20}$/;

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

// Claim a handle. Set-once for v1: a user with a handle can't change it (would
// need to release the old reservation — deferred). The two conditional writes
// run in one transaction so a name is reserved atomically or not at all.
export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> => {
  const userId = event.requestContext.authorizer.jwt.claims.sub as string;

  let handle: string | undefined;
  try {
    handle = JSON.parse(event.body ?? "{}").handle;
  } catch {
    return json(400, { error: "invalid JSON body" });
  }
  if (!handle || !HANDLE_RE.test(handle)) {
    return json(400, { error: "handle must be 3-20 chars: letters, numbers, underscore" });
  }
  const lower = handle.toLowerCase();

  try {
    await doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            // Attach handle to the user, keeping any existing counters. Fails if
            // the user already claimed one.
            Update: {
              TableName: USERS,
              Key: { pk: `USER#${userId}` },
              UpdateExpression:
                "SET handle = :h, handleLower = :hl, " +
                "wins = if_not_exists(wins, :z), losses = if_not_exists(losses, :z), played = if_not_exists(played, :z)",
              ConditionExpression: "attribute_not_exists(handle)",
              ExpressionAttributeValues: { ":h": handle, ":hl": lower, ":z": 0 },
            },
          },
          {
            // Reserve the name. Fails if someone else holds it.
            Put: {
              TableName: USERS,
              Item: { pk: `HANDLE#${lower}`, userId },
              ConditionExpression: "attribute_not_exists(pk)",
            },
          },
        ],
      })
    );
  } catch (e) {
    // Transaction aborts if the user already has a handle OR the name is taken.
    // CancellationReasons[i].Code === "ConditionalCheckFailed" marks which item.
    const reasons = (e as { CancellationReasons?: { Code?: string }[] }).CancellationReasons;
    if (reasons) {
      if (reasons[0]?.Code === "ConditionalCheckFailed") {
        return json(409, { error: "you already have a handle" });
      }
      if (reasons[1]?.Code === "ConditionalCheckFailed") {
        return json(409, { error: "handle taken" });
      }
    }
    throw e;
  }

  return json(200, { handle });
};
