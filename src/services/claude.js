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