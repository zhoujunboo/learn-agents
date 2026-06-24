import "dotenv/config";
import { RunnablePick, RunnableSequence } from "@langchain/core/runnables";

//再就是 RunnablePick，这个就是从对象里取一些属性：
const inputData = {
  name: "神光",
  age: 30,
  city: "北京",
  country: "中国",
  email: "shenguang@example.com",
  phone: "+86-13800138000",
};

const chain = RunnableSequence.from([
  (input) => ({
    ...input,
    fullInfo: `${input.name}，${input.age}岁，来自${input.city}`,
  }),
  new RunnablePick(["name", "fullInfo"]),
]);

const result = await chain.invoke(inputData);
console.log(result);

// { name: '神光', fullInfo: '神光，30岁，来自北京' }
