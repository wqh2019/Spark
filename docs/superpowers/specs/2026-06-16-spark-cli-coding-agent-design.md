# Spark CLI Coding Agent - 设计文档

> 日期：2026-06-16
> 状态：已批准

---

## 1. 项目概述

将 Spark 从 Python 通用智能体框架迁移为 **TypeScript 构建的 coding 场景 CLI agent**。使用 npm 管理包，Node.js 运行时，OpenAI 兼容 API 作为 LLM provider。

**核心目标**：一个终端内的 AI 编程助手，能读写文件、执行命令、搜索代码、运行开发工具，通过 ReAct 循环自主完成编码任务。

---

## 2. 架构：单体 CLI

所有逻辑打包为一个 npm 包，`spark` 命令行入口，模块内聚。

```
spark/
  src/
    index.ts          # 主入口
    cli.ts            # CLI 命令定义 (commander.js)
    agent.ts          # ReAct 循环核心
    llm.ts            # OpenAI 兼容 client 封装
    tools/
      index.ts        # 工具注册表 + 执行调度
      file.ts         # read_file, write_file, edit_file, list_dir
      shell.ts        # run_command
      search.ts       # glob, grep
      dev.ts          # format, lint, test, git 操作
    safety.ts         # 确认模式 + 路径/命令安全检查
    memory.ts         # 会话历史 + 滑动窗口
    config.ts         # 配置加载
    prompt.ts         # coding 专用 system prompt
    render.ts         # 终端渲染 (流式输出、工具状态)
  package.json
  tsconfig.json
  .gitignore
  .env.example
```

**构建**：`tsc` 直接编译到 `dist/`。`package.json` 的 `bin.spark` 指向 `dist/cli.js`。

---

## 3. Agent 循环

经典 ReAct 循环，适配 coding 场景：

1. 接收用户消息，追加到会话历史
2. 调用 LLM（流式），获取回复或工具调用
3. 纯文本回复 → 渲染并结束
4. 工具调用 → **顺序执行**（非并行，coding 操作有先后依赖）
5. 每个工具执行前检查是否需要用户确认
6. 将工具结果追加回消息列表，回到步骤 2
7. 达到 maxSteps 上限时停止

**关键决策**：
- **顺序执行工具**：coding 操作如 read → edit → test 有顺序依赖，并行易冲突
- **确认模式**：写/执行类操作需用户确认，读/搜索类自动执行
- **maxSteps 可配置**：默认 20（coding 任务通常需要多步）
- **流式输出**：LLM 回复逐 token 渲染到终端

---

## 4. LLM 集成

使用 OpenAI SDK（兼容模式），通过 `baseURL` 支持任何 OpenAI 兼容的 API。

### 配置

```typescript
interface SparkConfig {
  apiKey: string;        // OPENAI_API_KEY
  baseURL: string;       // OPENAI_BASE_URL (默认 https://api.openai.com/v1)
  model: string;         // 默认 gpt-4
  maxSteps: number;      // 默认 20
  autoApprove: string[]; // 自动批准的工具名
}
```

配置加载优先级：CLI 参数 > 环境变量 > `~/.spark/config.json` > `.env`

### LLM Client

- 流式调用（默认）：逐 token 渲染到终端，支持 tool_call delta 拼装
- 非流式调用：用于简单测试场景
- 错误重试：网络错误自动重试 2 次，rate limit 指数退避

---

## 5. 工具系统

### 工具定义

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: Record<string, JSONSchema>;
  execute: (args: Record<string, unknown>) => Promise<string>;
  requiresConfirmation?: boolean;  // 默认 false
}
```

无需装饰器或运行时反射，直接用对象定义。

### 内置工具

| 工具 | 说明 | 需确认 |
|------|------|--------|
| `read_file` | 读取文件，支持 offset/limit | 否 |
| `write_file` | 写入/创建文件 | 是 |
| `edit_file` | 精确字符串替换 (replace_all) | 是 |
| `list_dir` | 目录列表 | 否 |
| `run_command` | Shell 命令执行 (bash -c) | 是 |
| `glob` | 文件名模式搜索 | 否 |
| `grep` | 内容正则搜索 | 否 |
| `format` | 代码格式化 (prettier/eslint --fix) | 是 |
| `git_status` | Git 状态查看 | 否 |
| `git_diff` | Git diff 查看 | 否 |

### 安全机制

- **路径遍历保护**：resolve 后检查是否在项目目录内
- **命令黑名单**：`rm -rf /`、`sudo`、`mkfs` 等危险命令
- **文件大小限制**：读取上限 10MB
- **确认模式**：`write_file`、`edit_file`、`run_command`、`format` 默认需用户确认

---

## 6. 会话管理

- 对话历史存储在 `~/.spark/sessions/{timestamp}.jsonl`
- 滑动窗口：超过 token 上限时从最早的消息开始裁剪（保留 system prompt）
- 每次 `spark` 启动默认新建会话
- `--continue` 继续上次会话
- `--session <id>` 恢复指定会话

---

## 7. 终端渲染

- **LLM 文本回复**：流式输出到 stdout
- **工具调用**：在 stderr 显示 `[tool_name] args...` + 结果摘要
- **用户确认提示**：`[y/n/a]` (yes/no/auto-approve-all)
- **错误**：红色 stderr 输出

---

## 8. 依赖

### 运行时依赖

| 包 | 用途 |
|-----|------|
| `openai` | OpenAI 兼容 LLM client |
| `commander` | CLI 命令解析 |
| `chalk` | 终端彩色输出 |
| `dotenv` | .env 加载 |
| `glob` | 文件 glob 搜索 |

### 开发依赖

| 包 | 用途 |
|-----|------|
| `typescript` | TS 编译 |
| `@types/node` | Node 类型 |
| `vitest` | 测试框架 |

---

## 9. CLI 命令

```
spark                     # 启动交互式对话
spark "do something"      # 单次执行模式
spark --continue          # 继续上次对话
spark --session <id>      # 恢复指定会话
spark --model <name>      # 指定模型
spark --auto-approve      # 跳过所有确认
spark config              # 查看/设置配置
spark sessions            # 列出历史会话
spark --help              # 帮助信息
```

---

## 10. 旧 Python 代码清理

以下 Python 遗留需全部删除：

- `spark/` Python 包（28 个 .py 文件）
- `tests/` Python 测试（16 个 .py 文件）
- `examples/` Python 示例
- `pyproject.toml`、`requirements.txt`、`requirements-dev.txt`、`uv.lock`
- `.venv/`、`.pytest_cache/`
- `docs/project-analysis.md`、`docs/fix-plan.md`（旧项目分析文档）
- `.gitignore` 重写为 Node.js 版本
