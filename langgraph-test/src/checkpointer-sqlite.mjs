import { existsSync, unlinkSync } from "node:fs";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

// 保存路径
const dbPath = "./src/checkpointer-demo.sqlite";

const StateAnnotation = Annotation.Root({
  visitCount: Annotation({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  message: Annotation({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
});

function recordVisit(state) {
  const visitCount = state.visitCount + 1;
  const message =
    visitCount === 1
      ? "这是你在本会话里第 1 次进入。"
      : `这是你在本会话里第 ${visitCount} 次进入`;
  return { visitCount, message };
}

const graph = new StateGraph(StateAnnotation)
  .addNode("recordVisit", recordVisit)
  .addEdge(START, "recordVisit")
  .addEdge("recordVisit", END);

if (existsSync(dbPath)) {
  unlinkSync(dbPath);
}

// 保存到Sqlite，只需要给一个保存路径
const checkpointer = SqliteSaver.fromConnString(dbPath);
const app = graph.compile({ checkpointer });

const user1 = { configurable: { thread_id: "用户-小张" } };
const user2 = { configurable: { thread_id: "用户-小李" } };

const res1 = await app.invoke({}, user1);
const res2 = await app.invoke({}, user1);
const res3 = await app.invoke({}, user1);
const res4 = await app.invoke({}, user2);

console.log(res1);
console.log(res2);
console.log(res3);
console.log(res4);

// { visitCount: 1, message: '这是你在本会话里第 1 次进入。' }
// { visitCount: 2, message: '这是你在本会话里第 2 次进入' }
// { visitCount: 3, message: '这是你在本会话里第 3 次进入' }
// { visitCount: 1, message: '这是你在本会话里第 1 次进入。' }
