import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { WebSocketApi, WebSocketStage } from "aws-cdk-lib/aws-apigatewayv2";
import { WebSocketLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as path from "path";

interface RealtimeStackProps extends cdk.StackProps {
  gamesTable: dynamodb.ITable;
  connectionsTable: dynamodb.ITable;
}

export class RealtimeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RealtimeStackProps) {
    super(scope, id, props);

    const entry = path.join(__dirname, "../../services/realtime/src/handlers.ts");
    const fn = (name: string, handler: string) =>
      new NodejsFunction(this, name, {
        runtime: Runtime.NODEJS_20_X,
        entry,
        handler,
        environment: {
          CONNECTIONS_TABLE: props.connectionsTable.tableName,
          GAMES_TABLE: props.gamesTable.tableName,
        },
      });

    const connectFn = fn("ConnectFn", "connect");
    const disconnectFn = fn("DisconnectFn", "disconnect");
    const echoFn = fn("EchoFn", "echo");

    // connect writes its Connection row; disconnect deletes it.
    props.connectionsTable.grantWriteData(connectFn);
    props.connectionsTable.grantWriteData(disconnectFn);

    const wsApi = new WebSocketApi(this, "WsApi", {
      apiName: "ball-knowledge-ws",
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration("ConnectInt", connectFn),
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration("DisconnectInt", disconnectFn),
      },
    });

    wsApi.addRoute("echo", {
      integration: new WebSocketLambdaIntegration("EchoInt", echoFn),
    });

    const stage = new WebSocketStage(this, "DevStage", {
      webSocketApi: wsApi,
      stageName: "dev",
      autoDeploy: true,
    });

    // echo handler calls back into the WS API to push messages, so it needs
    // execute-api:ManageConnections on this API.
    wsApi.grantManageConnections(echoFn);

    new cdk.CfnOutput(this, "WsUrl", { value: stage.url });
  }
}
