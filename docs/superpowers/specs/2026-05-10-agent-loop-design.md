# Agent Loop 设计文档

## 概述

实现Spark框架的核心agent loop，采用ReAct模式：LLM推理 → 工具调用 → 结果反馈 → 循环。

## 设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 模型支持 | 仅OpenAI | 先专注核心功能，后续扩展 |
| 运行模式 | 异步 | 现代Python风格，支持异步工具 |
| 终止条件 | LLM自主 + 最大步数 | 防止无限循环 |
| 错误处理 | 反馈给LLM | 让LLM决定如何处理错误 |
| 配置管理 | 环境变量 + 代码分离 | 敏感信息走环境变量，提示词代码化管理 |

## 架构

```
用户消息 → [LLM调用] → [判断响应类型]
                              ↓
                    有tool_call → 执行工具 → 结果追加到messages → 循环
                              ↓
                    无tool_call → 返回最终响应
```

## 组件设计

### Agent类

```python
import os
from openai import AsyncOpenAI
from spark.prompts import DEFAULT_SYSTEM_PROMPT

class Agent:
    def __init__(
        self,
        model: str | None = None,
        tools: list[Tool] | None = None,
        system_prompt: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
    ):
        self.model = model or os.getenv("OPENAI_MODEL", "gpt-4")
        self.tools = tools or []
        self.system_prompt = system_prompt or DEFAULT_SYSTEM_PROMPT
        self._tool_map = {t.name: t for t in self.tools}
        self.client = AsyncOpenAI(
            api_key=api_key or os.getenv("OPENAI_API_KEY"),
            base_url=base_url or os.getenv("OPENAI_BASE_URL"),
        )

    async def arun(self, message: str, max_steps: int = 10) -> str:
        """异步运行agent loop"""
        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": message},
        ]

        for step in range(max_steps):
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=self._build_tool_schema(),
            )

            assistant_msg = response.choices[0].message

            if not assistant_msg.tool_calls:
                return assistant_msg.content or ""

            messages.append(assistant_msg.model_dump())

            for tool_call in assistant_msg.tool_calls:
                result = await self._execute_tool(tool_call)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result,
                })

        return "Error: Reached maximum steps without completing the task."

    def run(self, message: str, max_steps: int = 10) -> str:
        """同步运行agent"""
        return asyncio.run(self.arun(message, max_steps))

    async def _execute_tool(self, tool_call) -> str:
        """执行单个工具调用"""
        tool_name = tool_call.function.name
        tool_args = json.loads(tool_call.function.arguments)

        if tool_name not in self._tool_map:
            return f"Error: Tool '{tool_name}' not found"

        try:
            tool = self._tool_map[tool_name]
            result = tool.run(**tool_args)
            if asyncio.iscoroutine(result):
                result = await result
            return str(result)
        except Exception as e:
            return f"Error executing {tool_name}: {e}"

    def _build_tool_schema(self) -> list[dict] | None:
        """将Tool列表转换为OpenAI tools参数格式"""
        if not self.tools:
            return None

        return [
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": build_parameters_schema(tool.func),
                }
            }
            for tool in self.tools
        ]
```

### Schema生成模块

新增 `spark/schema.py`：

```python
import inspect
from typing import Any, get_type_hints

def build_parameters_schema(func: callable) -> dict:
    """
    从函数签名生成OpenAI function calling参数schema。

    Example:
        @tool
        def search(query: str, limit: int = 10) -> str:
            '''Search the web'''
            ...

        # 生成:
        {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer", "default": 10}
            },
            "required": ["query"]
        }
    """
    sig = inspect.signature(func)
    hints = get_type_hints(func)

    properties = {}
    required = []

    for name, param in sig.parameters.items():
        if name == "self":
            continue

        prop = _type_to_schema(hints.get(name, str))
        if param.default is inspect.Parameter.empty:
            required.append(name)
        else:
            prop["default"] = param.default

        properties[name] = prop

    return {
        "type": "object",
        "properties": properties,
        "required": required,
    }

def _type_to_schema(python_type: type) -> dict:
    """Python类型映射到JSON Schema类型"""
    type_map = {
        str: {"type": "string"},
        int: {"type": "integer"},
        float: {"type": "number"},
        bool: {"type": "boolean"},
        list: {"type": "array"},
        dict: {"type": "object"},
    }
    return type_map.get(python_type, {"type": "string"})
```

## 文件结构

