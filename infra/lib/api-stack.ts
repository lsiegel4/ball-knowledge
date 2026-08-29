import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { HttpApi, HttpMethod, CorsHttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as path from "path";

interface ApiStackProps extends cdk.StackProps {
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  allowedOrigins: string[];
  playersTable: dynamodb.ITable;
  dailyPicksTable: dynamodb.ITable;
  dailyResultsTable: dynamodb.ITable;
  usersTable: dynamodb.ITable;
  matchResultsTable: dynamodb.ITable;
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
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
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

    const dailyPickFn = new NodejsFunction(this, "DailyPickFn", {
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(__dirname, "../../services/api/src/daily-pick.ts"),
      handler: "handler",
      environment: {
        PLAYERS_TABLE: props.playersTable.tableName,
        DAILY_PICKS_TABLE: props.dailyPicksTable.tableName,
      },
    });
    props.playersTable.grantReadData(dailyPickFn);
    props.dailyPicksTable.grantWriteData(dailyPickFn);

    httpApi.addRoutes({
      path: "/daily/pick",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration("DailyPickIntegration", dailyPickFn),
    });

    const dailyTodayFn = new NodejsFunction(this, "DailyTodayFn", {
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(__dirname, "../../services/api/src/daily-today.ts"),
      handler: "handler",
      environment: {
        DAILY_PICKS_TABLE: props.dailyPicksTable.tableName,
        DAILY_RESULTS_TABLE: props.dailyResultsTable.tableName,
      },
    });
    props.dailyPicksTable.grantReadData(dailyTodayFn);
    props.dailyResultsTable.grantReadData(dailyTodayFn);

    httpApi.addRoutes({
      path: "/daily/today",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("DailyTodayIntegration", dailyTodayFn),
    });

    const tallyFn = new NodejsFunction(this, "DailyTallyFn", {
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(__dirname, "../../services/api/src/daily-tally.ts"),
      handler: "handler",
      timeout: cdk.Duration.seconds(60),
      environment: {
        DAILY_PICKS_TABLE: props.dailyPicksTable.tableName,
        DAILY_RESULTS_TABLE: props.dailyResultsTable.tableName,
      },
    });
    props.dailyPicksTable.grantReadData(tallyFn);
    props.dailyResultsTable.grantWriteData(tallyFn);

    // 05:30 UTC = just after midnight ET both DST seasons. Lambda tallies yesterday-ET.
    new events.Rule(this, "DailyTallySchedule", {
      schedule: events.Schedule.cron({ minute: "30", hour: "5" }),
      targets: [new targets.LambdaFunction(tallyFn)],
    });

    const meProfileFn = new NodejsFunction(this, "MeProfileFn", {
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(__dirname, "../../services/api/src/me-profile.ts"),
      handler: "handler",
      environment: {
        USERS_TABLE: props.usersTable.tableName,
        MATCH_RESULTS_TABLE: props.matchResultsTable.tableName,
      },
    });
    props.usersTable.grantReadData(meProfileFn);
    props.matchResultsTable.grantReadData(meProfileFn);

    httpApi.addRoutes({
      path: "/me/profile",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("MeProfileIntegration", meProfileFn),
    });

    const meHandleFn = new NodejsFunction(this, "MeHandleFn", {
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(__dirname, "../../services/api/src/me-handle.ts"),
      handler: "handler",
      environment: { USERS_TABLE: props.usersTable.tableName },
    });
    props.usersTable.grantReadWriteData(meHandleFn);

    httpApi.addRoutes({
      path: "/me/handle",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration("MeHandleIntegration", meHandleFn),
    });

    new cdk.CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
  }
}
