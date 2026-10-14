# 来源与授权（必读）

本目录内容**不是本项目原创**，逐字来自开源项目 **柳如烟 (Ruyan AI)**：
<https://github.com/vooccc/liuruyan>  ·  commit `1269f88`

| 范围 | 上游授权 |
|---|---|
| 角色模板正文、SCHEMA 规范、运行态角色文件（`templates/`、`runtime/`） | **CC BY-NC-ND 4.0** —— 署名 / 非商业 / 禁止演绎 |
| 上游工程代码（Apache 2.0） | 与本目录无关 |

**使用边界**：仅限个人非商业性本地使用与学习交流。

⚠️ **一旦产物离开本机**（公开发布、打包分发、部署成对外的服务、随 APK 分发），
即超出该授权范围 —— "换皮倒卖或打包收费"是被明确禁止的。
对外分发的版本请自行撰写角色内容，只借鉴结构（见 `templates/SCHEMA.md`）。

上游立绘 `avatar.png` 未复制（模板的 `meta.json` 里已带 emoji 头像字段）。

## 为什么这两个目录不入库

`templates/` 与 `runtime/` 已写进根目录 `.gitignore`：**本仓库是公开的，提交即等于对外分发**，
而该授权明确禁止再分发与演绎。这是本目录唯一需要注意的操作纪律。

- **缺了它们服务照样启动**：`loadPersona()` 找不到资产就返回 null，角色功能静默退化为
  通用助手人格（`loadAssistantContext` 返回空片段），不影响其它任何能力。
- **换位置**：设 `OPENMUSE_PERSONAS_DIR` 指向别处；否则按
  `apps/server/personas`（源码布局）→ 同级 `personas/`（产物布局）依次探测。
- **想自己造角色**：照 `SCHEMA.md` 的 Schema v2 写一套 `SOUL/GENOME/PERSONALITY/IDENTITY`
  加 `meta.json` 放进 `templates/<你的 id>/` 即可 —— 自己写的角色由你自己定授权。

## 目录结构

```
personas/
  ORIGIN.md            ← 本文件（来源与边界）
  templates/           ← 模板库：<id>/ 含 SOUL/GENOME/PERSONALITY/IDENTITY + meta.json（被 gitignore）
    SCHEMA.md          ← Schema v2 规范：加载器据此校验（被 gitignore）
  runtime/             ← 运行态角色：多一个 EMOTION.json / USER.md / MEMORY.md（被 gitignore）
```

加载与校验见 `apps/server/src/engine/personas.ts`；
记忆的温度/衰减模型见 `apps/server/src/engine/memory-temperature.ts`；
两者与数据库的连接层见 `apps/server/src/engine/assistant-context.ts`。
