# Aarre 生产运维入口

后续 Agent 处理账号、云端、同步、备份、腾讯云或 Google OAuth 前，先阅读：

1. [生产云端交接手册](cloud-production/README.md)
2. [加密恢复包说明](encrypted-secrets/README.md)
3. [服务端运行手册](../server/README.md)
4. [当前项目进展](../AGENT_PROGRESS.md)

`ops/encrypted-secrets/` 允许进入 Git 的只有加密包、SHA-256 和说明。明文 SSH 私钥、OAuth Secret、CAM Secret、数据库密码、KEK、Token、Cookie 和恢复口令都禁止提交。
