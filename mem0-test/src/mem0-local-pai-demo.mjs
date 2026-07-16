import "dotenv/config";

const BASE_URL = "http://localhost:8888";
const USER_ID = "local_api_demo";
const API_KEY = process.env.MEM0_LOCAL_API_KEY;

function log(title, data) {
  console.log(`\n=== ${title} ===`);
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

class LocalMem0Client {
  constructor({ baseUrl = BASE_URL, apiKey = API_KEY } = {}) {
    // 去除末尾斜杠确保 URL 格式一致，避免双斜杠问题
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  // 构建请求头：包含 Content-Type，如果配置了 API_KEY 则添加认证头
  headers() {
    const h = { "Content-Type": "application/json" };
    if (this.apiKey) h["X-API-Key"] = this.apiKey;
    return h;
  }

  // 基础 HTTP 请求方法：统一处理 fetch、错误响应、JSON 解析，简化调用端
  async request(path, options = {}) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { ...this.headers(), ...options.headers },
    });
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const detail =
        typeof body === "object" ? (body.detail ?? JSON.stringify(body)) : body;
      throw new Error(`${res.status} ${detail}`);
    }
    return body;
  }

  // 添加记忆：将用户消息存储到 mem0 系统，支持字符串或标准对话格式，可通过 userId/runId/agentId 关联追踪
  async add(messages, { userId, runId, agentId, metadata, infer } = {}) {
    // 标准化消息格式：字符串直接包装为用户消息，数组保留原格式
    const payload = {
      messages:
        typeof messages === "string"
          ? [{ role: "user", content: messages }]
          : messages,
      user_id: userId,
      run_id: runId,
      agent_id: agentId,
      metadata,
      infer,
    };
    return this.request("/memories", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  // 查询记忆：按用户/运行/代理 ID 过滤，返回该范围内的全部记忆列表
  async getAll({ filters, userId, runId, agentId } = {}) {
    const params = new URLSearchParams();
    const uid = userId ?? filters?.user_id;
    const rid = runId ?? filters?.run_id;
    const aid = agentId ?? filters?.agent_id;
    if (uid) params.set("user_id", uid);
    if (rid) params.set("run_id", rid);
    if (aid) params.set("agent_id", aid);
    const qs = params.toString();
    return this.request(`/memories${qs ? `?${qs}` : ""}`);
  }

  // 语义搜索记忆：基于查询文本和阈值返回相关记忆，支持通过 topK 限制结果数量和 explain 获取相似度说明
  async search(query, { filters, topK = 5, threshold, explain } = {}) {
    return this.request("/search", {
      method: "POST",
      body: JSON.stringify({
        query,
        filters,
        top_k: topK,
        threshold,
        explain,
      }),
    });
  }

  // 删除记忆：按用户/运行/代理 ID 清空对应范围的所有记忆，用于测试清理和隐私管理
  async deleteAll({ userId, runId, agentId } = {}) {
    const params = new URLSearchParams();
    if (userId) params.set("user_id", userId);
    if (runId) params.set("run_id", runId);
    if (agentId) params.set("agent_id", agentId);
    return this.request(`/memories?${params}`, { method: "DELETE" });
  }
}

async function main() {
  const client = new LocalMem0Client();
  const action = process.argv[2] ?? "add";

  if (process.argv.includes("--cleanup")) {
    log("清理测试数据", await client.deleteAll({ userId: USER_ID }));
    return;
  }

  if (action === "add") {
    const added = await client.add(
      [
        { role: "user", content: "我是素食主义者，而且对坚果过敏。" },
        { role: "assistant", content: "好的，我会记住你的饮食偏好。" },
        { role: "user", content: "我住在北京，平时喜欢跑步。" },
        { role: "assistant", content: "已记录：北京、爱好跑步。" },
      ],
      { userId: USER_ID },
    );
    log("添加记忆", added);
    return;
  }

  if (action === "search") {
    log(
      "搜索记忆",
      await client.search("用户的饮食限制是什么？", {
        filters: { user_id: USER_ID },
        topK: Number(process.env.MEM0_TOP_K ?? 5),
      }),
    );
    return;
  }

  if (action === "list") {
    log("列出全部记忆", await client.getAll({ filters: { user_id: USER_ID } }));
    return;
  }

  console.error(`未知命令: ${action}，可用: add | search | list | --cleanup`);
  process.exit(1);
}

main().catch((error) => {
  console.error("\n执行失败:", error.message ?? error);
  process.exit(1);
});
