import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

export class DataStack extends cdk.Stack {
  public readonly rawBucket: s3.Bucket;
  public readonly playersTable: dynamodb.Table;
  public readonly dailyPicksTable: dynamodb.Table;
  public readonly dailyResultsTable: dynamodb.Table;
  public readonly gamesTable: dynamodb.Table;
  public readonly connectionsTable: dynamodb.Table;
  public readonly matchmakingTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.rawBucket = new s3.Bucket(this, "RawBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.playersTable = new dynamodb.Table(this, "PlayersTable", {
      tableName: "ball-knowledge-players",
      partitionKey: { name: "playerId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.dailyPicksTable = new dynamodb.Table(this, "DailyPicksTable", {
      tableName: "ball-knowledge-daily-picks",
      partitionKey: { name: "day", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.dailyResultsTable = new dynamodb.Table(this, "DailyResultsTable", {
      tableName: "ball-knowledge-daily-results",
      partitionKey: { name: "day", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Live H2H match state. gameId PK; expireAt (epoch seconds) TTL sweeps
    // abandoned matches so stale rows don't accumulate.
    this.gamesTable = new dynamodb.Table(this, "GamesTable", {
      tableName: "ball-knowledge-games",
      partitionKey: { name: "gameId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expireAt",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // connectionId -> game reverse index. Row lifetime = socket lifetime
    // ($connect writes, $disconnect deletes). gameId is a mutable field set at
    // matchFound, cleared at gameEnd. TTL is a safety net for orphaned rows.
    this.connectionsTable = new dynamodb.Table(this, "ConnectionsTable", {
      tableName: "ball-knowledge-connections",
      partitionKey: { name: "connectionId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expireAt",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Matchmaking queue. Single item (pk "queue") holds the current waiter.
    // Claims use conditional writes for atomic pairing (optimistic concurrency).
    this.matchmakingTable = new dynamodb.Table(this, "MatchmakingTable", {
      tableName: "ball-knowledge-matchmaking",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new cdk.CfnOutput(this, "RawBucketName", { value: this.rawBucket.bucketName });
    new cdk.CfnOutput(this, "PlayersTableName", { value: this.playersTable.tableName });
    new cdk.CfnOutput(this, "DailyPicksTableName", { value: this.dailyPicksTable.tableName });
    new cdk.CfnOutput(this, "DailyResultsTableName", { value: this.dailyResultsTable.tableName });
    new cdk.CfnOutput(this, "GamesTableName", { value: this.gamesTable.tableName });
    new cdk.CfnOutput(this, "ConnectionsTableName", { value: this.connectionsTable.tableName });
    new cdk.CfnOutput(this, "MatchmakingTableName", { value: this.matchmakingTable.tableName });
  }
}
