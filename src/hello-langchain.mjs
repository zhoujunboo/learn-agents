import dotenv from 'dotenv';
import { ChatOpenAI } from '@langchain/openai';

dotenv.config({ path: '../../.env' });

const model = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL,
    apiKey: process.env.OPENAI_API_KEY,
    configuration: {
        baseURL: process.env.OPENAI_BASE_URL,
    }
});

const response = await model.invoke('介绍下自己');

console.log(response.content);
