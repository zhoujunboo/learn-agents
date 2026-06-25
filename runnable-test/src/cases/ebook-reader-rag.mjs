import "dotenv/config";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { RunnableSequence, RunnableLambda } from "@langchain/core/runnables";
import { MilvusClient, MetricType } from "@zilliz/milvus2-sdk-node";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";

const COLLECTION_NAME = "ebook_collection";
const VECTOR_DIM = 1024;

// 初始化 OpenAI Chat 模型
const model = new ChatOpenAI({
  temperature: 0.7,
  model: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

// 初始化 Embeddings 模型
const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_EMBDDING_KEY,
  model: process.env.EMBEDDINGS_MODEL_NAME,
  configuration: {
    baseURL: process.env.OPENAI_EMBDDING__URL,
  },
  dimensions: VECTOR_DIM,
});

// 初始化原生 Milvus 客户端
const milvusClient = new MilvusClient({
  address: "localhost:19530",
});

// 从 Milvus 中检索内容的 Runnable
const milvusSearch = new RunnableLambda({
  func: async (input) => {
    const { question, k = 5 } = input;
    try {
      // 1. 生成问题向量
      const queryVector = await embeddings.embedQuery(question); // 2. 调用 Milvus 搜索
      const searchResult = await milvusClient.search({
        collection_name: COLLECTION_NAME,
        vector: queryVector,
        limit: k,
        metric_type: MetricType.COSINE,
        output_fields: ["id", "book_id", "chapter_num", "index", "content"],
      });

      const results = searchResult.results ?? [];
      const retrievedContent = results.map((item, idx) => ({
        id: item.id,
        book_id: item.book_id,
        chapter_num: item.chapter_num,
        index: item.index ?? idx,
        content: item.content,
        score: item.score,
      }));

      return { question, retrievedContent };
    } catch (error) {
      console.error("检索内容时出错:", error.message);
      return { question, retrievedContent: [] };
    }
  },
});

// PromptTemplate：负责把 context / question 拼成最终 prompt

const promptTemplate = PromptTemplate.fromTemplate(
  `你是一个专业的《天龙八部》小说助手。基于小说内容回答问题，用准确、详细的语言。

  请根据以下《天龙八部》小说片段内容回答问题：
  {context}

  用户问题: {question}

  回答要求：
  1. 如果片段中有相关信息，请结合小说内容给出详细、准确的回答
  2. 可以综合多个片段的内容，提供完整的答案
  3. 如果片段中没有相关信息，请如实告知用户
  4. 回答要准确，符合小说的情节和人物设定
  5. 可以引用原文内容来支持你的回答

  AI 助手的回答:`,
);

// 构建 context + 日志打印的 Runnable

const buildPromptInput = new RunnableLambda({
  func: async (input) => {
    const { question, retrievedContent } = input;
    if (!retrievedContent.length) {
      return {
        hasContext: false,
        question,
        context: "",
        retrievedContent,
      };
    }

    // 打印检索结果
    console.log("=".repeat(80));
    console.log(`问题: ${question}`);
    console.log("=".repeat(80));
    console.log("\n【检索相关内容】");

    retrievedContent.forEach((item, i) => {
      console.log(`\n[片段 ${i + 1}] 相似度: ${item.score ?? "N/A"}`);
      console.log(`书籍: ${item.book_id}`);
      console.log(`章节: 第 ${item.chapter_num} 章`);
      console.log(`片段索引: ${item.index}`);
      const content = item.content ?? "";
      console.log(
        `内容: ${content.substring(0, 200)}${
          content.length > 200 ? "..." : ""
        }`,
      );
    });

    const context = retrievedContent
      .map((item, i) => {
        return `[片段 ${i + 1}]
        章节: 第 ${item.chapter_num} 章
        内容: ${item.content}`;
      })
      .join("\n\n━━━━━\n\n");

    return {
      hasContext: true,
      question,
      context,
      retrievedContent,
    };
  },
});

// 组合成完整的 RAG Runnable（检索 -> 构建 Prompt 输入 -> PromptTemplate -> LLM -> 文本）
const ragChain = RunnableSequence .from([
  milvusSearch,
  buildPromptInput,
  new RunnableLambda({
    func: async (input) => {
      const { hasContext, question, context } = input;
      if (!hasContext) {
        const fallback =
          "抱歉，我没有找到相关的《天龙八部》内容。请尝试换一个问题。";
        console.log(fallback);
        return { question, context: "", answer: fallback, noContext: true };
      }

      // PromptTemplate 需要 { question, context }
      return { question, context, noContext: false };
    },
  }),
  promptTemplate,
  model,
  // 这里用 StringOutputParser 把大模型返回结果变为字符串，然后用 stream 流式打印
  new StringOutputParser(),
]);

async function initMilvusCollection() {
  console.log("连接到 Milvus...");
  await milvusClient.connectPromise;
  console.log("✓ 已连接\n");

  try {
    await milvusClient.loadCollection({ collection_name: COLLECTION_NAME });
    console.log("✓ 集合已加载\n");
  } catch (error) {
    if (!error.message.includes("already loaded")) {
      throw error;
    }
    console.log("✓ 集合已处于加载状态\n");
  }
}

