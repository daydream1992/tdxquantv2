# 🚀 TDX Quant v2 项目协作指南

欢迎加入 TDX Quant v2 项目维护！这个指南会帮你快速上手。

## 📋 快速开始

### 1. 克隆项目（3分钟）

```bash
# 克隆仓库
git clone https://github.com/daydream1992/tdxquantv2.git
cd tdxquantv2

# 查看项目结构
ls -la
```

### 2. 配置 Git Token（只需一次）

**Windows 用户：**
```bash
# 设置 Git 凭据
git config credential.helper store

# 添加 GitHub Token（查看 .env.github 文件获取当前Token）
echo "https://daydream1992:YOUR_TOKEN@github.com" > ~/.git-credentials
```

**验证配置成功：**
```bash
git ls-remote --heads origin
# 应该看到分支列表
```

## 🛠️ 日常开发流程

### 创建新分支

```bash
# 拉取最新代码
git pull origin main

# 创建新分支
git checkout -b feature/你的功能名

# 开始编码...
```

### 提交代码

```bash
# 查看修改状态
git status

# 添加修改的文件
git add .

# 提交（写清楚改了什么）
git commit -m "fix: 修复了XXX问题"

# 推送到远程
git push -u origin feature/你的功能名
```

### 合并到主分支

```bash
# 切换到 main 分支
git checkout main

# 拉取最新代码
git pull origin main

# 合并你的分支
git merge feature/你的功能名

# 推送到远程
git push origin main
```

## 📝 提交信息规范

使用这种格式：`类型: 描述`

**常见类型：**
- `fix:` 修复 bug
- `feat:` 新功能
- `refactor:` 重构代码
- `docs:` 文档更新
- `test:` 测试相关
- `chore:` 构建/工具相关

**示例：**
```bash
git commit -m "fix: 修复选股结果为空的问题"
git commit -m "feat: 添加新的技术指标"
git commit -m "docs: 更新安装说明"
```

## 🔄 同步最新代码

```bash
# 从主分支拉取最新代码
git pull origin main

# 如果有冲突，先解决冲突
# 然后再推送
git push origin 你的分支
```

## 🆘 常见问题

### 推送时提示权限不足？
```bash
# 重新配置 Token（查看 .env.github 文件获取当前Token）
git config credential.helper store
echo "https://daydream1992:YOUR_TOKEN@github.com" > ~/.git-credentials
```

### 忘记 Token 保存了吗？
Token 已经保存在这个项目的 `.env.github` 文件中，随时查看。

### 想查看项目状态？
```bash
# 查看所有分支
git branch -a

# 查看最近的提交
git log --oneline -5

# 查看远程仓库
git remote -v
```

## 🎯 项目结构

```
tdxquantv2/
├── engine/           # 核心量化引擎
├── config/           # 配置文件
├── strategies/       # 策略配置
├── scripts/          # 工具脚本
├── docs/            # 项目文档
└── src/             # 前端代码
```

## 📞 需要帮助？

- 查看项目文档：`docs/README.md`
- 查看 Git 历史：`git log --oneline`
- 联系项目维护者：daydream1992

---

**祝你编码愉快！🎉**