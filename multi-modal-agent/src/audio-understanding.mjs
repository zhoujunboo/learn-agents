/**
 * 音频理解 — qwen3.5-omni-flash
 * DashScope OpenAI 兼容接口 + ChatOpenAI
 */
import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";

const model = new ChatOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  model: "qwen3.5-omni-flash",
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

const response = await model.invoke([
  new HumanMessage({
    content: [
      { type: "text", text: "这段音频里说了什么？" },
      {
        type: "input_audio",
        input_audio: {
          data: "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250211/tixcef/cherry.wav",
          format: "wav",
        },
      },
    ],
  }),
]);

console.log("model: qwen3.5-omni-flash");
console.log(response.content);
