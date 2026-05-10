# Spark Project Memory

## 项目配置

- **Python**: 3.10+
- **依赖管理**: requirements.txt
- **分支**: main（推送到 origin/main）
- **模型**: DeepSeek (deepseek-v4-flash)

## 项目结构

```
spark/
├── __init__.py      # 导出 Agent, Tool, tool
├── agent.py         # Agent 类（ReAct 循环）
├── tool.py          # Tool 类
├── schema.py        # 工具 schema 生成
└── prompts/
    ├── __init__.py
    ├── base.py      # 默认提示词
    └── templates.py # 提示词模板
```

## Skills

- `/commit` - 代码提交流程（见 `.claude/skills/commit.md`）

## 环境配置

`.env` 文件配置：
```
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-v4-flash
```

## 开发命令

```bash
# 安装依赖
pip install -r requirements.txt
pip install -r requirements-dev.txt

# 运行测试
pytest tests/ -v

# 代码检查
ruff check spark/ tests/

# 测试连接
python examples/test_connection.py
```
