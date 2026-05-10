# Commit Skill

提交代码到 GitHub 的标准流程。

## 使用方式

```
/commit
```

## 步骤

1. **检查状态**
   ```bash
   git status
   git log --oneline -3
   ```

2. **暂存文件**
   ```bash
   git add <files>
   # 或暂存所有更改
   git add .
   ```

3. **创建提交**
   ```bash
   git commit -m "$(cat <<'EOF'
   <type>: <subject>

   <body>

   Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
   EOF
   )"
   ```

4. **推送到远程**
   ```bash
   git push origin main
   ```

## 提交类型

| 类型 | 说明 |
|------|------|
| feat | 新功能 |
| fix | 修复 bug |
| docs | 文档更新 |
| refactor | 重构代码 |
| test | 测试相关 |
| chore | 构建/工具相关 |

## 注意事项

- 分支：推送到 `main` 分支
- 敏感文件：确保 `.env` 等敏感文件在 `.gitignore` 中
- 提交信息：使用 Conventional Commits 格式

## 示例

```bash
# 查看状态
git status

# 暂存特定文件
git add spark/agent.py tests/test_agent.py

# 提交
git commit -m "$(cat <<'EOF'
feat: add agent loop implementation

- Add async/sync run methods
- Support tool execution
- Add error handling

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"

# 推送
git push origin main
```
