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
  categoryStatsTable: dynamodb.ITable;
}

export class RealtimeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RealtimeStackProps) {
    super(scope, id, props);

    const env = {
      CONNECTIONS_TABLE: props.connectionsTable.tableName,
      GAMES_TABLE: props.gamesTable.tableName,
      MATCHMAKING_TABLE: props.matchmakingTable.tableName,
      CATEGORIES_TABLE: props.categoriesTable.tableName,
      CATEGORY_STATS_TABLE: props.categoryStatsTable.tableName,
    };
    const fn = (name: string, entryFile: string, handler: string) =>
      new NodejsFunction(this, name, {
        runtime: Runtime.NODEJS_20_X,
        entry: path.join(__dirname, `../../services/realtime/src/${entryFile}`),
        handler,
        environment: env,
        // Resolver path chains ~13 DynamoDB/API calls; 3s default is too tight.
        // 256MB also gets more CPU, cutting cold-start + per-call latency.
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
      });

    const connectFn = fn("ConnectFn", "handlers.ts", "connect");
    const disconnectFn = fn("DisconnectFn", "handlers.ts", "disconnect");
    const echoFn = fn("EchoFn", "handlers.ts", "echo");
    const findMatchFn = fn("FindMatchFn", "matchmaking.ts", "findMatch");
    const submitPickFn = fn("SubmitPickFn", "game.ts", "submitPick");
    const roundTimeoutFn = fn("RoundTimeoutFn", "game.ts", "roundTimeout");

    // connect writes its Connection row; disconnect reads it, deletes it, clears
    // the queue, and abandons the game (opponent wins) if it was mid-match.
    props.connectionsTable.grantWriteData(connectFn);
    props.connectionsTable.grantReadWriteData(disconnectFn);
    props.matchmakingTable.grantWriteData(disconnectFn);
    props.gamesTable.grantReadWriteData(disconnectFn);

    // findMatch claims the queue, creates the game, links sockets, starts round 1.
    props.matchmakingTable.grantReadWriteData(findMatchFn);
    props.gamesTable.grantWriteData(findMatchFn);
    props.connectionsTable.grantWriteData(findMatchFn);
    props.categoriesTable.grantReadData(findMatchFn);

    // submitPick validates + records a pick, resolves the round when both are in.
    props.connectionsTable.grantReadData(submitPickFn);
    props.gamesTable.grantReadWriteData(submitPickFn);
    props.categoriesTable.grantReadData(submitPickFn);
    // Reads live pick counts to blend the effective score, ADD-increments them.
    props.categoryStatsTable.grantReadWriteData(submitPickFn);

    // roundTimeout resolves a round after the deadline (no-show / both no-show).
    props.connectionsTable.grantReadData(roundTimeoutFn);
    props.gamesTable.grantReadWriteData(roundTimeoutFn);
    props.categoriesTable.grantReadData(roundTimeoutFn);

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
    wsApi.addRoute("roundTimeout", {
      integration: new WebSocketLambdaIntegration("RoundTimeoutInt", roundTimeoutFn),
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
    wsApi.grantManageConnections(roundTimeoutFn);
    wsApi.grantManageConnections(disconnectFn);

    new cdk.CfnOutput(this, "WsUrl", { value: stage.url });
  }
}
