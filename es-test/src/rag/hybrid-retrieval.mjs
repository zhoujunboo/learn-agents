/**
 * 混合检索：LLM 重写为 3 条多角度问句 → 每条问句分别 ES + Milvus → 全量合并去重 → Rerank → LLM 作答。
 * LangGraph：START → query_augment → es_recall ∥ milvus_recall → merge → rerank → generate_answer → END。
 */
import "dotenv/config";
import { Client } from "@elastic/elasticsearch";
import { Document } from "@langchain/core/documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { Milvus } from "@langchain/community/vectorstores/milvus";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { DashScopeRerank } from "../rerank/dashscope-rerank.mjs";
import { augmentQuery, retrievalQueryStrings } from "./query-augment.mjs";

const INDEX = "life_notes";

// 定义混合检索流程的状态数据结构
// 每个字段在各个节点间流转，逐步丰富和转换
const HybridRetrievalState = Annotation.Root({
  query: Annotation(),                // 原始用户问题
  queryAugmentation: Annotation(),    // LLM 生成的 3 条多角度检索问句
  esHits: Annotation(),               // Elasticsearch 检索的原始结果
  milvusHits: Annotation(),           // Milvus 向量数据库的原始结果
  merged: Annotation(),               // ES + Milvus 合并后去重的结果
  topDocuments: Annotation(),         // 重排后保留的 top-3 文档
  answer: Annotation(),               // LLM 基于检索结果生成的最终答案
});

// 将 Elasticsearch 搜索结果转换为 LangChain Document
function docFromEsHit(hit) {
  const s = hit._source ?? {};
  const text = [s.note_title ?? s.title, s.note_body ?? s.content]
    .filter(Boolean)
    .join("\n");
  return new Document({
    pageContent: text,
    metadata: { id: hit._id, source: "es", ...s },
  });
}

/** ES 与 Milvus 结果拼接后仅按 metadata.id 去重，保留首次出现（通常 ES 在前） */
// 合并 ES 和 Milvus 的检索结果，按 id 去重（保留首次出现的顺序）
function merge(esDocs, milvusDocs) {
  const combined = [...(esDocs ?? []), ...(milvusDocs ?? [])].filter(
    (d) => d?.pageContent,
  );
  return dedupeDocsById(combined);
}

/** 去重键仅为 metadata.id（trim 后非空）；无 id 丢弃，不按正文去重；保留首次出现顺序 */
function dedupeDocsById(docs) {
  const seen = new Set();
  const out = [];
  for (const d of docs ?? []) {
    if (!d?.pageContent) continue;
    const id = d.metadata?.id != null ? String(d.metadata.id).trim() : "";
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(d);
  }
  return out;
}

// 打印文档列表，截取前 200 字符作为预览
function printDocs(label, docs) {
  console.log(`\n=== ${label} (${docs?.length ?? 0} 条) ===`);
  for (let i = 0; i < (docs ?? []).length; i++) {
    const d = docs[i];
    const preview = (d.pageContent ?? "").slice(0, 200).replace(/\n/g, " ");
    console.log(`[${i}] ${preview}${d.pageContent?.length > 200 ? "…" : ""}`);
    console.log(`    metadata:`, d.metadata ?? {});
  }
}

/** 打印 LLM 生成的多角度检索问句及逐条检索列表 */
// 打印 LLM 生成的多角度检索问句及每条检索字符串
function printQueryRewrite(original, augmentation) {
  const qs = augmentation?.queries ?? [];
  const forRetrieval = retrievalQueryStrings(original, augmentation);

  console.log(`\n--- 查询扩展（LLM 生成 ${qs.length} 条检索问句）---`);
  console.log("原始 query:", original ?? "");
  for (let i = 0; i < qs.length; i++)
    console.log(`  [${i + 1}] ${qs[i] ?? ""}`);
  console.log(
    `\n逐条 ES + Milvus（共 ${forRetrieval.length} 条检索串，含原始问题）:`,
  );
  for (let i = 0; i < forRetrieval.length; i++) {
    console.log(`  [${i + 1}] ${forRetrieval[i] ?? ""}`);
  }
}

