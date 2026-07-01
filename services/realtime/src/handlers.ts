import type {
  APIGatewayProxyWebsocketEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";

export const connect = async (): Promise<APIGatewayProxyResultV2> => {
  return { statusCode: 200 };
};

export const disconnect = async (): Promise<APIGatewayProxyResultV2> => {
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
