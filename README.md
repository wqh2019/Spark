# Spark CLI 编程助手

基于 AI 的终端编程助手。实时流式输出、安全工具执行、多步推理循环。

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
spark sessions

# 查看配置
spark config
```

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

## 工具

| 工具 | 说明 | 需要确认 |
|------|------|----------|
| `read_file` | 读取文件内容，带行号（支持 `offset`、`limit`） | 否 |
| `write_file` | 写入或创建文件（自动创建父目录，返回字符数和行数） | 是 |
| `edit_file` | 精确字符串替换（支持 `replace_all`） | 是 |
| `list_dir` | 列出目录内容及文件大小 | 否 |
| `run_command` | 执行 Shell 命令（支持 `timeout`） | 是 |
| `glob_files` | 按文件名模式搜索（支持 `path`） | 否 |
| `grep_content` | 按正则搜索文件内容（支持 `path`） | 否 |
| `git_status` | 查看 Git 工作区状态 | 否 |
| `git_diff` | 查看 Git 变更差异（支持 `target` 指定分支/commit） | 否 |
| `format` | 运行 prettier 和/或 eslint --fix（自动检测配置，支持 `path`） | 是 |
| `lint` | 运行 eslint 检查（自动检测配置，支持 `path`） | 是 |
| `test` | 运行项目测试（`npm test`） | 否 |

## 安全机制

- **路径校验** — 所有文件工具拒绝项目根目录外的路径，防止路径穿越
- **文件大小限制** — `read_file` 和 `edit_file` 拒绝超过 10 MB 的文件
- **命令拦截** — `run_command` 阻断危险命令（`rm -rf /`、`sudo`、`mkfs` 等）
- **确认提示** — 写入/编辑/执行操作需用户批准，除非设置 `--auto-approve`
- **会话持久化** — 对话历史保存至 `~/.spark/sessions/`

## 流式输出

Spark 逐 token 流式输出 LLM 回复，无需等待完整响应。推理过程中显示当前步骤进度（`Step 1/20`），每次回复后显示 token 用量（提示 + 补全）。

## 交互操作

- **Ctrl+C** — 中断当前推理，回到 `>` 提示符（不会退出程序）
- **exit / quit** — 退出交互模式

## 开发

```bash
npm run dev       # 监听模式
npm test          # 运行测试
npm run lint      # 类型检查
npm run build     # 编译至 dist/
```

## 许可证

MIT