// 将 LLM 返回的消息内容转为字符串（支持纯字符串或数组格式）
function stringifyMessageContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((c) =>
      typeof c === "string" ? c : typeof c?.text === "string" ? c.text : "",
    )
    .join("");
}

// 将检索到的文档列表格式化为 LLM 上下文字符串（包含 id、source 等元数据）
function formatDocsAsContext(docs) {
  return (docs ?? [])
    .map((d, i) => {
      const meta = d.metadata ?? {};
      const src = meta.source ?? "";
      const id = meta.id != null ? String(meta.id) : "";
      const head = id
        ? `[${i + 1}] id=${id}${src ? ` source=${src}` : ""}`
        : `[${i + 1}]`;
      return `${head}\n${d.pageContent ?? ""}`;
    })
    .join("\n\n---\n\n");
}

const ANSWER_PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    `你是阅读用户「生活笔记」知识库并作答的助手。
    规则：
    - 只根据下方「检索片段」推断答案；片段里没有的信息不要编造。
    - 若片段不足以回答，明确说明「笔记里未提到」，并可给出一句保守建议。
    - 回答简洁有条理，可使用简短列表；口吻自然中文。`,
  ],
  [
    "human",
    `用户问题：{query}

    检索片段：
    {context}`,
  ],
]);

const NO_CONTEXT_PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    `你是阅读用户「生活笔记」知识库并作答的助手。当前没有检索到任何片段。
     请用一两句话说明无法从笔记中回答，并礼貌询问用户是否换个说法或补充关键词。`,
  ],
  ["human", "用户问题：{query}"],
]);

// 构建混合检索 LangGraph：问题重写 → 并行 ES/Milvus 检索 → 合并去重 → 重排 → LLM 生成答案
export function compileHybridRetrievalGraph(
  esClient,
  milvus,
  reranker,
  chatModel,
) {
  const ES_K = 15;
  const MILVUS_K = 15;

  return new StateGraph(HybridRetrievalState)
    // 问题扩展：LLM 把原始问题改写为 3 条多角度的检索问句
    .addNode("query_augment", async (state) => ({
      queryAugmentation: await augmentQuery(chatModel, state.query ?? ""),
    }))
    // 从 Elasticsearch 检索：对每条增强问句执行搜索，结果去重后返回
    .addNode("es_recall", async (state) => {
      const qs = retrievalQueryStrings(state.query, state.queryAugmentation);
      const n = Math.max(1, qs.length);
      const kEach = Math.max(2, Math.ceil(ES_K / n));  // 均匀分配 top-k
      const batches = await Promise.all(
        qs.map((q) =>
          esClient.search({
            index: INDEX,
            size: kEach,
            query: {
              multi_match: {
                query: q,
                fields: ["note_title^2", "note_body", "title", "content"],
                type: "best_fields",
                analyzer: "ik_smart",  // 中文分词
              },
            },
          }),
        ),
      );
      const flat = batches.flatMap((res) =>
        (res.hits?.hits ?? []).map(docFromEsHit),
      );
      return { esHits: dedupeDocsById(flat) };
    })
    // 从 Milvus 向量库检索：对每条增强问句执行向量相似度搜索，结果去重后返回
    .addNode("milvus_recall", async (state) => {
      const qs = retrievalQueryStrings(state.query, state.queryAugmentation);
      const n = Math.max(1, qs.length);
      const kEach = Math.max(2, Math.ceil(MILVUS_K / n));  // 均匀分配 top-k
      const batches = await Promise.all(
        qs.map((q) => milvus.similaritySearch(q, kEach)),
      );
      const flat = batches.flat();
      return { milvusHits: dedupeDocsById(flat) };
    })
    // 合并阶段：ES 和 Milvus 结果拼接并按 id 去重（保留首次出现）
    .addNode("merge", async (state) => ({
      merged: merge(state.esHits, state.milvusHits),
    }))
    // 重排阶段：用 DashScope Rerank 模型评分并排序，保留 topN（通常为 3）
    .addNode("rerank", async (state) => {
      const merged = state.merged ?? [];
      if (!merged.length) return { topDocuments: [] };  // 如果没有文档则跳过
      const topDocuments = await reranker.compressDocuments(
        merged,
        state.query,
      );
      return { topDocuments };
    })
    // LLM 生成答案：根据是否有检索结果选择不同的提示词模板
    .addNode("generate_answer", async (state) => {
      const query = state.query ?? "";
      const docs = state.topDocuments ?? [];

      // 无检索结果：使用 NO_CONTEXT_PROMPT 礼貌告知用户
      if (!docs.length) {
        const chain = NO_CONTEXT_PROMPT.pipe(chatModel);
        const msg = await chain.invoke({ query });
        return { answer: stringifyMessageContent(msg.content).trim() };
      }

      // 有检索结果：使用 ANSWER_PROMPT 基于文档生成答案
      const chain = ANSWER_PROMPT.pipe(chatModel);
      const msg = await chain.invoke({
        query,
        context: formatDocsAsContext(docs),
      });
      return { answer: stringifyMessageContent(msg.content).trim() };
    })
    // 定义执行流程的连接关系
    .addEdge(START, "query_augment")                    // 从入口开始
    .addEdge("query_augment", "es_recall")             // 问题重写后并行调用
    .addEdge("query_augment", "milvus_recall")         // 两个检索任务
    .addEdge(["es_recall", "milvus_recall"], "merge")  // 等待两个检索都完成后合并
    .addEdge("merge", "rerank")                        // 合并后重排
    .addEdge("rerank", "generate_answer")              // 重排后生成答案
    .addEdge("generate_answer", END)                   // 最终输出答案
    .compile();  // 编译成可执行的图
}

