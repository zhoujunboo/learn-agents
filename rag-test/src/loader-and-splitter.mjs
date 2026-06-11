import "dotenv/config";
import "cheerio";
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const cheerioLoader = new CheerioWebBaseLoader(
  "https://juejin.cn/post/7233327509919547452",
  {
    selector: ".main-area p",
  },
);

const documents = await cheerioLoader.load();

const textsplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 400, // 每个分块的字符数
  chunkOverlap: 50, // 分块之间的重复字符数
  separators: ["。", "！", "？"], //分割符，优先使用段落。分割
});

const splitDocument = await textsplitter.splitDocuments(documents);

console.log(splitDocument);
