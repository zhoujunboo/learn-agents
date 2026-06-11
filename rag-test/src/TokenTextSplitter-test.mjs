import "dotenv/config";
import "cheerio";
import {
  TokenTextSplitter,
  RecursiveCharacterTextSplitter,
} from "@langchain/textsplitters";

import { Document } from "@langchain/core/documents";
import { getEncoding } from "js-tiktoken";

const enc = getEncoding("cl100k_base");

// const logDocument = new Document({
//   pageContent: `[2024-01-15 10:00:00] INFO: Application started
// [2024-01-15 10:00:05] DEBUG: Loading configuration file
// [2024-01-15 10:00:10] INFO: Database connection established
// [2024-01-15 10:00:15] WARNING: Rate limit approaching
// [2024-01-15 10:00:20] ERROR: Failed to process request
// [2024-01-15 10:00:25] INFO: Retrying operation
// [2024-01-15 10:00:30] SUCCESS: Operation completed`,
// });

// const logTextSplitter = new TokenTextSplitter({
//   chunkSize: 50, // 每个块最多 50 个 Token
//   chunkOverlap: 10, // 块之间重叠 10 个 Token
//   encodingName: "cl100k_base", // OpenAI 使用的编码方式
// });

// 那能不能用 RecursiveCharacterTextSplitter 的分割方式，然后按照 token 长度来设置 chunk size 呢？
// 这样就完全不需要用 TokenTextSplitter。
const logDocument = new Document({
  pageContent: `[2024-01-15 10:00:00] INFO: Application started
[2024-01-15 10:00:05] DEBUG: Loading configuration file
[2024-01-15 10:00:10] INFO: Database connection established
[2024-01-15 10:00:15] WARNING: Rate limit approaching
[2024-01-15 10:00:20] ERROR: Failed to process request
[2024-01-15 10:00:25] INFO: Retrying operation
[2024-01-15 10:00:30] SUCCESS: Operation completed
[2026-01-10 14:30:00] INFO: 系统开始执行大规模数据迁移任务，本次迁移涉及核心业务数据库中的用户表、订单表、商品库存表、物流信息表、支付记录表、评论数据表等共计十二个关键业务表，预计处理数据量约500万条记录，数据总大小预估为280GB，迁移过程将采用分批次增量更新策略以减少对生产环境的影响，同时启用双写机制确保数据一致性，任务预计总耗时约3小时15分钟，迁移完成后将自动触发全面的数据一致性校验流程以及性能基准测试，请相关运维人员和DBA团队密切关注系统资源使用情况、网络带宽占用率以及任务执行进度，如遇异常情况请立即启动应急预案并通知技术负责人
`,
});

const logTextSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 150,
  chunkOverlap: 20,
  separators: ["\n", "。", "，"],
  lengthFunction: (text) => enc.encode(text).length,
});

const splitDocuments = await logTextSplitter.splitDocuments([logDocument]);

// console.log(splitDocuments);

splitDocuments.forEach((document) => {
  console.log(document);
  console.log("charater length:", document.pageContent.length);
  console.log("token length:", enc.encode(document.pageContent).length);
});

// 结论：
// 这种不管不顾的分割显然不靠谱，不一定在什么地方就断开了。

// 可以看到，它优先保证 token 正好是 50，为了这个不惜强行打断文本。
// 当然，打断后也加了 overlap：

// RecursiveCharacterTextSplitter 分出的 chunk 可能大于 chunk size，也可以小，优先保证语义完整，是按照分割符来分割。
// 但是 TokenTextSplitter 不是，它会只会保证 token 数量

// Document {
//   pageContent: '[2024-01-15 10:00:00] INFO: Application started\n' +
//     '[2024-01-15 10:00:05] DEBUG: Loading configuration file\n' +
//     '[2024-01-15 10:00',
//   metadata: { loc: { lines: [Object] } },
//   id: undefined
// }
// charater length: 121
// token length: 50
// Document {
//   pageContent: '2024-01-15 10:00:10] INFO: Database connection established\n' +
//     '[2024-01-15 10:00:15] WARNING: Rate limit approaching\n' +
//     '[2024-01-15 10:00',
//   metadata: { loc: { lines: [Object] } },
//   id: undefined
// }
// charater length: 130
// token length: 50
// Document {
//   pageContent: '2024-01-15 10:00:20] ERROR: Failed to process request\n' +
//     '[2024-01-15 10:00:25] INFO: Retrying operation\n' +
//     '[2024-01-15 10:',
//   metadata: { loc: { lines: [Object] } },
//   id: undefined
// }
// charater length: 116
// token length: 50
// Document {
//   pageContent: '[2024-01-15 10:00:30] SUCCESS: Operation completed',
//   metadata: { loc: { lines: [Object] } },
//   id: undefined
// }
// charater length: 50
// token length: 18

//=======================================================
//现在就是按照现在的 token 数量作为分割依据了：

// Document {
//   pageContent: '[2024-01-15 10:00:00] INFO: Application started\n' +
//     '[2024-01-15 10:00:05] DEBUG: Loading configuration file\n' +
//     '[2024-01-15 10:00:10] INFO: Database connection established\n' +
//     '[2024-01-15 10:00:15] WARNING: Rate limit approaching\n' +
//     '[2024-01-15 10:00:20] ERROR: Failed to process request\n' +
//     '[2024-01-15 10:00:25] INFO: Retrying operation\n' +
//     '[2024-01-15 10:00:30] SUCCESS: Operation completed',
//   metadata: { loc: { lines: [Object] } },
//   id: undefined
// }
// charater length: 370
// token length: 138
// Document {
//   pageContent: '[2026-01-10 14:30:00] INFO: 系统开始执行大规模数据迁移任务，本次迁移涉及核心业务数据库中的用户表、订单
// 表、商品库存表、物流信息表、支付记录表、评论数据表等共计十二个关键业务表，预计处理数据量约500万条记录，数据总大小预估
// 为280GB，迁移过程将采用分批次增量更新策略以减少对生产环境的影响',
//   metadata: { loc: { lines: [Object] } },
//   id: undefined
// }
// charater length: 159
// token length: 135
// Document {
//   pageContent: '，同时启用双写机制确保数据一致性，任务预计总耗时约3小时15分钟，迁移完成后将自动触发全面的数据一致性校
// 验流程以及性能基准测试，请相关运维人员和DBA团队密切关注系统资源使用情况、网络带宽占用率以及任务执行进度，如遇异常情况
// 请立即启动应急预案并通知技术负责人',
//   metadata: { loc: { lines: [Object] } },
//   id: undefined
// }
// charater length: 129
// token length: 130
