import { Client } from "@elastic/elasticsearch";

const client = new Client({
  node: "http://localhost:9200",
});

const INDEX_NAME = "travel_journal";

// 新增
async function createDocument() {
  const now = new Date().toISOString();
  const res = await client.index({
    index: INDEX_NAME,
    document: {
      note_title: "夜跑复盘",
      note_body: "今天夜跑 5 公里，配速稳定，结束后做了拉伸。",
      tags: ["运动", "夜跑"],
      mood: "focused",
      priority: 2,
      created_at: now,
      updated_at: now,
    },
    refresh: true,
  });

  console.log("✅ 新增成功，ID =", res._id);
  return res._id;
}
// 查询
async function getDocument(docId) {
  const res = await client.get({
    index: INDEX_NAME,
    id: docId,
  });
  console.log("📖 查询结果:", res._source);
}

// 更新
async function updateDocument(docId) {
  await client.update({
    index: INDEX_NAME,
    id: docId,
    doc: {
      note_body: "今天夜跑 6 公里，状态不错，拉伸后恢复很快。",
      tags: ["运动", "夜跑", "训练"],
      updated_at: new Date().toISOString(),
    },
    refresh: true,
  });
  console.log("🔄 更新成功");
}

// 搜索
async function searchDocuments() {
  const res = await client.search({
    index: INDEX_NAME,
    query: {
      match: {
        note_body: {
          query: "慢跑以及骑行的数据",
          analyzer: "ik_smart",
        },
      },
    },
  });

  const rows = res.hits.hits.map((item) => ({
    id: item._id,
    ...item._source,
  }));
  console.log("🔍 搜索结果:", rows);
}

// 删除
async function deleteDocument(docId) {
  await client.delete({
    index: INDEX_NAME,
    id: docId,
    refresh: true,
  });
  console.log("🗑️ 删除成功");
}

async function run() {
  //   const docId = await createDocument();
  //   await getDocument(docId);
  //   console.log("docId", docId);
  //   const docId = "BEV3RZ8B9itVuTw75V8I";
  //   await updateDocument(docId);
  //   await getDocument(docId);
  await searchDocuments();

  //   await deleteDocument(docId);
}

run().catch((err) => {
  console.error("❌ 操作阶段失败:", err);
  process.exit(1);
});
