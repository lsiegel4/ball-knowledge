import type {
  APIGatewayRequestAuthorizerEvent,
  APIGatewayAuthorizerResult,
} from "aws-lambda";
import { CognitoJwtVerifier } from "aws-jwt-verify";

// Verifier caches the pool's JWKS across warm invocations. idToken carries the
// user's identity (sub, email); we accept it since the SPA already holds it.
const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.USER_POOL_ID!,
  clientId: process.env.USER_POOL_CLIENT_ID!,
  tokenUse: "id",
});

function policy(
  principalId: string,
  effect: "Allow" | "Deny",
  methodArn: string,
  context: Record<string, string> = {}
): APIGatewayAuthorizerResult {
  return {
    principalId,
    policyDocument: {
      Version: "2012-10-17",
      Statement: [
        { Action: "execute-api:Invoke", Effect: effect, Resource: methodArn },
      ],
    },
    context,
  };
}

// WS $connect authorizer
export const authorize = async (
  event: APIGatewayRequestAuthorizerEvent
): Promise<APIGatewayAuthorizerResult> => {
  const token = event.queryStringParameters?.token;
  if (!token) return policy("anonymous", "Deny", event.methodArn);

  try {
    const payload = await verifier.verify(token);
    // context flows to $connect as event.requestContext.authorizer.userId.
    return policy(payload.sub, "Allow", event.methodArn, { userId: payload.sub });
  } catch {
    return policy("anonymous", "Deny", event.methodArn);
  }
};
