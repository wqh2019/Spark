"""
Spark Prompts - System prompt management.
"""

from spark.prompts.base import DEFAULT_SYSTEM_PROMPT
from spark.prompts.templates import build_system_prompt

__all__ = ["DEFAULT_SYSTEM_PROMPT", "build_system_prompt"]
