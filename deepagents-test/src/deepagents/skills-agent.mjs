// 演示 deepagents 的「技能（skills）」中间件：
// 让 Agent 读取本地技能库里的 SKILL.md，按技能说明画出一张 Excalidraw 流程图
import "dotenv/config"; // 加载 .env 环境变量
import { existsSync, mkdirSync } from "node:fs";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent, HumanMessage } from "langchain";
import {
  LocalShellBackend,        // 本地 shell 后端：让 Agent 能读写文件、执行命令
  createFilesystemMiddleware, // 文件系统中间件：提供 read_file/write_file 等工具
  createSkillsMiddleware,     // 技能中间件：把技能库暴露给 Agent 使用
} from "deepagents";

const skills = "/.agents/skills/"; // 技能库所在目录（虚拟根路径下）
const output = "src/deepagents/output/deepagents-skills-flow.excalidraw"; // 生成的图表保存路径

// 运行前检查：必须先安装好画图技能，否则给出安装命令并中止
if (!existsSync(".agents/skills/excalidraw-diagram-generator/SKILL.md")) {
  throw new Error(
    "未找到 excalidraw-diagram-generator，请先: npx skills add github/awesome-copilot --skill excalidraw-diagram-generator -y"
  );
}

// 确保输出目录存在（recursive: true 表示逐级创建，已存在也不报错）
mkdirSync("src/deepagents/output", { recursive: true });

// 初始化聊天模型（temperature=0 输出稳定；streaming=true 开启流式输出，边生成边显示）
const model = new ChatOpenAI({
  model: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  temperature: 0,
  streaming: true,
});

// 创建本地 shell 后端，作为文件读写和技能加载的统一入口
const backend = await LocalShellBackend.create({
  rootDir: ".",         // 以当前目录为根
  virtualMode: true,    // 虚拟模式：把 rootDir 映射为 /，对 Agent 隐藏真实路径
  inheritEnv: true,     // 继承当前进程的环境变量
});

// 创建 Agent：不注册普通工具，能力全部来自下面两个中间件
const agent = createAgent({
  model,
  tools: [],
  systemPrompt: "按 skills 库完成任务，需要时 read_file 对应 SKILL.md。中文回答。",
  middleware: [
    // 技能中间件：从 sources 指定目录加载技能，让 Agent 知道有哪些技能可用
    createSkillsMiddleware({ backend, sources: [skills] }),
    // 文件系统中间件：提供 read_file/write_file 等工具，供 Agent 读技能、写图表
    createFilesystemMiddleware({ backend }),
  ],
});

// 给 Agent 的任务描述：画一张讲解本 demo 工作流的流程图，并逐条列出排版要求
const prompt = [
  "画一张流程图，描述本项目的 skills-agent 工作流：",
  "用户 Prompt → createAgent → createSkillsMiddleware → createFilesystemMiddleware → 模型回复。",
  `保存为 ${output}。要求：`,
  "- 顶部大标题 + 副标题",
  "- 每个主节点 numbered（①②…）且框内 2～3 行中文说明",
  "- 右侧一列「说明：…」补充细节",
  "- 箭头上标注阶段名（如 invoke、wrapModelCall）",
  "- 底部图例（颜色含义 + 如何运行 demo）",
].join("\n"); // 用换行拼成一整段提示词

console.log("用户:", prompt);

// 工具函数：从流式返回的一个数据块（chunk）中安全地提取纯文本
// 模型返回的 content 可能是字符串，也可能是分段数组，这里统一处理成字符串
function chunkText(chunk) {
  if (!chunk?.content) return "";                              // 没有内容
  if (typeof chunk.content === "string") return chunk.content; // 直接是字符串
  if (Array.isArray(chunk.content)) {                          // 是数组：逐段取文本再拼接
    return chunk.content
      .map((p) => (typeof p === "string" ? p : (p?.text ?? "")))
      .join("");
  }
  return "";
}

// 用 streamEvents 运行 Agent：以「事件流」方式实时拿到模型输出和工具调用
// recursionLimit: 100 允许较多推理步数，因为画图往往需要多轮读技能、写文件
const stream = await agent.streamEvents(
  { messages: [new HumanMessage(prompt)] },
  { recursionLimit: 100 }
);

let skillsMetadata; // 用于记录本次实际加载了哪些技能
console.log("\n--- 流式输出 ---\n");

try {
  // 遍历事件流，根据事件类型分别处理
  for await (const event of stream) {
    // 1) 模型逐字输出：实时打印到终端
    if (event.event === "on_chat_model_stream") {
      const text = chunkText(event.data?.chunk);
      if (text) process.stdout.write(text);
    }
    // 2) 工具开始调用：打印工具名（只取路径最后一段，更简洁）
    if (event.event === "on_tool_start") {
      const name = event.name?.split("/").pop() ?? event.name;
      process.stdout.write(`\n\n→ ${name}\n\n`);
    }
    // 3) 链路结束且带有技能元数据：保存下来供最后打印
    if (event.event === "on_chain_end" && event.data?.output?.skillsMetadata) {
      skillsMetadata = event.data.output.skillsMetadata;
    }
  }
} catch (e) {
  // 出错时打印底层原因（优先 cause），再向上抛出
  console.error("\n\n[错误]", e.cause?.message ?? e.message);
  throw e;
}

// 收尾：打印用到的技能名，并根据文件是否生成给出下一步提示
console.log("\n");
console.log("skills:", skillsMetadata?.map((s) => s.name));
if (existsSync(output)) {
  console.log("图表:", output);
  console.log("打开: https://excalidraw.com → Open → 选择该文件");
} else {
  console.log("未生成:", output);
}

await backend.close(); // 关闭后端，释放资源