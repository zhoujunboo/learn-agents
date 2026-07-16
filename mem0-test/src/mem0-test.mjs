import "dotenv/config";
import { MemoryClient } from "mem0ai";

const USER_ID = "demo-user";

function log(title, data) {
  console.log(`\n=== ${title} ===`);
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

async function main() {
  const client = new MemoryClient({
    apiKey: process.env.MEM0_API_KEY,
  });

  // const conversation = [
  //   { role: "user", content: "我是素食主义者，而且对坚果过敏。" },
  //   { role: "assistant", content: "好的，我会记住你的饮食偏好。" },
  //   { role: "user", content: "我住在北京，平时喜欢跑步。" },
  //   { role: "assistant", content: "已记录：北京、爱好跑步。" },
  // ];

  // // 添加记忆
  // const added = await client.add(conversation, { userId: USER_ID });
  // log("添加记忆", added);

  // // 搜索记忆
  // const searchResult = await client.search("用户的饮食限制是什么？中文回答", {
  //   filters: { user_id: USER_ID },
  //   topK: 5,
  // });
  // log("搜索记忆", searchResult);

  // 列出全部记忆
  const allMemories = await client.getAll({
    filters: { user_id: USER_ID },
    pageSize: 10,
  });
  log("列出全部记忆", allMemories);

  // // 获取单条记忆
  const firstMemory = allMemories.results?.[0] ?? searchResult.results?.[0];
  if (firstMemory?.id) {
    const memory = await client.get(firstMemory.id);
    log("获取单条记忆", memory);

    // 更新记忆
    const updated = await client.update(firstMemory.id, {
      text: `${memory.memory ?? firstMemory.memory}（已通过示例脚本更新）`,
    });
    log("更新记忆", updated);

    // 记忆变更历史
    const history = await client.history(firstMemory.id);
    log("记忆变更历史", history);
  }

  // // 清理记忆
  if (process.argv.includes("--cleanup")) {
    const deleted = await client.deleteAll({ userId: USER_ID });
    log("清理测试数据", deleted);
  } else {
    console.log(
      "\n提示: 运行 `node src/mem0-test.mjs --cleanup` 可删除本次测试用户的全部记忆",
    );
  }
}

main().catch((error) => {
  console.error("\n执行失败:", error.message ?? error);
  if (error.suggestion) {
    console.error("建议:", error.suggestion);
  }
  process.exit(1);
});

// === 添加记忆 ===
// {
//   "eventId": "49ebf348-f880-4987-9753-674733c88e25",
//   "status": "PENDING"
// }

// === 搜索记忆 ===
// {
//   "results": [
//     {
//       "id": "4622a539-39a4-414a-a187-d26e1409813c",
//       "memory": "User follows a vegetarian diet and is allergic to nuts
// ",
//       "userId": "demo-user",
//       "agentId": null,
//       "appId": null,
//       "runId": null,
//       "score": 0.2151,
//       "scoreBreakdown": {
//         "semantic": 0.5377,
//         "bm25": 0,
//         "entity": 0
//       },
//       "metadata": {},
//       "categories": [
//         "food",
//         "health",
//         "user_preferences"
//       ],
//       "createdAt": "2026-07-16T02:24:35+00:00",
//       "updatedAt": "2026-07-16T02:25:11.838139+00:00",
//       "expirationDate": null
//     },
//     {
//       "id": "b5560893-fa69-473c-8eb1-adbd3c5ed49f",
//       "memory": "User lives in Beijing and enjoys running as a regular
// activity",
//       "userId": "demo-user",
//       "agentId": null,
//       "appId": null,
//       "runId": null,
//       "score": 0.1632,
//       "scoreBreakdown": {
//         "semantic": 0.408,
//         "bm25": 0,
//         "entity": 0
//       },
//       "metadata": {},
//       "categories": [
//         "sports",
//         "hobbies"
//       ],
//       "createdAt": "2026-07-16T02:24:35+00:00",
//       "updatedAt": "2026-07-16T02:25:09.785730+00:00",
//       "expirationDate": null
//     }
//   ]
// }

// === 获取单条记忆 ===
// {
//   "id": "4622a539-39a4-414a-a187-d26e1409813c",
//   "memory": "User follows a vegetarian diet and is allergic to nuts",
//   "userId": "demo-user",
//   "metadata": null,
//   "categories": [
//     "food",
//     "health",
//     "user_preferences"
//   ],
//   "createdAt": "2026-07-15T19:24:35-07:00",
//   "updatedAt": "2026-07-15T19:25:11.838139-07:00",
//   "expirationDate": null,
//   "structuredAttributes": {
//     "day": 16,
//     "hour": 2,
//     "year": 2026,
//     "month": 7,
//     "minute": 24,
//     "quarter": 3,
//     "isWeekend": false,
//     "dayOfWeek": "thursday",
//     "dayOfYear": 197,
//     "weekOfYear": 29
//   }
// }
