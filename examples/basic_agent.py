"""
Quick test script to verify Agent can talk to DeepSeek.
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
    # Mock implementation
    return f"{city}今天晴天，气温25°C"


@tool
def calculate(expression: str) -> str:
    """Calculate a math expression."""
    import ast
    try:
        result = ast.literal_eval(expression)
        return str(result)
    except Exception as e:
        return f"计算错误: {e}"


async def main():
    agent = Agent(tools=[get_weather, calculate])

    print("Agent 已启动，输入 'quit' 退出\n")

    while True:
        try:
            user_input = input("You: ").strip()
            if not user_input:
                continue
            if user_input.lower() == "quit":
                print("再见!")
                break

            print("Agent: ", end="", flush=True)
            result = await agent.arun(user_input)
            print(result)
            print()

        except KeyboardInterrupt:
            print("\n再见!")
            break


if __name__ == "__main__":
    asyncio.run(main())
