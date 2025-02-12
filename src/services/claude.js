import axios from 'axios';

const claudeClient = axios.create({
    baseURL: 'https://api.anthropic.com/v1',
    headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
    }
});

export const generateTitle = async (messageContent) => {
    try {
        const response = await claudeClient.post('/messages', {
            model: 'claude-3-sonnet-20240229',
            max_tokens: 30,
            messages: [
                {
                    role: 'user',
                    content: `Generate a concise title (max 6 words) for this message: "${messageContent}". Return only the title.`
                }
            ]
        });

        return response.data.content[0].text.trim();
    } catch (error) {
        console.error('Claude API error:', error.response?.data || error.message);
        throw new Error('Failed to generate title');
    }
};

export const formatAIResponse = async (text) => {
    try {
        const response = await claudeClient.post('/messages', {
            model: 'claude-3-sonnet-20240229',
            max_tokens: 1000,
            messages: [
                {
                    role: 'user',
                    content: `Format this text for better readability. Use markdown to:
1. Highlight important terms, commands, and technical details with backticks
2. Use bold for key concepts and important warnings
3. Create proper paragraphs and lists
4. Add section headers where appropriate
5. Preserve any code blocks or file paths
6. Keep the technical accuracy intact

Text to format:
${text}

Return only the formatted text, no explanations.`
                }
            ]
        });

        return response.data.content[0].text.trim();
    } catch (error) {
        console.error('Claude formatting error:', error.response?.data || error.message);
        throw new Error('Failed to format response');
    }
}; 