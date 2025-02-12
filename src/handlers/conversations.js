import { ulid } from 'ulid';
import dynamoDB from '../lib/dynamodb.js';
import { success, error, notFound } from '../lib/response.js';
import auth from '../middleware/auth.js';
import { getCurrentTimestamp, validateRequiredFields } from '../utils/common.js';
import { getAIResponse } from '../services/ai.js';

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

export const createMessage = async (event) => {
    try {
        // 1. Authenticate request
        const user = await auth(event);
        if (user.statusCode) return user;

        // 2. Get actual userId from Users table
        const userParams = {
            TableName: process.env.USERS_TABLE,
            IndexName: 'UserIdRefIndex',
            KeyConditionExpression: 'user_id_ref = :user_id_ref',
            ExpressionAttributeValues: {
                ':user_id_ref': user.userId
            }
        };

        const userResult = await dynamoDB.query(userParams);
        if (!userResult.Items || userResult.Items.length === 0) {
            return notFound('User not found');
        }

        const actualUserId = userResult.Items[0].userId;
        const orgId = userResult.Items[0].orgId;

        // 3. Validate request
        const { conversationId } = event.pathParameters;
        const { content } = JSON.parse(event.body);

        const validation = validateRequiredFields({ content }, ['content']);
        if (!validation.isValid) {
            return error(new Error(validation.message));
        }

        // 4. Verify conversation ownership
        const conversationParams = {
            TableName: process.env.CONVERSATIONS_TABLE,
            Key: {
                userId: actualUserId,
                conversationId: conversationId
            }
        };

        const conversationResult = await dynamoDB.get(conversationParams);
        if (!conversationResult.Item) {
            return notFound('Conversation not found or access denied');
        }

        const timestamp = getCurrentTimestamp();
        const messageId = ulid();

        // Create user message
        const userMessageParams = {
            TableName: process.env.ALL_MESSAGES_TABLE,
            Item: {
                conversationId: conversationId,
                messageId: messageId,
                content: content,
                role: 'user',
                created_at: timestamp
            }
        };

        await dynamoDB.put(userMessageParams);

        // 6. Get AI response
        let aiResponse;
        let aiError = null;
        try {
            aiResponse = await getAIResponse(content, orgId);
            console.log('AI Response:', aiResponse?.scored_chunks);
        } catch (err) {
            console.error('AI Response Error:', err);
            aiError = err.message;
        }

        // If we have AI response, create AI message
        if (aiResponse?.scored_chunks && !aiError) {

            if (aiResponse?.scored_chunks.length === 0) {

                const aiMessageId = ulid();
                const aiTimestamp = getCurrentTimestamp();
                const aiMessageParams = {
                    TableName: process.env.ALL_MESSAGES_TABLE,
                    Item: {
                        conversationId: conversationId,
                        messageId: aiMessageId,
                        content: 'No AI response found',
                        role: 'assistant',
                        created_at: aiTimestamp
                    }
                };

                await dynamoDB.put(aiMessageParams);

                return success({
                    message: {
                        id: aiMessageId,
                        content: 'No AI response found',
                        role: 'assistant',
                        created_at: aiTimestamp
                    }
                });
            }

            const aiMessageId = ulid();
            const aiTimestamp = getCurrentTimestamp();
            const aiMessageParams = {
                TableName: process.env.ALL_MESSAGES_TABLE,
                Item: {
                    conversationId: conversationId,
                    messageId: aiMessageId,
                    content: aiResponse?.scored_chunks[0],
                    role: 'assistant',
                    created_at: aiTimestamp
                }
            };

            await dynamoDB.put(aiMessageParams);

            // Update conversation last_message_timestamp
            const updateConversationParams = {
                TableName: process.env.CONVERSATIONS_TABLE,
                Key: {
                    userId: actualUserId,
                    conversationId: conversationId
                },
                UpdateExpression: 'SET last_message_timestamp = :timestamp, updated_at = :updated_at',
                ExpressionAttributeValues: {
                    ':timestamp': aiTimestamp,
                    ':updated_at': aiTimestamp
                }
            };

            await dynamoDB.update(updateConversationParams);

            // Return successful AI response
            return success({
                message: {
                    id: aiMessageId,
                    content: JSON.stringify(aiResponse?.scored_chunks[0]),
                    role: 'assistant',
                    created_at: aiTimestamp
                }
            });
        } else {
            // Return error with user message ID for retry
            return error({
                error: aiError || 'Failed to get AI response',
                userMessageId: messageId,
                conversationId: conversationId
            });
        }

    } catch (err) {
        console.error('Error creating message:', err);
        return error(err);
    }
};

