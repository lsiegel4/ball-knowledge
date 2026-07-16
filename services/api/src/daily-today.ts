import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { todayET } from "./lib/day";

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const PICKS = process.env.DAILY_PICKS_TABLE!;
const RESULTS = process.env.DAILY_RESULTS_TABLE!;

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> => {
  const userId = event.requestContext.authorizer.jwt.claims.sub as string;
  const day = todayET();

  const [pick, results] = await Promise.all([
    doc.send(new GetCommand({ TableName: PICKS, Key: { day, userId } })),
    doc.send(new GetCommand({ TableName: RESULTS, Key: { day } })),
  ]);

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      day,
      pick: pick.Item ?? null,
      results: results.Item ?? null,
    }),
  };
};
