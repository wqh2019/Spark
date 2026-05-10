# Spark

**点燃思维的火种**

Spark 是一个轻量级 Python 智能体框架。它不试图做所有事情，只做好一件事：让 agent loop 简洁清晰。

核心理念：**简单即是力量**。没有复杂的抽象，没有过度设计。一个循环，一组工具，无限可能。

```python
from spark import Agent, Tool

@tool
def search(query: str) -> str:
    """搜索网络获取信息"""
    ...

agent = Agent(tools=[search])
agent.run("今天北京天气如何？")
```

## 特性

- **极简架构**：ReAct 循环 + 工具调用，一目了然
- **模型无关**：支持 OpenAI、Anthropic、本地模型，切换只需一行配置
- **可控性强**：每一步都可观测、可中断、可调试
- **零魔法**：代码即文档，没有隐藏行为

## 安装

```bash
pip install spark-agent
```

## 快速开始

```python
from spark import Agent

agent = Agent(model="gpt-4")
agent.run("你好！")
```

## 文档

 Coming soon...

## 许可证

MIT
