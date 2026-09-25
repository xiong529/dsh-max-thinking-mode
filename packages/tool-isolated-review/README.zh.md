---
description: "面向模型的隔离审思工具，供组合最大思考预设的用户与维护者使用：把方案交给一个无工具的评审者，以完全不同的角度重新思考并尝试反驳。"
kind: "package-reference"
---

# @dsh-max-thinking/tool-isolated-review

[English](README.md) | 中文

## Summary

使用本包可为 Agent 提供 `isolated_review` 工具。主模型传入必要的任务上下文与其最终方案；工具派生一个或多个**没有工具、没有文件、没有网络、也没有对话历史**的全新子 agent，要求每个评审者从不同角度重新思考、贡献一个其他评审者想不到的观点、并尝试反驳该方案，再把每个评审者的结构化裁决（`sound-as-is` 原样可用 / `sound-with-changes` 需修改 / `different-approach` 应换方案，附反对意见与最强弱点）返回主模型。工具支持并行评审（最多三位）交叉验证、第二轮对抗（`prior_review` + `submitter_rebuttal`），以及终审仲裁（`arbitrate`）——仲裁者逐条采纳或驳回反对意见、防范群体思维，并给出所选方向的最强进化方向。最终决定权仍在主模型：它权衡各裁决与反对意见，选择最优解。

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

挂载 subagent 服务、一个全新上下文的提供方（如进程内 spawn 提供方）以及本工具，然后指定提供方名称。工具在其提供方存在期间存在，因此兄弟插件的加载顺序与提供方重载都不会让它悬空。

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-subagent'
- name: '@deepseek-ai/dsh-subagent-spawn-in-process'
- name: '@dsh-max-thinking/tool-isolated-review'
  config:
    provider: spawn
```

| Field | Default | Meaning |
|---|---|---|
| `provider` | 必填 | `ctx.subagents` 上负责派生全新上下文子 agent 的提供方名称（如 `spawn`） |
| `toolName` | `isolated_review` | 模型可见工具名；每个加载实例必须唯一 |
| `persona` | 固定评审者身份 | 覆盖部署 persona 的逐评审者 persona |

每个可接受字段及其 JSDoc 的完整定义见 `src/index.ts`（`Config` schema 与工具参数 schema）。

### 模型传入什么

工具 schema 提供 `task_context`（评审者必须依赖的必要上下文——它没有工具，所以上下文必须完整）、`proposed_solution`（主模型的最终方案或计划），以及可选的 `alternative_angle`、`review_focus`、`review_question`、`reviewers`（1–3）、用于第二轮对抗的 `prior_review` 加 `submitter_rebuttal`，以及终审仲裁 `arbitrate`。评审的整个框架都由主模型自主拟定——每个评审者看到什么、从哪个角度想、必须回答哪个具体问题——并按场景选择问题（设计取舍、不熟悉的实现、方案对比，各自需要不同的问题）。每位评审者必须贡献至少一个其他评审者想不到的观点；仲裁者逐条采纳或驳回反对意见、防范群体思维，并给出进化方向。评审者与仲裁者的回复均为结构化；决定权始终在主模型。

### 隔离约定

评审者受到双重隔离。全新上下文提供方隐藏了父对话与已完成轮次；工具再应用一个不保留任何继承工具的 `toolFilter`，外加固定的评审者 persona，因此评审者的提示词里只有传入的上下文。它不能读取文件、执行命令、联网检索或委派，也不能询问用户；它只依据给定上下文推理。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>实现内部——点击展开</summary>

插件注册一个 `defineTool` 并镜像提供方生命周期：工具在命名提供方注册时挂载、离开时卸载。缺少 `toolFilter` 或 `persona` 能力的提供方会在挂载时被拒绝——隔离约定不能静默降级。每次调用都会根据模型参数组装评审提示词，通过 `ctx.subagents.start` 以前台一次性运行启动子 agent（携带 `toolFilter: { allow: [] }` 与评审者 persona），等待终态结果、释放运行，再把评审者文本作为 `{ review }` 返回。非 `completed` 的停止原因映射为错误结果，保留评审者的部分输出与提供方诊断；工具信号即提供方的取消通道。

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Subagent seam](../subagent/README.zh.md) —— 一次性与可续接的子 agent 委派。
- [Agent](../../core/agent/README.zh.md) —— Session 运行时。
- [Tools](../../core/tools/README.zh.md) —— 工具注册与执行。

<a id="model-experience"></a>
## Model Experience

### 模型看到什么

挂载预设的工具目录里多一个工具：`isolated_review`，以模型可见语言描述（把方案交给隔离评审者，获取独立、对抗式的第二意见）。工具结果是评审者的回复文本；模型必须权衡并裁决。

### Token 影响

每次调用派生一个全新子 agent，读取传入上下文并产出一份回复；子 agent 的系统提示词很精简（身份加评审者 persona，无工具段落）。成本随传入上下文与评审者回复长度增长。

### KV Cache 影响

子 agent 是全新会话，不复用父提示词前缀；父日志以普通事件记录该工具调用与结果。

## Known Limitations and Deferred Work

- 评审者只依据传入上下文推理：它无法对照仓库验证主张，因此主模型应传入所需的证据，并在行动前核实评审者的反对意见。
- 暂缓：后台/可续接的评审模式（并行多个评审者，或通过后续问题引导评审者）暂未提供；每次调用是一次同步评审。
- **不发布运行时不变式伴生入口。** 本插件只注册一个工具，不持有任何可独立观测的运行时状态；其归属关系（工具随提供方生命周期挂载）随 fiber 由注册表释放，并由本包的 REAL-composition 测试覆盖。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者工作背景——点击展开</summary>

无。

</details>
