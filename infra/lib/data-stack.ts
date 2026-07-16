import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

export class DataStack extends cdk.Stack {
  public readonly rawBucket: s3.Bucket;
  public readonly playersTable: dynamodb.Table;
  public readonly dailyPicksTable: dynamodb.Table;
  public readonly dailyResultsTable: dynamodb.Table;

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

    new cdk.CfnOutput(this, "RawBucketName", { value: this.rawBucket.bucketName });
    new cdk.CfnOutput(this, "PlayersTableName", { value: this.playersTable.tableName });
    new cdk.CfnOutput(this, "DailyPicksTableName", { value: this.dailyPicksTable.tableName });
    new cdk.CfnOutput(this, "DailyResultsTableName", { value: this.dailyResultsTable.tableName });
  }
}
