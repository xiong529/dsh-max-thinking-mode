# 「深度思考引擎」设计 —— 最大思考模式 v2（认知引擎版）

> 面向 DSH 的新一代最大思考模式设计。原则：**抛却轮次 / 成本 / Token 限制**，把"思考"本身做成第一公民——外部化、结构化、可持久、可测量、可驾驭。v2 不是 v1 的提示词加长版，而是把 agent 的认知过程从"行为"升级为"工件"。

---

## 0. 一句话定位

把 agent 的思考从**被提示词邀请的行为**，变成**外部化、结构化、可持久、可驾驭的工件**：一个每次会话都存续的"思维账本"（ledger）、一套操作它的工具、一个用户可中途查看并转向的驾驶舱。深度不再依赖模型在上下文里"记得多深"，而依赖账本里"记了多少、探了多少、证了多少"。

## 1. 对 v1（deep-think）的优化清单

每一条对应 v1 的一个真实缺陷：

| v1 缺陷 | v1 现状 | v2 优化 |
|---|---|---|
| 思考易失 | 推理只在上下文窗口里，压缩即丢失 | 思维账本 durable 存储，压缩后凭摘要续思 |
| 思考不可查 | 候选 / 假设 / 证据都是对话里的散文 | 结构化账本：候选、假设、证据、死胡同、裁决、决策，可查询 |
| 突破靠运气 | "跨域类比"只是提示词建议 | reframe / bridge_domains / scout 把突破变成系统化搜索 |
| 假设靠自觉 | "验证关键假设"是一句建议 | assumption_registry + probe_plan：假设登记、依赖图、可执行实验 |
| 审思有偏 | 评审框架全由主模型撰写，单次意见 | 评审者看到全部候选 + 主模型自我疑虑；要求"什么证据能改变你的裁决"；影子计划持续对抗 |
| 收敛靠感觉 | "无重大未决反对意见"是自我判定 | converge_check 客观判定：空间覆盖 + 证据充分 + 反对意见清零（质量门，不是预算门） |
| 用户是旁观者 | 用户只能等最终答案 | 思维驾驶舱：中途查看候选树 / 假设状态 / 死胡同，并可转向 |

## 2. 思维账本（Ledger）—— 核心工件

- **位置**：会话级 durable 存储，独立于上下文窗口；压缩不影响，会话结束可回放。
- **记录类型**：
  - `framing` 问题框架（显式/隐含约束清单、成功判据）
  - `candidate` 候选方案（状态：open / active / abandoned / converged；来源：self / reframe / bridge / scout）
  - `hypothesis` 假设（状态：unverified / confirmed / refuted；置信度）
  - `experiment` 实验（probe 设计 + 结果 + 证据链接）
  - `evidence` 证据（支持/反驳某假设；来源：read / search / probe / review）
  - `dead-end` 死胡同（分支 + 放弃原因 + 教训）
  - `objection` 反对意见（状态：open / addressed / accepted-with-reason）
  - `verdict` 审思裁决（评审者 / 仲裁者输出）
  - `decision` 决策（最终选择 + 依据链接）
- **关系**：`evidence →(supports/refutes) hypothesis`；`decision →(depends-on) assumption`；`dead-end →(blocked-by) framing`。
- **API**：`record` / `query` / `link` / `summarize` / `reset`。
- **压缩抗性**：压缩后 `think_state` 返回摘要，agent 凭摘要续跑，账本不丢。

## 3. 新增工具集（10 个工具 + 1 个驾驶舱）

### 3.1 记忆层

1. **`think_ledger`** —— 账本读写：record / query / link / summarize。一切思考必须落账本，不落账本不算思考过。
2. **`think_state`** —— 只读快照：开放候选、未验证假设、空间覆盖度、未决反对意见。供 agent 自查与驾驶舱渲染。

### 3.2 空间扩张层

3. **`reframe`** —— 系统化重新定义问题：枚举隐含约束、生成约束变体（删一个 / 减半 / 加倍 / 反转 / 换角色 / 换成功判据）、登记多种问题框架。把"重新定义问题"从灵光一现变成可枚举的搜索。
4. **`bridge_domains`** —— 跨域类比引擎：提取问题的抽象"骨架"（调度？共识？搜索？分配？），检索 / 派 scout 查无关领域如何解同构问题，登记类比候选。
5. **`breakthrough_scout`** —— 停滞时派生 1–3 个"生成型"子 agent（无上下文），各自被指定一种世界观（生物学家 / 经济学家 / 攻击者 / 极简主义者 / 科幻作者）产出激进候选。与 `adversarial_review`（批评型）互补——这是**生成型**。

### 3.3 证据纪律层

6. **`probe_plan`** —— 实验设计工具：对某个假设给出最廉价的决定性实验（步骤、预期证实/证伪结果、耗时），运行后记录结果 → 证据 → 更新假设状态。"五分钟实验胜过一条未验证的长推理链"从建议变成结构。
7. **`assumption_registry`** —— 关键假设登记：状态、什么证据能改变它、依赖它的决策。假设破裂时，账本查询直接算出"什么跟着破"。

### 3.4 对抗与收敛层

