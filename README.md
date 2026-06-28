# Spark CLI 编程助手

基于 AI 的终端编程助手。支持实时流式输出、安全工具执行、多步推理循环、**长任务规划与追踪**、**Token-aware 上下文管理**。

## 安装

```bash
npm install
npm run build
```

## 使用

```bash
# 交互模式
spark

# 单次执行
spark "修复 src/app.ts 里的 bug"

# 带选项
spark --model gpt-4o "重构认证模块"
spark --api-key sk-xxx --base-url http://localhost:11434/v1 "你好"
spark --auto-approve "运行测试"
spark --max-steps 5 "快速修复"
spark --continue
spark --session 2026-06-18T12-00-00
spark --verbose
spark sessions
spark config
```

## 功能特性

### 长任务规划与追踪

Spark 内置任务规划系统，能够将复杂需求分解为有序子任务，并自主管理进度：

1. **创建计划** — LLM 自动调用 `todo_create_plan` 将复杂需求拆解为子任务
2. **状态追踪** — 子任务状态自动流转（pending → in_progress → done）
3. **依赖管理** — 支持子任务间依赖关系定义
4. **检查点** — 通过 `todo_add_checkpoint` 记录关键决策和进展
5. **进度回顾** — `todo_get_list` 随时查看当前计划和已完成/待办项

### Token-aware 上下文管理

- **按 Token 裁剪** — 基于字符估算（~4 字符/token），按 token 预算裁剪而非消息条数，保留消息组完整性
- **结果截断** — 工具执行结果入库前自动截断（2000 字符限制），防止大输出撑爆上下文
- **自动摘要** — 上下文接近预算上限（默认 128K 的 80%）时，自动调用 LLM 压缩旧对话，保留关键信息

### 动态系统提示词

每步推理前自动刷新系统提示词，注入：
- 当前项目目录结构（顶层文件/目录列表）
- `package.json` 摘要（名称、版本、脚本、依赖）
- 当前任务规划状态（TodoList）

## 命令行选项

| 选项 | 说明 |
|------|------|
| `--model <name>` | 使用的模型（覆盖 `OPENAI_MODEL`） |
| `--api-key <key>` | API 密钥（覆盖 `OPENAI_API_KEY`） |
| `--base-url <url>` | API 地址（覆盖 `OPENAI_BASE_URL`） |
| `--auto-approve` | 跳过所有工具确认提示 |
| `--max-steps <n>` | 最大推理步数 |
| `--continue` | 继续上次会话 |
| `--session <id>` | 恢复指定会话 |
| `--verbose` | 启用详细调试日志 |

## 配置

