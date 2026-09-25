# dsh-max-thinking-mode

**最大思考模式（Max Thinking mode）**—— 为 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 设计的 Agent 预设，面向**没有现成答案的问题**：新功能、没见过的新设计、尚未实现过的方案。

---

## 一、这个模式是什么

在 DSH 中选择该模式后，Agent 会：

- **想得更深**：产生多个候选方案，把每个方案向前推演到各种可能结果，再用证据（检索、原型、小实验）验证假设，而不是一上来就按第一个想法行动。
- **主动找突破**：常规路径全失败时，重新定义问题、跨领域借思路、刻意改变约束，寻找框架外的解法。
- **自我对抗**：每个重要方案动手前，从用户、实现者、架构师、失败边界、测试、成本六个视角审视，并列出至少三条"它可能怎么失败"。
- **请独立评审**：对重大决策，把方案交给没有工具、没有上下文的全新子 agent 从不同角度反驳（`isolated_review` 工具），拿回结构化裁决后再决定。
- **诚实**：需求模糊时先问用户而不是猜；方案有边界或风险时如实声明；走不通的分支记录原因后换路，不重复踩死胡同。

---

## 二、包含哪些模块

```
presets/max-thinking.patch.yml       预设声明（核心）：persona 深度思考指令 + 标准模式工具集 + isolated_review 工具
packages/tool-isolated-review/       隔离审思工具包：把方案交给无工具评审者反驳，返回结构化裁决
docs/evaluation-results.md           五任务实测报告：与标准模式的对比结果
docs/max-thinking-engine-design.md   下一代「思考引擎」设计草案（进阶阅读）
docs/evaluating-agent-preset-modes.zh.md  评估协议（如何复现本报告的测评）
```

| 模块 | 作用 |
|---|---|
| **预设声明** | 定义"最大思考模式"是什么：一段 persona 指令 + 挂载的工具列表。安装后出现在 DSH 的新任务模式菜单。 |
| **isolated_review 工具** | 独立对抗评审：派生无工具/无文件/无历史的子 agent，要求它从不同角度重新思考并反驳你的方案，返回 `sound-as-is / sound-with-changes / different-approach` 结构化裁决。支持 2–3 个并行评审、第二轮对抗、终审仲裁。 |
| **文档** | 安装说明、使用说明、实测对比报告、设计草案。 |

---

## 三、与标准模式的对比

| 维度 | 标准模式 | 最大思考模式 |
|---|---|---|
| 工具集 | 完整工具集 | **与标准模式相同**（文件、终端、搜索、子 agent、任务规划等）+ 1 个额外工具 `isolated_review` |
| 工作方式 | 按第一个可行方案推进 | 多候选生成 → 前向推演 → 证据验证 → 多视角审视 → 对抗反驳 → 收敛 |
| 对外取证 | 一般 | **主动**检索资料、读源码、查文档、做最小原型 |
| 模糊需求 | 可能猜测 | 先问用户确认，不静默猜测 |
| 失败处理 | 一路推进 | 自由回退，记录探索足迹，不重复死胡同 |
| 独立评审 | 无 | 重大决策前调用 `isolated_review` 请无工具评审者反驳 |
| 适用场景 | 日常编码、熟路任务 | **没有现成答案的困难/创新任务** |
| 成本 | 较低 | 更高：更多推理、更多工具调用、更多 token（实测约 1.3–2 倍） |

**一句话**：标准模式解决"知道怎么做"的任务；最大思考模式解决"不知道怎么做、第一直觉多半是错的"的任务。

---

## 四、实测结果摘要（五任务对比）

用 **deepseek-v4-flash** 模型、同一任务文本、标准模式 vs 最大思考模式各跑一遍，评分对象是方案优劣与突破点强度（评估协议见 `docs/evaluating-agent-preset-modes.zh.md`，完整数据见 `docs/evaluation-results.md`）：

| 维度 | 标准模式 | 最大思考模式 |
|---|---|---|
| 方案质量 | — | **5 胜 0 负 1 平** |
| 突破点（累计） | 22 | **33** |
| 任务 3 验收 | 38/38 自检通过 | 76/76 单测 + 27/27 几何 + 13/13 像素全绿（独立复现） |
| 任务 4 验收 | 文档论证 | 组合批处理实测 **13–30 倍**于互斥锁（独立复现） |

**结论**：最大思考模式在突破强度上五战全胜，增量是标准模式没想到的新机制 + 可运行、可复现的证据 + 诚实的边界声明。

---

## 五、安装

### 前置条件

- 已安装 DeepSeek Harness Web 应用（`@deepseek-ai/dsh-web-app`），其提供预设注册表与本模式组合依赖的标准工具集。
- 构建工具包需要 Node.js `^22.19 || >=24` 与 `pnpm`。

### 方式 A：通过插件管理器安装（推荐）

在 DSH Web UI 的**插件**页，或通过 `plugin_manager` API，把本仓库作为 bundle 安装：

```
plugin_manager install_bundle --target <本仓库路径>
```

安装后，**最大思考模式**出现在新任务模式菜单与 Agent 预设设置中。

### 方式 B：在 profile 中声明

在 `$DSH_HOME/profiles/<name>/package.json` 的 bundles 中加入本仓库：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-headless",
        "@dsh-max-thinking/dsh-max-thinking-mode"
      ]
    }
  }
}
```

### 构建工具包

```sh
pnpm install
pnpm build
```

---

## 六、使用

1. 新建任务，模式菜单选择**最大思考模式**；
2. 说明要完成什么、判断成功的证据是什么、如何检验结果（输入尽量少——该模式应自主决定探索方向）；
3. 运行。预期看到更多推理、工具调用与 token——这是设计使然，该模式就是为这个成本被选择的。

---

## 七、设计说明

- 本模式是**纯 bundle 补丁**：不改 DSH 的 agent loop、guard 或运行时；全部行为来自预设中的 persona 段落 + 一个额外工具。
- `isolated_review` 对评审者做双重隔离：子 agent 无父对话上下文；`toolFilter` 不保留任何继承工具；固定评审者 persona——评审者只依据你传入的内容推理，无法读文件、跑命令、联网或委派。
- 评审输出为结构化裁决，可机器读取；最终决定权始终在主模型。

## 八、许可证

MIT —— 见 [LICENSE](LICENSE)。工具包改编自 `@deepseek-ai/dsh-tool-isolated-review`（MIT，DeepSeek Harness 项目的一部分）。

## 相关链接

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
