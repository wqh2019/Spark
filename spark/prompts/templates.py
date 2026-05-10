"""
Spark Prompts - Prompt template functions for building custom system prompts.
"""


def build_system_prompt(
    role: str = "helpful AI assistant",
    capabilities: list[str] | None = None,
    instructions: list[str] | None = None,
) -> str:
    """
    Build a custom system prompt.

    Args:
        role: The role description for the assistant
        capabilities: List of capabilities the assistant has
        instructions: List of behavioral instructions

    Returns:
        A formatted system prompt string

    Example:
        prompt = build_system_prompt(
            role="intelligent assistant",
            capabilities=["web search", "math calculations"],
            instructions=["Be concise", "Always cite sources"]
        )
    """
    lines = [f"You are a {role}."]

    if capabilities:
        lines.append("\nCapabilities:")
        lines.extend(f"- {cap}" for cap in capabilities)

    if instructions:
        lines.append("\nInstructions:")
        lines.extend(f"- {inst}" for inst in instructions)

    return "\n".join(lines)
