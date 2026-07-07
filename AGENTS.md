# 项目记忆

- 中文内容统一使用 UTF-8 编码保存和读取，避免 PowerShell 默认编码导致中文乱码。
- 本项目不需要额外执行 `type-check`，除非用户明确要求。
- `@langchain/openai` 的 `llm.withStructuredOutput(...)` 在本项目接 OpenAI 兼容服务时，优先显式使用 `{ name: "...", method: "functionCalling" }`；不要依赖默认 `jsonSchema` 自动选择。已验证 `functionCalling` 可正常结构化输出。
