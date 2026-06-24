import "dotenv/config";
import {
  RunnablePassthrough,
  RunnableLambda,
  RunnableSequence,
  RunnableMap,
} from "@langchain/core/runnables";

//然后是 RunnablePassthrough，它是传入的最初的值：

const chain = RunnableSequence.from([
  // 我们先用 RunnableLambda 对输入做了转换
  RunnableLambda.from((input) => ({ concept: input })),
  RunnableMap.from({
    // orinal 用 RunnablePassthrough 拿到原始值
    original: new RunnablePassthrough(),

    processed: RunnableLambda.from((obj) => ({
      concept: input,
      upper: obj.concept.toUpperCase(),
      length: obj.concept.length,
    })),
  }),
]);

//  上的 简化版本
// 只保留函数、对象即可，LangChain 会把函数转为 RunnableLambda，把对象转为 RunnableMap
// const chain2 = RunnableSequence.from([
//   (input) => ({ concept: input }),
//   {
//     original: new RunnablePassthrough(),
//     processed: RunnableLambda.from((obj) => ({
//       concept: input,
//       upper: obj.concept.toUpperCase(),
//       length: obj.concept.length,
//     })),
//   },
// ]);

// {
//   original: { concept: '神说要有光' },
//   processed: { concept: '神说要有光', upper: '神说要有光', length: 5 }
// }

//如果是想保留原始属性，只是扩展一些属性，用 RunnablePassthrough.assign
const chain3 = RunnableSequence.from([
  (input) => ({ concept: input }),
  RunnablePassthrough.assign({
    original: new RunnablePassthrough(),
    processed: (obj) => ({
      concept: input,
      upper: obj.concept.toUpperCase(),
      length: obj.concept.length,
    }),
  }),
]);

// 现在之前的属性也保留着，只是合并了新的属性，就像 Object.assign 一样。

// {
//   concept: '神说要有光',
//   original: { concept: '神说要有光' },
//   processed: { concept: '神说要有光', upper: '神说要有光', length: 5 }
// }

const input = "神说要有光";
const result = await chain3.invoke(input);
console.log(result);
