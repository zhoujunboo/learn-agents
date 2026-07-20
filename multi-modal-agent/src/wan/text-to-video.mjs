/**
 * 文生视频 — wan2.6-t2v
 * dashscope-sdk-official（自动轮询异步任务）
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { Configuration, VideoSynthesis } from "dashscope-sdk-official";

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
// 视频生成是异步任务；VideoSynthesis.call 内部会提交任务并轮询至完成
const client = new VideoSynthesis(configuration);

console.log("model: wan2.6-t2v");
console.log("creating video task...");

const result = await client.call({
  model: "wan2.6-t2v",
  prompt: "一只橘猫在窗台上晒太阳，微风吹动窗帘，镜头缓慢推进，电影质感", // 画面与运动描述
  size: "1280*720", // 文生视频用 size（宽*高），与图生视频的 resolution 不同
  prompt_extend: true, // 是否自动扩写提示词
  duration: 5, // 视频时长（秒）
  watermark: false, // 是否添加「AI 生成」水印
});

const taskStatus = result.output?.task_status;
console.log("task_status:", taskStatus);

if (taskStatus === "FAILED") {
  throw new Error(result.output?.message ?? result.message ?? "Task failed");
}

const videoUrl = result.output?.video_url;
if (!videoUrl) {
  throw new Error(`No video URL in response: ${JSON.stringify(result)}`);
}

console.log("video URL:", videoUrl);
const videoResponse = await fetch(videoUrl);
writeFileSync(
  "output-wan-text-to-video.mp4",
  Buffer.from(await videoResponse.arrayBuffer()),
);
console.log("Saved to output-wan-text-to-video.mp4");
