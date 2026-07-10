import "dotenv/config";
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";

// ============================================================
// 条件路由示例 —— 根据输入内容走不同分支
// ============================================================

// ---- 1. 状态定义 ----
// query:  用户输入的问题
// route:  路由结果（"math" 或 "chat"），由 router 节点填写
// answer: 最终回答
const StateAnnotation = Annotation.Root({
  query: Annotation({ reducer: (_prev, next) => next, default: () => "" }),
  route: Annotation({ reducer: (_prev, next) => next, default: () => "chat" }),
  answer: Annotation({ reducer: (_prev, next) => next, default: () => "" }),
});

const router = (state) => {
  const isMath = /[+\-*/]/.test(state.query);
  return { route: isMath ? "math" : "chat" };
};
const mathNode = (state) => {
  try {
    return { answer: String(eval(state.query)) };
  } catch {
    return { answer: "表达式无法计算" };
  }
};
const chatNode = (state) => ({ answer: `你说的是：${state.query}` });

// ---- 3. 构图 ----
// 流程：
//   START → router ──(query 含运算符)──→ math → END
//                   ──(否则)────────────→ chat → END
const graph = new StateGraph(StateAnnotation)
  .addNode("router", router)
  .addNode("math", mathNode)
  .addNode("chat", chatNode)
  .addEdge(START, "router")
  // 条件边：根据 router 返回的 route 字段，决定走 math 还是 chat
  .addConditionalEdges("router", (state) => state.route, {
    math: "math", // 返回值 "math" → 走 math 节点
    chat: "chat", // 返回值 "chat" → 走 chat 节点
  })
  .addEdge("math", END)
  .addEdge("chat", END)
  .compile();

const drawable = await graph.getGraphAsync();
const mermaid = drawable.drawMermaid({ withStyle: true });
console.log(mermaid);

console.log("result:", await graph.invoke({ query: "你好" })); // → 走 chat
console.log("result:", await graph.invoke({ query: "10 * 8" })); // → 走 math

// invoke({ query: "你好" })
//   ↓
// 把传入值跟 default 合并 → state = { query: "你好", route: "", answer: "" }
//   ↓
// router 节点执行 → return { route: "chat" }
//   ↓
// 框架调 reducer → state = { query: "你好", route: "chat", answer: "" }
//   ↓
// chatNode 节点执行 → return { answer: "你说的是：你好" }
//   ↓
// 框架调 reducer → state = { query: "你好", route: "chat", answer: "你说的是：你好" }
//   ↓
// 到达 END，返回最终 state → { query: "你好", route: "chat", answer: "你说的是：你好" }

// ========================
// LangGraph 的 invoke 永远返回最终的状态对象，而状态的结构就是 StateAnnotation 定义的。

// result: { query: '你好', route: 'chat', answer: '你说的是：你好' }
// result: { query: '10 * 8', route: 'math', answer: '80' }
