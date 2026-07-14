// 导入环境变量配置
import "dotenv/config";
// 导入 OpenAI 的向量嵌入服务（用于文本转向量）
import { OpenAIEmbeddings } from "@langchain/openai";
// 导入数据库查询函数
import { query } from "./db.mjs";

// 定义消息中 role 字段的合法值：用户、助手、系统
const VALID_ROLES = ["user", "assistant", "system"];

// 缓存向量嵌入实例，避免重复创建
let embeddings;

// 获取向量嵌入实例（单例模式，首次使用时创建，之后复用）
function getEmbeddings() {
  if (!embeddings) {
    // 使用 OpenAI 的嵌入模型初始化
    embeddings = new OpenAIEmbeddings({
      // 使用指定的嵌入模型，默认为 text-embedding-3
      model: process.env.EMBEDDINGS_MODEL_NAME || "text-embedding-v3",
      // OpenAI API 密钥
      apiKey: process.env.OPENAI_API_EMBDDING_KEY,
      // 自定义 API 请求配置
      configuration: {
        baseURL: process.env.OPENAI_EMBDDING__URL,
      },
    });
  }
  return embeddings;
}

// 创建新消息
// 参数：对话ID、消息角色、消息内容、是否创建向量嵌入（可选）
// 返回：创建的消息对象
async function createMessage(
  conversationId,
  role,
  content,
  withEmbedding = false,
) {
  // 校验消息角色是否合法
  if (!VALID_ROLES.includes(role)) {
    throw new Error(`role 必须是 ${VALID_ROLES.join("、")} 之一`);
  }

  // 如果需要创建向量嵌入（用于相似度搜索）
  if (withEmbedding) {
    // 将消息内容转换为向量
    const vector = await getEmbeddings().embedQuery(content);
    // 保存消息和向量到数据库
    const { rows } = await query(
      `INSERT INTO messages (conversation_id, role, content, embedding)
       VALUES ($1, $2, $3, $4::vector)
       RETURNING id, conversation_id, role, content, created_at`,
      [conversationId, role, content, JSON.stringify(vector)],
    );
    return rows[0];
  }

  // 只保存消息，不创建向量
  const { rows } = await query(
    `INSERT INTO messages (conversation_id, role, content)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [conversationId, role, content],
  );
  return rows[0];
}

// 通过消息 ID 获取单条消息
// 返回：消息对象或 null（未找到）
async function getMessageById(id) {
  const { rows } = await query(
    `SELECT id, conversation_id, role, content, created_at
     FROM messages WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

// 获取某个对话中的所有消息（按创建时间排序）
// 返回：消息对象数组
async function getMessagesByConversationId(conversationId) {
  const { rows } = await query(
    `SELECT id, conversation_id, role, content, created_at
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [conversationId],
  );
  return rows;
}

// 更新消息内容
// 参数：消息ID、新内容、是否更新向量嵌入（可选）
// 返回：更新后的消息对象或 null
async function updateMessage(id, content, withEmbedding = false) {
  // 如果需要更新向量嵌入
  if (withEmbedding) {
    // 重新生成新内容的向量
    const vector = await getEmbeddings().embedQuery(content);
    const { rows } = await query(
      `UPDATE messages
       SET content = $1, embedding = $2::vector
       WHERE id = $3
       RETURNING id, conversation_id, role, content, created_at`,
      [content, JSON.stringify(vector), id],
    );
    return rows[0] ?? null;
  }

  // 只更新消息内容，不更新向量
  const { rows } = await query(
    `UPDATE messages SET content = $1 WHERE id = $2 RETURNING *`,
    [content, id],
  );
  return rows[0] ?? null;
}

// 删除消息
// 返回：是否删除成功（true/false）
async function deleteMessage(id) {
  const { rowCount } = await query("DELETE FROM messages WHERE id = $1", [id]);
  return rowCount > 0;
}

// 搜索相似的消息（基于向量相似度）

// $1	JSON.stringify(vector)	搜索文本的向量表示
// $2	conversationId	对话 ID
// $3	limit	返回结果数量

// ============案例===================
// 搜索："向量相似度怎么查"
// const results = await searchSimilarMessages(1, "向量相似度怎么查", 3);

// 返回结果（按相似度从高到低排序）：
// [
//   { similarity: 0.8320, content: "怎么做相似度搜索？" },
//   { similarity: 0.6467, content: "可以使用 pgvector 的 cosine 距离运算符..." },
//   { similarity: 0.5254, content: "PostgreSQL 支持整数、文本、JSON..." }
// ]

// 1 - (embedding <=> $1::vector) AS similarity
// <=> 是 PostgreSQL pgvector 扩展的余弦距离运算符，返回范围 0-2
// 距离 0 = 完全相同，距离越大 = 差异越大
// 1 - 距离 将距离转换为相似度分数（0-1 之间，1 表示完全匹配）
// $1::vector 是搜索文本转换后的向量

// ORDER BY embedding <=> $1::vector：按向量距离从小到大排序（最相似的排在前面）

async function searchSimilarMessages(conversationId, searchText, limit = 5) {
  // 将搜索文本转换为向量
  const vector = await getEmbeddings().embedQuery(searchText);
  const { rows } = await query(
    `SELECT id, conversation_id, role, content, created_at,
            1 - (embedding <=> $1::vector) AS similarity
     FROM messages
     WHERE conversation_id = $2 AND embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [JSON.stringify(vector), conversationId, limit],
  );
  return rows;
}

// 导出所有函数供其他模块使用
export {
  createMessage,
  getMessageById,
  getMessagesByConversationId,
  updateMessage,
  deleteMessage,
  searchSimilarMessages,
};
