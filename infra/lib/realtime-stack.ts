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
  matchmakingTable: dynamodb.ITable;
  categoriesTable: dynamodb.ITable;
}

export class RealtimeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RealtimeStackProps) {
    super(scope, id, props);

    const env = {
      CONNECTIONS_TABLE: props.connectionsTable.tableName,
      GAMES_TABLE: props.gamesTable.tableName,
      MATCHMAKING_TABLE: props.matchmakingTable.tableName,
      CATEGORIES_TABLE: props.categoriesTable.tableName,
    };
    const fn = (name: string, entryFile: string, handler: string) =>
      new NodejsFunction(this, name, {
        runtime: Runtime.NODEJS_20_X,
        entry: path.join(__dirname, `../../services/realtime/src/${entryFile}`),
        handler,
        environment: env,
      });

    const connectFn = fn("ConnectFn", "handlers.ts", "connect");
    const disconnectFn = fn("DisconnectFn", "handlers.ts", "disconnect");
    const echoFn = fn("EchoFn", "handlers.ts", "echo");
    const findMatchFn = fn("FindMatchFn", "matchmaking.ts", "findMatch");
    const submitPickFn = fn("SubmitPickFn", "game.ts", "submitPick");

    // connect writes its Connection row; disconnect deletes it + clears queue.
    props.connectionsTable.grantWriteData(connectFn);
    props.connectionsTable.grantWriteData(disconnectFn);
    props.matchmakingTable.grantWriteData(disconnectFn);

    // findMatch claims the queue, creates the game, links sockets, starts round 1.
    props.matchmakingTable.grantReadWriteData(findMatchFn);
    props.gamesTable.grantWriteData(findMatchFn);
    props.connectionsTable.grantWriteData(findMatchFn);
    props.categoriesTable.grantReadData(findMatchFn);

    // submitPick validates + records a pick, resolves the round when both are in.
    props.connectionsTable.grantReadData(submitPickFn);
    props.gamesTable.grantReadWriteData(submitPickFn);
    props.categoriesTable.grantReadData(submitPickFn);

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
    wsApi.addRoute("findMatch", {
      integration: new WebSocketLambdaIntegration("FindMatchInt", findMatchFn),
    });
    wsApi.addRoute("submitPick", {
      integration: new WebSocketLambdaIntegration("SubmitPickInt", submitPickFn),
    });

    const stage = new WebSocketStage(this, "DevStage", {
      webSocketApi: wsApi,
      stageName: "dev",
      autoDeploy: true,
    });

    // Handlers that push messages back to clients need ManageConnections.
    wsApi.grantManageConnections(echoFn);
    wsApi.grantManageConnections(findMatchFn);
    wsApi.grantManageConnections(submitPickFn);

    new cdk.CfnOutput(this, "WsUrl", { value: stage.url });
  }
}
