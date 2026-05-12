"""HTTP and WebSocket routes."""

import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from spark import Agent
from spark.server.session import SessionManager

router = APIRouter()

# Global session manager
session_manager = SessionManager()


def create_agent() -> Agent:
    """Create an Agent instance with default tools."""
    # Import tools here to avoid circular imports
    from spark import tool

    @tool
    def get_weather(city: str) -> str:
        """Get weather for a city (mock)."""
        return f"{city}今天晴天，气温25°C"

    @tool
    def calculate(expression: str) -> str:
        """Calculate a math expression."""
        import ast
        try:
            return str(ast.literal_eval(expression))
        except Exception as e:
            return f"Error: {e}"

    return Agent(tools=[get_weather, calculate])


@router.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """
    WebSocket endpoint for chat communication.

    Receives messages and streams agent responses.
    """
    await websocket.accept()
    agent = create_agent()

    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "error",
                    "message": "Invalid JSON"
                })
                continue

            if message.get("type") == "chat":
                user_content = message.get("content", "")

                # Get conversation history
                history = session_manager.get_history(session_id)

                # Add user message to history
                session_manager.add_message(session_id, "user", user_content)

                # Stream agent response
                full_response = ""
                async for event in agent.arun_stream(user_content, history):
                    await websocket.send_json(event)

                    # Collect text deltas for history
                    if event["type"] == "text_delta":
                        full_response += event["delta"]

                # Add assistant response to history
                if full_response:
                    session_manager.add_message(
                        session_id, "assistant", full_response
                    )

            elif message.get("type") == "clear":
                session_manager.clear(session_id)
                await websocket.send_json({"type": "cleared"})

    except WebSocketDisconnect:
        pass
