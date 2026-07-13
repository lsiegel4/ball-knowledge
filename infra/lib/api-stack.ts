import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { HttpApi, HttpMethod, CorsHttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as path from "path";

interface ApiStackProps extends cdk.StackProps {
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  allowedOrigins: string[];
  playersTable: dynamodb.ITable;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const helloFn = new NodejsFunction(this, "HelloFn", {
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(__dirname, "../../services/api/src/hello.ts"),
      handler: "handler",
    });

    const authorizer = new HttpUserPoolAuthorizer("Authorizer", props.userPool, {
      userPoolClients: [props.userPoolClient],
    });

    const httpApi = new HttpApi(this, "HttpApi", {
      apiName: "ball-knowledge-api",
      defaultAuthorizer: authorizer,
      corsPreflight: {
        allowOrigins: props.allowedOrigins,
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.OPTIONS],
        allowHeaders: ["authorization", "content-type"],
      },
    });

    httpApi.addRoutes({
      path: "/hello",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("HelloIntegration", helloFn),
    });

    const searchFn = new NodejsFunction(this, "PlayerSearchFn", {
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(__dirname, "../../services/api/src/search.ts"),
      handler: "handler",
      environment: { PLAYERS_TABLE: props.playersTable.tableName },
    });
    props.playersTable.grantReadData(searchFn);

    httpApi.addRoutes({
      path: "/players/search",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("PlayerSearchIntegration", searchFn),
    });

    new cdk.CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
  }
}
