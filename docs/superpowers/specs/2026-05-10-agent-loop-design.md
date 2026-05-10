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
class Agent:
    def __init__(
        self,
        model: str = "gpt-4",
        tools: list[Tool] | None = None,
        system_prompt: str | None = None,
        api_key: str | None = None,
    ):
        self.model = model
        self.tools = tools or []
        self.system_prompt = system_prompt or "You are a helpful assistant."
        self._tool_map = {t.name: t for t in self.tools}
        self.client = AsyncOpenAI(api_key=api_key)

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
└── schema.py        # 工具schema生成
```

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

@tool
def search(query: str) -> str:
    """搜索网络获取信息"""
    return f"搜索结果: {query}"

@tool
def calculate(expression: str) -> str:
    """计算数学表达式"""
    return str(eval(expression))

agent = Agent(
    model="gpt-4",
    tools=[search, calculate],
    system_prompt="你是一个智能助手。"
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

现有依赖无需变更：
- `openai>=1.0.0` - 已包含异步支持
- Python 3.10+ - 已支持`asyncio.iscoroutine`
