"""
One-shot test to verify Agent connection.
"""

import asyncio
import sys
import io
from dotenv import load_dotenv

from spark import Agent, tool

# Fix Windows encoding
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Load .env file
load_dotenv()


@tool
def get_weather(city: str) -> str:
    """Get weather for a city (mock)."""
    return f"{city}今天晴天，气温25°C"


async def main():
    agent = Agent(tools=[get_weather])

    print("测试 Agent 连接...")
    print(f"模型: {agent.model}")
    print()

    # Test 1: Simple question
    print("Test 1: 简单问题")
    result = await agent.arun("你好，请用一句话介绍你自己")
    print(f"回复: {result}\n")

    # Test 2: Tool call
    print("Test 2: 工具调用")
    result = await agent.arun("北京今天天气怎么样？")
    print(f"回复: {result}\n")

    print("测试完成!")


if __name__ == "__main__":
    asyncio.run(main())
