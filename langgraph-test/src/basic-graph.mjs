import "dotenv/config";
// ============================================================
// LangGraph 基础示例 —— 一个简单的两步骤顺序执行图
// 演示：状态定义 → 节点函数 → 构图连线 → 编译 → 调用
// ============================================================

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

// -------------------------------------------------------
// 1. 定义状态（State）
// -------------------------------------------------------
// Annotation.Root 声明整张图共享的状态结构。
// text 字段使用自定义 reducer: 新值覆盖旧值（_prev 忽略），
// default 提供初始空字符串。

// Annotation 用于创建State,指定默认值default，和合并逻辑 reducer
const StateAnnotation = Annotation.Root({
  text: Annotation({
    reducer: (_prev, next) => next, // 用下一个节点的返回值替换当前 text
    default: () => "", // 初始值
  }),
});

// -------------------------------------------------------
// 2. 定义节点函数（Node Functions）
// -------------------------------------------------------
// 每个节点接收当前 state，返回要更新的部分状态。
// 框架会将返回的对象 merge 回全局状态（通过各字段的 reducer）。

// 节点 step1: 在 state.text 末尾追加 "=> step1"
const step1 = (state) => ({ text: `${state.text}=> step1` });

// 节点 step2: 在 state.text 末尾继续追加 "=> step2"
const step2 = (state) => ({ text: `${state.text}=> step2` });

// -------------------------------------------------------
// 3. 构建图结构（Graph Construction）
// -------------------------------------------------------
// 流程: START → step1 → step2 → END
//       ^       ^        ^       ^
//      起点    节点1     节点2   终点
//
// 边（edge）定义了数据的流向：
//   START → step1  图入口，先进 step1
//   step1 → step2  step1 执行完进入 step2
//   step2 → END    step2 执行完图结束
const graph = new StateGraph(StateAnnotation) // 传入状态定义
  .addNode("step1", step1) // 注册节点 step1
  .addNode("step2", step2) // 注册节点 step2
  .addEdge(START, "step1") // 起点 → step1
  .addEdge("step1", "step2") // step1 → step2
  .addEdge("step2", END) // step2 → 终点
  .compile(); // 编译为可调用对象

// -------------------------------------------------------
// 4. （可选）导出为 Mermaid 流程图
// -------------------------------------------------------
// 生成的 Mermaid 源码可粘贴到 https://mermaid.live
// 或 Markdown 的 ```mermaid 代码块中渲染。
const drawable = await graph.getGraphAsync();
const mermaid = drawable.drawMermaid({ withStyle: true });

console.log("=== Mermaid 图结构 ===");
console.log(mermaid);

// -------------------------------------------------------
// 5. 执行图（Invoke）
// -------------------------------------------------------
// invoke 接收初始 state（可只传部分字段，其余用 default），
// 然后按 START → ... → END 的顺序依次执行每个节点。
const result = await graph.invoke({ text: "hello" });

// 预期输出: { text: "hello=> step1=> step2" }
// 执行路径:
//   START → step1:  "hello"            → "hello=> step1"
//         → step2:  "hello=> step1"     → "hello=> step1=> step2"
//         → END:    返回最终状态
console.log(result, "最终结果");

// 执行步骤
// invoke({ text: "hello" })
//   ↓
// state = { text: "hello" }        ← default 填充 + 用户传参合并
//   ↓
// 调用 step1(state)
//   ↓
// node1_output = { text: "hello=> step1" }
//   ↓
// state.text = reducer("hello", "hello=> step1")    /* 等于 "hello=> step1" */
//   ↓
// 调用 step2(state)
//   ↓
// node2_output = { text: "hello=> step1=> step2" }
//   ↓
// state.text = reducer("hello=> step1", "hello=> step1=> step2")
//   ↓
// 返回 state = { text: "hello=> step1=> step2" }
