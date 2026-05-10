# Spark

**点燃思维的火种**

Spark 是一个轻量级 Python 智能体框架。它不试图做所有事情，只做好一件事：让 agent loop 简洁清晰。

核心理念：**简单即是力量**。没有复杂的抽象，没有过度设计。一个循环，一组工具，无限可能。

## 特性

- **极简架构**：ReAct 循环 + 工具调用，一目了然
- **OpenAI 兼容**：支持 OpenAI 及所有兼容 API（如 Azure、本地模型等）
- **同步/异步**：同时支持 `run()` 和 `arun()` 方法
- **自动 Schema 生成**：从函数签名自动生成工具参数 Schema
- **零魔法**：代码即文档，没有隐藏行为

## 安装

```bash
pip install spark-agent
```

## 快速开始

### 基础用法

```python
from spark import Agent

agent = Agent(model="gpt-4")
response = agent.run("你好！")
print(response)
```

### 自定义工具

使用 `@tool` 装饰器定义工具，函数签名和文档字符串会自动转换为 OpenAI function calling schema：

```python
from spark import Agent, tool

@tool
def search(query: str, limit: int = 10) -> str:
    """搜索网络获取信息。

    Args:
        query: 搜索关键词
        limit: 返回结果数量
    """
    # 实现搜索逻辑
    return f"找到 {limit} 条关于 '{query}' 的结果"

@tool
async def fetch_url(url: str) -> str:
    """获取网页内容。"""
    import httpx
    async with httpx.AsyncClient() as client:
        resp = await client.get(url)
        return resp.text

agent = Agent(model="gpt-4", tools=[search, fetch_url])
response = agent.run("今天北京天气如何？")
```

### 异步运行

```python
import asyncio
from spark import Agent, tool

@tool
def calculate(expression: str) -> float:
    """计算数学表达式。"""
    return eval(expression)

async def main():
    agent = Agent(model="gpt-4", tools=[calculate])
    response = await agent.arun("计算 123 * 456")
    print(response)

asyncio.run(main())
```

### 自定义系统提示词

```python
from spark import Agent
from spark.prompts import build_system_prompt

# 使用模板构建
prompt = build_system_prompt(
    role="智能助手",
    capabilities=["网络搜索", "数学计算"],
    instructions=["回答简洁", "提供来源"]
)

agent = Agent(model="gpt-4", system_prompt=prompt)
```

## 配置

### 环境变量

```bash
export OPENAI_API_KEY="your-api-key"
export OPENAI_MODEL="gpt-4"  # 可选，默认 gpt-4
export OPENAI_BASE_URL="https://api.openai.com/v1"  # 可选，用于自定义端点
```

### 直接传参

```python
agent = Agent(
    model="gpt-4-turbo",
    api_key="your-api-key",
    base_url="https://your-custom-endpoint.com/v1"
)
```

## API 参考

### `Agent`

```python
Agent(
    model: str | None = None,          # 模型名称，默认 "gpt-4"
    tools: list[Tool] | None = None,   # 工具列表
    system_prompt: str | None = None,  # 系统提示词
    api_key: str | None = None,        # API 密钥
    base_url: str | None = None        # API 基础 URL
)
```

**方法：**

- `run(message: str, max_steps: int = 10) -> str` - 同步运行
- `arun(message: str, max_steps: int = 10) -> str` - 异步运行
- `add_tool(tool: Tool) -> None` - 动态添加工具

### `@tool` 装饰器

```python
from spark import tool

@tool
def my_tool(param: str, optional: int = 0) -> str:
    """工具描述，会作为工具的 description。"""
    return "result"
```

支持的类型：
- 基本类型：`str`, `int`, `float`, `bool`
- 容器类型：`list[T]`, `dict[K, V]`
- 可选类型：`Optional[T]`

## 开发

```bash
# 克隆仓库
git clone https://github.com/wqh2019/Spark.git
cd Spark

# 创建虚拟环境
python -m venv .venv
source .venv/bin/activate  # Linux/macOS
# .venv\Scripts\activate  # Windows

# 安装依赖
pip install -e ".[dev]"

# 运行测试
pytest
```

## 许可证

MIT
