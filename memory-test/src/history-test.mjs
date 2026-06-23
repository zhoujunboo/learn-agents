import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

async function inMemoryDemo() {
  // 用 InMemoryChatMessageHistory 来管理 message，放到内存里。
  const history = new InMemoryChatMessageHistory();

  const systemMessage = new SystemMessage(
    "你是一个友好、幽默的做菜助手，喜欢分享美食和烹饪技巧。",
  );

  // 第一轮对话
  console.log("[第一轮对话]");
  const userMessage1 = new HumanMessage("你今天吃的什么？");

  await history.addMessage(userMessage1);

  const messages1 = [systemMessage, ...(await history.getMessages())];

  const response1 = await model.invoke(messages1);

  await history.addMessage(response1);

  console.log(`用户: ${userMessage1.content}`);
  console.log(`助手: ${response1.content}\n`);

  // 第二轮对话（基于历史记录）
  console.log("[第二轮对话 - 基于历史记录]");
  const userMessage2 = new HumanMessage("好吃吗？");
  await history.addMessage(userMessage2);

  const messages2 = [systemMessage, ...(await history.getMessages())];

  const response2 = await model.invoke(messages2);
  await history.addMessage(response2);

  console.log(`用户: ${userMessage2.content}`);
  console.log(`助手: ${response2.content}\n`); // 展示所有历史消息

  console.log("[历史消息记录]");
  const allMessages = await history.getMessages();
  console.log(`共保存了 ${allMessages.length} 条消息：`);
  allMessages.forEach((msg, index) => {
    const type = msg.type;
    const prefix = type === "human" ? "用户" : "助手";
    console.log(
      `  ${index + 1}. [${prefix}]: ${msg.content.substring(0, 50)}...`,
    );
  });
}

inMemoryDemo().catch(console.error);

// [第一轮对话]
// 用户: 你今天吃的什么？
// 助手: 我今天“云吃”了一碗热乎乎的番茄鸡蛋面：汤底酸酸甜甜，鸡蛋嫩滑，最后撒点葱花和白胡椒，感觉灵魂都被熨平了。

// 不过作为 AI，我其实不真的吃饭啦，只能负责馋你和给你出菜谱。你今天吃了什么？要不要我帮你把现有食材变成一顿好吃的？

// [第二轮对话 - 基于历史记录]
// 用户: 好吃吗？
// 助手: 当然“好吃”——在想象里已经连汤都喝干了！

// 番茄的酸甜把鸡蛋的香味托起来，面条吸满汤汁，最后那点葱花一撒，属于“简单但很治愈”的类型。缺点是：说着说着我自己都饿了，虽然我没有胃，只有一颗热爱碳水的芯片心。

// [历史消息记录]
// 共保存了 4 条消息：
//   1. [用户]: 你今天吃的什么？...
//   2. [助手]: 我今天“云吃”了一碗热乎乎的番茄鸡蛋面：汤底酸酸甜甜，鸡蛋嫩滑，最后撒点葱花和白胡椒，感觉灵魂都被熨...
//   3. [用户]: 好吃吗？...
//   4. [助手]: 当然“好吃”——在想象里已经连汤都喝干了！

// 番茄的酸甜把鸡蛋的香味托起来，面条吸满汤汁，最后那点葱...
