/**
 * 视频理解 — qwen3.5-omni-flash
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
      { type: "text", text: "总结这个视频的主要内容" },
      {
        type: "video_url",
        video_url: {
          url: "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20241115/cqqkru/1.mp4",
        },
      },
    ],
  }),
]);

console.log("model: qwen3.5-omni-flash");
console.log(response.content);
