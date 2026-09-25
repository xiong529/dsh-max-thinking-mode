# dsh-max-thinking-mode

**最大思考模式（Max Thinking mode）**—— 为 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 提供的一个可选 Agent 预设，面向没有现成答案的问题：新功能、没见过的新设计、尚未实现过的方案。

该模式挂载标准模式的完整工具集，并额外提供两样东西：

1. **一段 persona 前缀**，把分支-回溯式推理写进工作策略——先产生多个候选方案、把每个方案向前推演、用证据而不是猜测验证假设、从六个视角审视每个候选、扮演自己方案的反对者、方向失败就自由回退，直到某个候选通过全部审视且关键假设有证据支撑才收敛；
2. **`isolated_review` 工具**——把方案交给一个或多个没有工具、没有文件、没有网络、没有对话历史的全新子 agent，让它们从不同角度重新思考并尝试反驳，返回结构化裁决。支持 2–3 位并行交叉验证、第二轮对抗（`prior_review` + `submitter_rebuttal`）、以及终审仲裁（`arbitrate`）。

> **这个模式解决什么问题**：困难、方向不明、第一直觉容易出错的任务。日常、熟路的任务请用标准模式——更快、更省。
>
> **实测结论**：用五个真实任务与标准模式对比，最大思考模式**在突破强度维度上五战全胜**（五场累计独立突破点 26 vs 17），代价约为标准模式的 1.3–2 倍 token。详见 [docs/evaluation-results.md](docs/evaluation-results.md)。

---

## 安装

本仓库是一个普通 Cordis bundle：一条 `@deepseek-ai/dsh-agent-preset` 声明 + 自包含的 `isolated_review` 工具包。可以通过 DSH 插件管理器安装到某个 profile，或在 profile 的 `cordis.patch.yml` 中声明。

### 前置条件

- 已安装 DeepSeek Harness 的 web 应用（`@deepseek-ai/dsh-web-app`）——它提供 `dsh-agent-preset` 注册表与本预设组合所依赖的标准工具集；
- 构建工具包需要 Node.js `^22.19 || >=24` 与 `pnpm`。

### 方式 A —— 通过插件管理器安装（推荐）

在 DSH Web UI 的**插件**页（或通过 `plugin_manager` API），把本仓库作为 bundle 安装：

```
plugin_manager install_bundle --target <本仓库路径>
```

bundle 声明了 `preset-max-thinking` 行。安装后，**最大思考模式**会出现在新任务模式菜单与 Agent 预设设置名录中。

### 方式 B —— 在 profile 中声明本 bundle

在 `$DSH_HOME/profiles/<name>/package.json` 中加入本仓库：

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

`isolated_review` 工具以源码形式随仓库分发（`packages/tool-isolated-review`）。构建运行时产物：

```sh
pnpm install
pnpm build
```

---

## 使用方式

1. 在 Web GUI 新建任务，模式菜单选择**最大思考模式**；
2. 说明要完成什么、判断成功的证据是什么、如何检验结果。输入尽量少——该模式本应自主决定探索方向；
3. 预期会看到比标准模式更多的推理、工具调用和 token——这是设计使然，该模式就是为这个成本被选择的。

persona 把这些行为写得明确且可观测：

- **与外界一起思考，而不是只在脑子里想**：不知道怎么做时先检索资料（web 搜索、读源码、查文档）再决定是否从零发明；关键假设用最小可运行原型验证；思考与廉价工具探测交替进行；
- **跳出框架找突破**：重新定义问题、跨领域借思路、刻意改变约束、同时保留多个候选框架，以方案强度而非代码整洁度评判成功；
- **多视角审视**：用户、实现者、架构师、失败与边界、测试、成本——说明每个视角的偏见，并把各视角放在一起权衡；
- **对抗性自我攻击**：动手前至少列出三条"它可能怎么失败"；
- **隔离审思**（`isolated_review`）：重要决策前把方案交给无工具评审者从不同角度反驳；最终决定权始终在主模型；
- **先问再猜**：模糊需求用 `ask_user_question` 确认，而不是静默选择一种解读；
- **自由回退**：证据变化就回到最早的决策点换一条路；保留探索足迹，回退不重复踩死胡同。

---

## 目录结构

```
presets/max-thinking.patch.yml      Agent 预设声明（persona + 标准工具集 + isolated_review）
packages/tool-isolated-review/      isolated_review 工具（自包含 Cordis 插件包）
docs/evaluation-results.md          五任务实测：最大思考 vs 标准模式
docs/evaluating-agent-preset-modes.zh.md  使用的评估协议
docs/max-thinking-engine-design.md  下一代「思考引擎」版本的设计草案
```

## 设计说明

本模式只是一个 bundle 补丁：不改 agent loop、guard 或运行时。全部行为来自预设中 `dsh-persona` 行贡献的 persona 段落，外加一个工具。能力与权限语义与标准模式一致。

- `isolated_review` 工具对评审者做双重隔离：全新上下文提供方隐藏父对话；`toolFilter` 不保留任何继承工具，加上固定评审者 persona，评审者的提示词里只有传入的上下文；
- 结构化裁决（`sound-as-is` / `sound-with-changes` / `different-approach` + 反对意见 + 最强弱点）让评审输出可机器读取、难以敷衍。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。工具包改编自 `@deepseek-ai/dsh-tool-isolated-review`（MIT，DeepSeek Harness 项目的一部分）。

## 相关链接

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- Agent 预设（官方仓库）→ `packages/bundle/web-app/presets/`（`standard`/`ptc`/`minimal`/`cordis`/`deep-think`）
