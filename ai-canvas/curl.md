# 文生图
curl -X POST http://localhost:3000/ai/image \
  -H "Content-Type: application/json" \
  --max-time 300 \
  -d '{"prompt": "一只戴墨镜的橘猫骑着复古摩托车穿过雨夜东京街头，霓虹倒影，电影感"}'

# 图像编辑
curl -X POST http://localhost:3000/ai/image \
  -H "Content-Type: application/json" \
  --max-time 300 \
  -d '{"imageUrl": "https://agent-bucket123.oss-cn-beijing.aliyuncs.com/ai-canvas/uploads/xxx.jpg", "prompt": "把背景改成赛博朋克雨夜街头，人物保持不变"}'

# 列表
curl http://localhost:3000/ai/image/list

# 删除
curl -X DELETE http://localhost:3000/ai/image/{id}

# 前端
open http://localhost:3000