```
spark/
├── __init__.py      # 导出 Agent, Tool, tool
├── agent.py         # Agent类（核心循环）
├── tool.py          # Tool类（已有）
├── schema.py        # 工具schema生成
└── prompts/
    ├── __init__.py      # 导出 DEFAULT_SYSTEM_PROMPT, build_system_prompt
    ├── base.py          # 基础提示词常量
    └── templates.py     # 提示词模板函数（可扩展）
```

## 提示词模块

`spark/prompts/base.py`:
```python
DEFAULT_SYSTEM_PROMPT = """You are a helpful AI assistant.
You can use available tools to help answer questions.
Always be accurate and helpful."""
```

`spark/prompts/templates.py`:
```python
def build_system_prompt(
    role: str = "helpful AI assistant",
    capabilities: list[str] | None = None,
) -> str:
    """构建自定义系统提示词"""
    lines = [f"You are a {role}."]

    if capabilities:
        lines.append("\nCapabilities:")
        lines.extend(f"- {cap}" for cap in capabilities)

    return "\n".join(lines)
```

`spark/prompts/__init__.py`:
```python
from .base import DEFAULT_SYSTEM_PROMPT
from .templates import build_system_prompt
```

## 配置管理

敏感配置通过环境变量管理，使用 `.env` 文件：

```env
OPENAI_API_KEY=your-api-key-here
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_MODEL=deepseek-v4
```

配置优先级：代码参数 > 环境变量 > 默认值

## 依赖管理

使用 `requirements.txt` 管理依赖：

```
openai>=1.0.0
python-dotenv>=1.0.0
```

开发依赖在 `requirements-dev.txt` 中。

## 消息格式

OpenAI Chat API消息结构：

```python
# 系统消息
{"role": "system", "content": "You are a helpful assistant."}

# 用户消息
{"role": "user", "content": "今天北京天气如何？"}

# 助手消息（含工具调用）
{
    "role": "assistant",
    "content": null,
    "tool_calls": [
        {
            "id": "call_xxx",
            "type": "function",
            "function": {
                "name": "search",
                "arguments": "{\"query\": \"北京天气\"}"
            }
        }
    ]
}

# 工具结果消息
{
    "role": "tool",
    "tool_call_id": "call_xxx",
    "content": "北京今天晴天，气温25°C"
}
```

## 测试策略

### 单元测试

1. `_execute_tool` 测试
   - 正常执行同步工具
   - 正常执行异步工具
   - 工具不存在返回错误信息
   - 执行异常返回错误信息

2. `_build_tool_schema` 测试
   - 无工具返回None
   - 单工具schema生成
   - 多工具schema生成
   - 必需参数和默认值处理

3. `build_parameters_schema` 测试
   - 各种类型映射
   - 必需/可选参数识别

### 集成测试

使用`pytest-mock`或`respx`模拟OpenAI API：
- 无工具调用直接返回
- 单次工具调用后返回
- 多次工具调用循环
- 达到最大步数

## 使用示例

```python
from spark import Agent, tool
from spark.prompts import build_system_prompt

@tool
def search(query: str) -> str:
    """搜索网络获取信息"""
    return f"搜索结果: {query}"

@tool
def calculate(expression: str) -> str:
    """计算数学表达式"""
    # 注意：实际实现应使用安全的表达式解析
    import ast
    return str(ast.literal_eval(expression))

# 使用默认配置（从环境变量读取）
agent = Agent(tools=[search, calculate])

# 或自定义配置
agent = Agent(
    model="gpt-4-turbo",
    tools=[search, calculate],
    system_prompt=build_system_prompt(
        role="智能助手",
        capabilities=["网络搜索", "数学计算"]
    ),
)

# 异步使用
async def main():
    result = await agent.arun("帮我计算123*456")
    print(result)

# 同步使用
result = agent.run("今天天气如何？")
print(result)
```

## 依赖

- `openai>=1.0.0` - OpenAI SDK，已包含异步支持
- `python-dotenv>=1.0.0` - 加载 .env 文件
- Python 3.10+ - 已支持`asyncio.iscoroutine`

## 实现状态

✅ 已完成实现，所有测试通过。

### 实现细节

1. **延迟初始化 OpenAI 客户端**：客户端在首次访问时才创建，避免在测试环境中不必要的 API key 验证。

2. **JSON 解析错误处理**：工具参数解析失败时返回明确的错误信息。

3. **复杂类型支持**：Schema 生成支持 `Optional[T]`、`list[T]`、`dict[K, V]` 等泛型类型。

4. **同步方法兼容性**：`run()` 方法可在异步环境中正常工作。