async function main() {
  try {
    await initMilvusCollection();

    const input = {
      question: "鸠摩智会什么武功？",
      k: 5,
    };

    console.log("=".repeat(80));
    console.log(`问题: ${input.question}`);
    console.log("=".repeat(80));
    console.log("\n【AI 流式回答】\n");

    const stream = await ragChain.stream(input);

    for await (const chunk of stream) {
      process.stdout.write(chunk);
    }

    console.log("\n");
  } catch (error) {
    console.error("错误:", error.message);
  }
}

await main();



// 连接到 Milvus...
// ✓ 已连接

// ✓ 集合已加载

// ================================================================================
// 问题: 鸠摩智会什么武功？
// ================================================================================

// 【AI 流式回答】

// ================================================================================
// 问题: 鸠摩智会什么武功？
// ================================================================================

// 【检索相关内容】

// [片段 1] 相似度: 0.6768018007278442
// 书籍: 1
// 章节: 第 129 章
// 片段索引: 50
// 内容: 鸠摩智袍袖一拂，笑道：“这‘袈裟伏魔功’练得不精之处，还请方丈师兄指点。”一句话方罢，他身前七尺外的那口铜鼎竟如活了一般，忽然连打几个转，转定之后，本来向内的一侧转而向外，但见鼎身正中剜去了一只手掌之形，割口处也是黄光灿然。辈份较低的群僧这才明白，鸠摩智适才使到般若掌中“慑伏外道”那一招之时，掌力有如宝刀利刃，竟在鼎上割下了手掌般的一块。

// 玄生见他这三下出手，无不远胜于己，霎时间心丧若死：

// “...

// [片段 2] 相似度: 0.6694221496582031
// 书籍: 1
// 章节: 第 129 章
// 片段索引: 59
// 内容: 虚竹道：“太师伯，他使的不是拈花指，也不是佛门武功。”

// 群僧一听，都暗暗不以为然，鸠摩智的指法固然和玄渡一模一样，连两人温颜微笑的神情也是毫无二致，却不是少林七十二绝技之一的“拈花指”是什么？群僧都知鸠摩智是吐蕃国的护国法师，敕封大轮明王，每隔五年，便在大雪山大轮寺开坛，讲经说法，四方高僧居士云集聆听，执经问难，无不赞叹。他是佛门中天下知名的高僧，所使的如何会不是佛门武功？

// 鸠摩智心中却又是一...

// [片段 3] 相似度: 0.6671813726425171
// 书籍: 1
// 章节: 第 132 章
// 片段索引: 2
// 内容: 鸠摩智有心炫耀，多罗指使罢，立时变招，单臂削出，虽是空手，所使的却是“燃木刀法”。这路刀法练成之后，在一根干木旁快劈九九八十一刀，刀刃不能损伤木材丝毫，刀上发出的热力，却要将木材点燃生火，当年萧峰的师父玄苦大师即擅此技，自他圆寂之后，寺中已无人能会。“燃木刀法”

// 是单刀刀法，与鸠摩智当日在天龙寺所使“火焰刀法”的凌虚掌力全然不同，他此刻是以手掌作戒刀，狠砍狠斫，全是少林派武功的路子。他一刀劈落，...

// [片段 4] 相似度: 0.6634013056755066
// 书籍: 1
// 章节: 第 142 章
// 片段索引: 40
// 内容: 原来鸠摩智越听越不服，心道：“你说少林派七十二项绝技不能齐学，我不是已经都学会了？怎么又没有筋脉齐断，成为废人？”双手拢在衣袖之中，暗暗使出“无相劫指”，神不知、鬼不觉的向那老僧弹去。不料指力甫及那老僧身前三尺之处，便似遇上了一层柔软之极、却又坚硬之极的屏障，嗤嗤几声响，指力便散得无形无踪，却也并不反弹而回。鸠摩智大吃一惊，心道：“这老僧果然有些鬼门道，并非大言唬人！”

// 那老僧恍如不知，只道：“...

// [片段 5] 相似度: 0.6602972745895386
// 书籍: 1
// 章节: 第 142 章
// 片段索引: 41
// 内容: 鸠摩智又是一惊，自己偷学逍遥派“小无相功”，从无人知，怎么这老僧却瞧了出来？但转念一想，随即释然：“虚竹适才跟我相斗，使的便是小无相功。多半是虚竹跟他说的，何足为奇？”便道：“‘小无相指’虽然源出道家，但近日佛门弟子习者亦多，演变之下，已集佛道两家之所长。即是贵寺之中，亦不乏此道高手。”

// 那老僧微现惊异之色，说道：“少林寺中也有人会‘小无相功’？老衲今日还是首次听闻。”鸠摩智心道：“你装神弄鬼，...
// 鸠摩智会的武功很多，且以内功深厚、善于兼修少林与逍遥派武功著称。根据这些片段，他主要会：

// - `袈裟伏魔功`
// - `拈花指`
// - `燃木刀法`
// - `大智无定指`
// - `去烦恼指`
// - `寂灭抓`
// - `因陀罗抓`
// - `无相劫指`
// - `小无相功`

// 片段里还明确写到，他“兼通敝派七十二绝技”，但并非全是少林正宗路数；后文又点明他“本来是‘逍遥派’的‘小无相功’”，并借此“本寺的七十二绝技，倒也皆可运使”。也就是说，鸠摩智最核心的本事，是以`小无相功`为根基，模仿并施展多种佛门和少林武功。