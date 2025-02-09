import { ulid } from 'ulid';
import dynamoDB from '../lib/dynamodb.js';
import { success, error, notFound } from '../lib/response.js';
import auth from '../middleware/auth.js';
import { getCurrentTimestamp, validateRequiredFields } from '../utils/common.js';

export const createConversation = async (event) => {
    try {
        // Authenticate request
        const user = await auth(event);
        if (user.statusCode) return user;

        // Get actual userId from Users table using Cognito ID (user_id_ref)
        const userParams = {
            TableName: process.env.USERS_TABLE,
            IndexName: 'UserIdRefIndex',
            KeyConditionExpression: 'user_id_ref = :user_id_ref',
            ExpressionAttributeValues: {
                ':user_id_ref': user.userId // This is the Cognito ID
            }
        };

        const userResult = await dynamoDB.query(userParams);
        if (!userResult.Items || userResult.Items.length === 0) {
            return notFound('User not found');
        }

        const actualUserId = userResult.Items[0].userId;

        // Validate request body
        const { topic } = JSON.parse(event.body);
        const validation = validateRequiredFields({ topic }, ['topic']);
        if (!validation.isValid) {
            return error(new Error(validation.message));
        }

        const timestamp = getCurrentTimestamp();
        const conversationId = ulid();

        const params = {
            TableName: process.env.CONVERSATIONS_TABLE,
            Item: {
                userId: actualUserId,  // Using the actual userId from Users table
                conversationId: conversationId,
                topic: topic,
                created_at: timestamp,
                updated_at: timestamp,
                last_message_timestamp: null
            }
        };

        await dynamoDB.put(params);

        return success({
            conversationId,
            topic,
            created_at: timestamp,
            updated_at: timestamp
        });
    } catch (err) {
        console.error('Error creating conversation:', err);
        return error(err);
    }
}; 