// 初始化 Elasticsearch 客户端
const esClient = new Client({ node: "http://localhost:9200" });

// 初始化 OpenAI 嵌入模型（通过阿里云 DashScope 兼容接口）
const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-v3",
  apiKey: process.env.OPENAI_API_EMBDDING_KEY,
  configuration: {
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
});

// 初始化 Milvus 向量数据库连接
const milvus = await Milvus.fromExistingCollection(embeddings, {
  url: "http://localhost:19530",
  collectionName: INDEX,
  textField: "doc_text",
  vectorField: "embedding",
});

// 初始化重排模型（DashScope Rerank）
const reranker = new DashScopeRerank({
  apiKey: process.env.DASHSCOPE_API_KEY,
  model: "qwen3-rerank",
  topN: 3,  // 保留 top-3
  baseUrl: process.env.RERANK_URL,
});

// 初始化 LLM 模型（通过阿里云 DashScope 兼容接口）
const chatModel = new ChatOpenAI({
  model: process.env.MODEL_NAME ?? "qwen-turbo",
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0.2,  // 低温度保证答案稳定性
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

/** 示例用户 query（字符串列表） */
const SAMPLE_QUERIES = [
  "PO-20250409-K9 滤芯订单",
  //   "家里无线老是断断续续的咋整啊",
  // "那个黑凉粉粉怎么冲不结块",
  // "明火炖太久汤汁又黏又涩，起锅前要怎么处理才不腻",
];

// 构建混合检索图
const graph = compileHybridRetrievalGraph(
  esClient,
  milvus,
  reranker,
  chatModel,
);

// 输出图的 Mermaid 流程图（用于可视化）
const drawable = await graph.getGraphAsync();
console.log(drawable.drawMermaid());
console.log();

// 逐个处理示例查询
for (const query of SAMPLE_QUERIES) {
  console.log(`query: ${query}`);

  // 执行混合检索完整流程
  const state = await graph.invoke({ query });

  // 打印查询扩展过程和各阶段结果
  printQueryRewrite(state.query, state.queryAugmentation);
  console.log("\n（原始 JSON）", JSON.stringify(state.queryAugmentation));

  printDocs("Elasticsearch 检索", state.esHits);
  printDocs("Milvus 检索", state.milvusHits);
  printDocs("重排后保留", state.topDocuments ?? []);

  // 最终输出 LLM 生成的答案
  console.log("\n=== 大模型生成回答 ===\n");
  console.log(state.answer ?? "");
}