通过 `~/.spark/config.json`、`.env` 或环境变量设置（命令行选项优先级最高）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OPENAI_API_KEY` | 必填 | API 密钥 |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | API 地址（支持任何 OpenAI 兼容接口） |
| `OPENAI_MODEL` | `gpt-4` | 使用的模型 |
| `SPARK_MAX_STEPS` | `20` | 每次请求最大推理步数 |
| `SPARK_AUTO_APPROVE` | 无 | 逗号分隔的自动批准工具名 |

`~/.spark/config.json` 示例：

```json
{
  "baseURL": "http://localhost:11434/v1",
  "model": "deepseek-coder",
  "maxSteps": 10
}
```

## 工具（22 个）

### 文件操作

| 工具 | 说明 | 需要确认 |
|------|------|----------|
| `read_file` | 读取文件内容，带行号（支持 `offset`、`limit`） | 否 |
| `write_file` | 写入或创建文件（自动创建父目录） | 是 |
| `edit_file` | 精确字符串替换或行号范围编辑（支持 `replace_all`） | 是 |
| `list_dir` | 列出目录内容及文件大小 | 否 |

### Shell 与搜索

| 工具 | 说明 | 需要确认 |
|------|------|----------|
| `run_command` | 执行 Shell 命令（实时流式输出、可设超时） | 是 |
| `glob_files` | 按文件名模式递归搜索（支持 `path`） | 否 |
| `grep_content` | 按正则搜索文件内容（支持文件类型过滤、上下文行、结果上限） | 否 |

### Git 操作

| 工具 | 说明 | 需要确认 |
|------|------|----------|
| `git_status` | 查看 Git 工作区状态 | 否 |
| `git_diff` | 查看 Git 变更差异（支持指定分支/commit） | 否 |
| `git_add` | 暂存文件 | 是 |
| `git_commit` | 创建提交（支持 `-a`、`--allow-empty`） | 是 |
| `git_log` | 查看提交历史（支持 `max_count`、`path`、`format`） | 否 |
| `git_checkout` | 切换分支或还原文件 | 是 |

### 开发

| 工具 | 说明 | 需要确认 |
|------|------|----------|
| `format` | 运行 prettier 和/或 eslint --fix（自动检测配置，支持 `path`） | 是 |
| `lint` | 运行 eslint 检查（自动检测配置，支持 `path`） | 是 |
| `test` | 运行项目测试（`npm test`） | 否 |

### Web

| 工具 | 说明 | 需要确认 |
|------|------|----------|
| `web_fetch` | 从 URL 获取内容（15s 超时、二进制拒绝） | 否 |

### 任务规划（长任务专用）

| 工具 | 说明 | 需要确认 |
|------|------|----------|
| `todo_create_plan` | 创建任务计划，包含目标和子任务列表 | 否 |
| `todo_get_list` | 查看当前任务计划及所有任务状态 | 否 |
| `todo_update` | 更新任务状态（pending / in_progress / done / blocked / failed）和备注 | 否 |
| `todo_mark_done` | 标记任务完成，可选备注 | 否 |
| `todo_add_checkpoint` | 记录关键决策或进展节点 | 否 |

## 安全机制

- **路径校验** — 所有文件工具拒绝项目根目录外的路径（路径分隔符边界判断，防同级目录前缀绕过）
- **文件大小限制** — `read_file` 和 `edit_file` 拒绝超过 10 MB 的文件
- **多层命令拦截** — `run_command` 阻断危险命令（空白归一化、管道到 shell 检测、base64/curl 走私检测、fork bomb 检测、扩展黑名单）
- **Shell 转义** — 跨平台命令拼接，Windows `cmd /c` 和 Unix `bash -c` 引号转义
- **确认提示** — 写入/编辑/执行/Git 操作需用户批准，除非设置 `--auto-approve`
- **会话持久化** — 对话历史保存至 `~/.spark/sessions/`
- **插件安全** — 动态工具插件通过 `ToolPlugin` 接口注册，遵循相同安全检查

## 流式输出

Spark 逐 token 流式输出 LLM 回复，无需等待完整响应。推理过程中显示当前步骤进度（`Step 1/20`），每次回复后显示 token 用量（提示 + 补全）。

上下文接近预算上限时自动显示摘要日志：
```
Context approaching limit (est. 102456/128000 tokens). Summarizing older messages…
Summarized 12 messages (~102456 tokens) into 1 summary message.
```

## 交互操作

- **Ctrl+C** — 中断当前推理，回到 `>` 提示符（不会退出程序）
- **"""** — 多行输入模式，再次输入 `"""` 结束
- **exit / quit** — 退出交互模式

## 日志

Spark 自动记录调试日志到 `~/.spark/logs/spark-YYYY-MM-DD.log`（按天分文件）。使用 `--verbose` 选项可在终端输出 debug 级别日志。

## 开发

```bash
npm run dev       # 监听模式（tsc --watch）
npm test          # 运行测试（14 个套件，189+ 用例）
npm run lint      # 类型检查（tsc --noEmit）
npm run build     # 编译至 dist/
```

## 插件扩展

Spark 支持通过 `ToolPlugin` 接口动态注册自定义工具：

```typescript
import { ToolPlugin, ToolContext, Tool } from "spark-cli";

const myPlugin: ToolPlugin = {
  name: "my-custom-tools",
  register(ctx: ToolContext): Tool | Tool[] {
    return {
      name: "my_tool",
      description: "Custom tool description",
      parameters: { /* JSON Schema */ },
      execute: async (args) => { /* implementation */ },
    };
  },
};

// 使用：new Agent(config, undefined, { plugins: [myPlugin] })
```

## 许可证

MIT