export const getConversations = async (event) => {
    try {
        // 1. Authenticate request
        const user = await auth(event);
        if (user.statusCode) return user;

        // 2. Get actual userId from Users table
        const userParams = {
            TableName: process.env.USERS_TABLE,
            IndexName: 'UserIdRefIndex',
            KeyConditionExpression: 'user_id_ref = :user_id_ref',
            ExpressionAttributeValues: {
                ':user_id_ref': user.userId
            }
        };

        const userResult = await dynamoDB.query(userParams);
        if (!userResult.Items || userResult.Items.length === 0) {
            return notFound('User not found');
        }

        const actualUserId = userResult.Items[0].userId;

        // 3. Query conversations for user
        const conversationsParams = {
            TableName: process.env.CONVERSATIONS_TABLE,
            KeyConditionExpression: 'userId = :userId',
            ExpressionAttributeValues: {
                ':userId': actualUserId
            }
        };

        const conversationsResult = await dynamoDB.query(conversationsParams);

        // 4. Return conversations list
        return success({
            conversations: conversationsResult.Items.map(conversation => ({
                conversationId: conversation.conversationId,
                topic: conversation.topic,
                created_at: conversation.created_at,
                updated_at: conversation.updated_at,
                last_message_timestamp: conversation.last_message_timestamp
            }))
        });

    } catch (err) {
        console.error('Error getting conversations:', err);
        return error(err);
    }
};

export const getMessages = async (event) => {
    try {
        // 1. Authenticate request
        const user = await auth(event);
        if (user.statusCode) return user;

        // 2. Get actual userId from Users table
        const userParams = {
            TableName: process.env.USERS_TABLE,
            IndexName: 'UserIdRefIndex',
            KeyConditionExpression: 'user_id_ref = :user_id_ref',
            ExpressionAttributeValues: {
                ':user_id_ref': user.userId
            }
        };

        const userResult = await dynamoDB.query(userParams);
        if (!userResult.Items || userResult.Items.length === 0) {
            return notFound('User not found');
        }

        const actualUserId = userResult.Items[0].userId;

        // 3. Verify conversation ownership
        const { conversationId } = event.pathParameters;
        const conversationParams = {
            TableName: process.env.CONVERSATIONS_TABLE,
            Key: {
                userId: actualUserId,
                conversationId: conversationId
            }
        };

        const conversationResult = await dynamoDB.get(conversationParams);
        if (!conversationResult.Item) {
            return notFound('Conversation not found or access denied');
        }

        // Get pagination parameters
        const limit = 100;
        const { lastKey } = event.queryStringParameters || {};

        const messagesParams = {
            TableName: process.env.ALL_MESSAGES_TABLE,
            KeyConditionExpression: 'conversationId = :conversationId',
            ExpressionAttributeValues: {
                ':conversationId': conversationId
            },
            Limit: limit,
            ScanIndexForward: true   // This will sort by messageId (ULID) in ascending order (oldest first)
        };

        if (lastKey) {
            messagesParams.ExclusiveStartKey = {
                conversationId: conversationId,
                messageId: lastKey
            };
        }

        const messagesResult = await dynamoDB.query(messagesParams);

        return success({
            messages: messagesResult.Items.map(message => ({
                messageId: message.messageId,
                content: message.content,
                role: message.role,
                created_at: message.created_at
            })),
            lastEvaluatedKey: messagesResult.LastEvaluatedKey?.messageId || null
        });

    } catch (err) {
        console.error('Error getting messages:', err);
        return error(err);
    }
}; 