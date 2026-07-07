import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

// ============================================================
// 循环重试示例 —— 条件边指向自己，重复执行直到条件满足
// ============================================================

// ---- 1. 状态 ----
// tries:   已重试次数
// ok:      是否成功
// message: 当前状态描述
const StateAnnotation = Annotation.Root({
  tries: Annotation({ reducer: (_prev, next) => next, default: () => 0 }),
  ok: Annotation({ reducer: (_prev, next) => next, default: () => false }),
  message: Annotation({ reducer: (_prev, next) => next, default: () => "" }),
});

// ---- 2. 节点 ----
// 每次 tries +1，满 3 次才算成功
const attempt = (state) => {
  const tries = state.tries + 1;
  const ok = tries >= 3;
  return {
    tries,
    ok,
    message: ok ? `第 ${tries} 次成功` : `第 ${tries} 次失败，继续重试`,
  };
};

// ---- 3. 构图 ----
// 流程（关键自环）：
//   START → attempt ──(ok = false)──→ attempt ← 返回自己，形成循环
//                   ──(ok = true)───→ END     ← 成功则退出
const graph = new StateGraph(StateAnnotation)
  .addNode("attempt", attempt)
  .addEdge(START, "attempt")
  // 条件边指向 attempt 自己 = 循环重试，指向 END = 退出
  .addConditionalEdges("attempt", (state) => (state.ok ? "done" : "retry"), {
    retry: "attempt", // 返回 attempt，再来一次
    done: END, // 走到终点
  })
  .compile();

// ---- 4. 导出 Mermaid ----
const drawable = await graph.getGraphAsync();
const mermaid = drawable.drawMermaid({ withStyle: true });
console.log(mermaid);

// ---- 5. 执行 ----
const result = await graph.invoke({ tries: 0 });
console.log("result:", result);

// result: { tries: 3, ok: true, message: '第 3 次成功' }
