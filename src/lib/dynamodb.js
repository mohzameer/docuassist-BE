// src/lib/dynamodb.js
import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDB({
    region: process.env.AWS_REGION || 'eu-central-1', // Ensure the region is set correctly
    // Add other configurations if needed
});

const dynamoDB = DynamoDBDocument.from(client);

export default dynamoDB;