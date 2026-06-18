# Spark CLI Coding Agent

An AI-powered coding assistant for your terminal.

## Install

```bash
npm install
npm run build
```

## Usage

```bash
# Interactive mode
spark

# Single-shot mode
spark "fix the bug in src/app.ts"

# With options
spark --model gpt-4o "refactor the auth module"
spark --auto-approve "run the test suite"
spark --continue
spark sessions

# View configuration
spark config
```

## Configuration

Set in `.env` or environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | required | Your API key |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | API base URL (supports any OpenAI-compatible API) |
| `OPENAI_MODEL` | `gpt-4` | Model to use |
| `SPARK_MAX_STEPS` | `20` | Maximum agent steps per request |
| `SPARK_AUTO_APPROVE` | (none) | Comma-separated tool names to auto-approve |

## Tools

| Tool | Description | Requires Confirmation |
|------|-------------|----------------------|
| `read_file` | Read file contents with line numbers | No |
| `write_file` | Write or create files | Yes |
| `edit_file` | Precise string replacement in files | Yes |
| `list_dir` | List directory contents | No |
| `run_command` | Execute shell commands | Yes |
| `glob_files` | Search files by name pattern | No |
| `grep_content` | Search file contents by regex | No |
| `git_status` | Show git working tree status | No |
| `git_diff` | Show git diff of changes | No |
| `format` | Run code formatter (prettier) | Yes |

## Development

```bash
npm run dev       # Watch mode
npm test          # Run tests
npm run lint      # Type check
npm run build     # Compile to dist/
```

## License

MIT