8. **`adversarial_review`** —— v2 审思（替代 isolated_review）：
   - 评审者收到**全部候选 + 主模型自我疑虑 + 未决反对意见**（去除框架偏置）；
   - 每位评审者必须返回"**什么证据能改变我的裁决**"——把一次性意见变成证据请求，可循环求证；
   - `divergent` 模式：强制评审者捍卫最不受欢迎的候选；
   - `shadow_plan`：一个持续维护"最强反方计划"的子 agent，每次收敛前必询（对抗群体思维的常设砝码）；
   - 保留二轮对抗（prior_review + rebuttal）与仲裁（arbitrate），仲裁者也读自我疑虑与证据请求。
9. **`kill_checklist`** —— 失败模式清单化：对方案系统性遍历攻击面（正确性 / 安全 / 边界 / 可维护 / 扩展 / 迁移 / 体验），生成"可能怎么失败"清单及状态（已解决 / 未决）。"列出三条失败方式"变成可追踪的清单。
10. **`converge_check`** —— 客观就绪判定（质量门，不是预算门）：空间覆盖够不够、关键假设是否都有证据、反对意见是否清零、最终候选是否经过真替代对比 → 返回 `{ready, blockers}`。

### 3.5 驾驶舱（UI 面板）

11. **思维驾驶舱**（client 插件）：渲染账本状态——候选树、假设验证进度、死胡同列表、未决反对意见、覆盖度指示；支持用户中途"停掉分支 C，深入分支 D"，转向指令回流到账本。

## 4. persona：从"建议清单"到"协议状态机"

```
UNDERSTAND  → reframe 登记问题框架 / 约束 / 成功判据
HYPOTHESIZE → 枚举 ≥N 个多样候选（自己 + reframe + bridge + scout），每个登记假设
PROBE       → 对每个关键假设 probe_plan；思考与工具交替；证据回写账本
EVALUATE    → 对每个候选 kill_checklist + 多视角审视；adversarial_review（含 shadow_plan、diverge）
CONVERGE    → converge_check 全绿才收敛；否则回到最早受影响的决策点
LOOP        ← 任何证据变化触发回溯；压缩后凭 think_state 续跑
```

铁律三条：

1. **一切思考必须落账本**（分支、死胡同、假设、证据、裁决）——不落账本不算思考过；
2. **收敛以账本状态为准**，不以"感觉想完了"为准；
3. **需要用户输入时问，其余自主探索**；驾驶舱给用户中途转向的权力。

## 5. 全新之处（为什么是"创新之举"）

- **思考成为工件**：深度 = 账本里记了多少、探了多少、证了多少——可审计、可复现、可续跑；
- **思考抗压缩**：唯一一个"压缩不打断深度"的模式；
- **思考可测量**：空间覆盖度、证据充分度、未决反对意见数量变成可数的量；
- **思考可驾驭**：用户中途看到决策树并转向，不再只等最终答案；
- **审思去偏**：评审者看全部候选 + 自我疑虑 + 证据请求；影子计划对抗群体思维；
- **突破机械化**：重定义 / 跨域类比 / 约束变异从"灵光一现"变成系统化搜索。

## 6. 落地路径

1. 新包 `packages/subagent/think-ledger`：账本服务 + `think_ledger` / `think_state` 工具（durable 存储接 session）；
2. 新包 `packages/subagent/think-tools`：`reframe` / `bridge_domains` / `breakthrough_scout` / `probe_plan` / `assumption_registry` / `kill_checklist` / `converge_check`；
3. 升级 `tool-isolated-review` → `adversarial_review`（或置于 think-tools 内新建）；
4. 新 UI 包 `packages/client/ui-think-cockpit`：驾驶舱面板（槽位注册，会话事件驱动）；
5. 新预设 `packages/bundle/web-app/presets/think.patch.yml`：order 6，id `think`，名称「深度思考引擎」——与 deep-think 并存，不替换；
6. 测试：各包 REAL-composition；账本压缩续跑测试；e2e golden 第 6 卡；cookbook 扩展评估协议（新增"覆盖度 / 证据充分度"维度）；
7. 文档：双语文档 + Model Experience + Agent Note。

## 7. 诚实的边界（设计自省）

- **无预算上限 ≠ 无终止判据**：`converge_check` 是"质量门"——空间已探、证据已证、异议已清。对病理任务（无解 / 需求矛盾），账本会显示饱和（连续 N 轮证据零变化），此时停止并如实报告"已探尽，缺信息"，而不是无限烧 token；
- **工具目录变大**（standard + 10 个）→ 模型选择负担；用分组命名与 persona"阶段-工具组"映射缓解；
- **账本记录本身耗 token**——用户已豁免成本；驾驶舱渲染走会话事件，遵守 model-visible ⟺ logged；
- **与 v1 并存**：v1 已交付且有测试，v2 是新预设不是替换；评估协议对两个模式一起跑，用数据决定谁留下。

## 8. 分阶段交付建议

- M1：账本 + `think_state` / `think_ledger` + persona 状态机——先让思考"记住"；
- M2：证据纪律——`probe_plan` + `assumption_registry`；
- M3：空间扩张——`reframe` + `bridge_domains` + `breakthrough_scout`；
- M4：对抗升级——`adversarial_review` + `shadow_plan` + `kill_checklist` + `converge_check`；
- M5：驾驶舱 UI。

每阶段有可独立评估的增量，cookbook 每阶段跑一轮，用真实任务量测"覆盖度 / 证据充分度 / 突破强度"是否随阶段上升。
