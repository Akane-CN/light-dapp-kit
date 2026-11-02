# Spark Program | Light dApp Kit — 浏览器轻客户端 CCC dApp 脚手架

> 导出自 Claude Doc（https://claude.ai/artifact/FuNwpBN2oa9jMzrscCTig1），持续更新的权威版本在该链接。

Oct 28, 2026 · @Bob

## 1. 项目概述 / Project Overview

**项目名称**：Light dApp Kit

**单句概述**：一个开源脚手架 + React Hook 库，让 CCC dApp 在浏览器内直接运行官方 CKB 轻客户端（WASM），全程不依赖任何 RPC 服务端。

**项目定位**：开发者工具 / npm 包（`@light-dapp-kit/react`、`create-light-dapp`）+ 参考 dApp。

**项目类别**：Developer Tooling · Self-custody · CCC 生态。

**申请人**：\[你的 Talk 用户名\]，前端 / CCC dApp 开发者，此前通过 Spark / Catalyst 完成 \[上一个项目名称\]（结项报告：\[链接\]）。

**申请金额**：900 USD（100% CKB 支付，按立项当日中间价折算）。

**周期**：7 周。

## 2. 背景与问题 / Background

CKB 是少数把轻客户端做到浏览器 WASM 的 L1，但今天没有一个 dApp 在用它。

官方 `ckb-light-client` 已提供 `light-client-wasm` 和 npm 包 [`ckb-light-client-js`](https://www.npmjs.com/package/ckb-light-client-js)，浏览器端用 IndexedDB 持久化，类型定义直接来自 `@ckb-ccc/core`（[PR #204](https://github.com/nervosnetwork/ckb-light-client/pull/204)）。[官方文档](https://docs.nervos.org/docs/node/run-light-client-node)明确推荐 JS/TS 项目直接用这个包。

但从"能跑"到"开发者能用"之间有三道坎：

1. **没有集成范例**：目前只有一个 2025 年初的 [wasm demo](https://github.com/officeyutong/ckb-light-client-wasm-demo)，没有和 CCC 钱包连接器、交易构建流程打通的参考实现。
2. **浏览器路径仍有 bug**：2026 年 10 月社区刚修复 IndexedDB 批量写入顺序和原子性问题（[PR #299](https://github.com/nervosnetwork/ckb-light-client/pull/299)、[PR #302](https://github.com/nervosnetwork/ckb-light-client/pull/302)）——同一区块内创建又花掉的 cell 会错误恢复索引、虚增余额。没有真实 dApp 在用，这类问题只能靠核心团队自己发现。
3. **首次同步体验无人处理**：轻客户端启动要同步头链和过滤区块，这段等待时间没有现成的 UI 模式，开发者各自踩坑。

社区已经用两次投票（Pocket Node Android $15K、iOS $15K）证明"无服务器、自托管"是 CKB 最被认可的产品叙事，但 Web 端完全空白。每一个 CCC dApp 今天仍然依赖一个中心化 RPC 节点，这和 CKB 的定位相悖。

**本项目要解决的问题**：让任何 CCC 开发者在 5 分钟内创建一个不依赖 RPC 的 dApp，并把真实使用中发现的浏览器端问题反馈回 `ckb-light-client`。

## 3. 解决方案与交付物 / Deliverables

交付四样东西，全部开源（MIT），全部可在测试网复现。

| # | 交付物 | 形式 | 验收标准 |
| --- | --- | --- | --- |
| D1 | `@light-dapp-kit/react` | npm 包 | `LightClientProvider` + `useLightClient` / `useBalance` / `useLiveCells` / `useDaoDeposits` / `useSendTransaction` 五个 Hook；TypeScript 类型完整；README 含接入示例 |
| D2 | `create-light-dapp` | npm CLI | `npm create light-dapp@latest my-app` 一条命令生成 Vite + React + CCC + 轻客户端的可运行项目，含测试网/主网配置切换 |
| D3 | 参考 dApp「Light Wallet」 | 部署在 GitHub Pages 的静态页面 | 连接 CCC 钱包（JoyID / MetaMask / UniSat 等）→ 浏览器内同步 → 查余额 → 转账 → 查看 Nervos DAO 存款；全程浏览器网络面板中无任何 HTTP RPC 请求 |
| D4 | 《浏览器轻客户端集成指南与已知问题》 | 文档 + 上游 issue | 一份面向开发者的集成指南；开发中发现的 bug 以 issue / PR 形式提交到 `nervosnetwork/ckb-light-client`，附复现步骤 |

**明确不做的事**（控制范围）：不做移动端、不做浏览器扩展、不实现任何新的链上脚本、不做主网资产托管产品。这些是 Post-Spark 阶段的内容（见第 10 节）。

**与现有项目的关系**：

- 与 **CCC** 互补：所有交易构建、签名走 CCC；本项目只替换「数据来源」——把 `ccc.ClientPublicTestnet` 的 RPC 后端换成浏览器内的轻客户端。
- 与 **Cell Sandbox**（Spark 已批）不重叠：Cell Sandbox 是教学可视化工具，本项目是生产脚手架。
- 与 **Pocket Node**（DAO 已批）互补：Pocket Node 覆盖 Android / iOS，本项目覆盖 Web。

## 4. 里程碑与时间表 / Milestones

每个里程碑在 Nervos Talk 本帖下发 \[Status Update\]，附可运行的 commit hash。

&#91;embedded content: 里程碑时间线 · 7 周 · 4 个里程碑\]

M1 是去风险关口：如果 2 周内无法在 Chrome 中完成测试网同步并查到余额，提前告知委员会并调整范围。

| 里程碑 | 周 | 交付内容 | 验收方式 |
| --- | --- | --- | --- |
| M1 技术验证 | W1–W2 | `ckb-light-client-js` 在 Vite 项目中跑通测试网同步；记录首次同步耗时、IndexedDB 占用；列出遇到的上游问题 | Talk 帖子 + 截图 + 可复现仓库 |
| M2 Hook 库 + CLI | W3–W4 | `@light-dapp-kit/react` 五个 Hook 发布到 npm（0.1.x）；`create-light-dapp` 可生成项目 | `npm create light-dapp` 一条命令生成并运行 |
| M3 参考 dApp + 文档 | W5–W6 | Light Wallet 部署到 GitHub Pages；集成指南初稿；上游 issue 提交 | 在线地址 + 无 RPC 请求的网络面板录屏 |
| M4 社区测试 + 修复 | W7 | 招募 3–5 名 CKB 开发者试用，收集反馈，修复阻塞问题 | 反馈汇总帖 + 修复 commit |
| 结项 | W7 末 | 结项报告 | 按 Spark 模板提交 |

## 5. 预算与资金用途 / Budget

申请 **900 USD**，100% CKB 支付，按立项当日 CKB/USD 中间价折算。技术部分 760 USD，社区部分 140 USD，分开列出便于分项验收。

| 类别 | 项目 | 金额 (USD) | 对应里程碑 |
| --- | --- | --- | --- |
| 技术 | 轻客户端集成与 Hook 库开发（含上游问题排查） | 380 | M1, M2 |
| 技术 | CLI 脚手架与模板 | 150 | M2 |
| 技术 | 参考 dApp 开发与部署 | 180 | M3 |
| 技术 | AI 工具费用（代码生成、文档翻译；按发票列支） | 50 | 全程 |
| 社区 | 开发者试用激励（3–5 人 × 约 20 USD CKB，须提交书面反馈） | 90 | M4 |
| 社区 | 文档、集成指南与 Showcase 演示 | 50 | M3, M4 |
| **合计** |  | **900** |  |

**付款建议**：立项 20% → M2 完成 40% → 结项 40%。若 M1 验证失败，仅保留首笔 20% 作为验证工作报酬，其余退回 Spark 主钱包。

**说明**：按 AI 时代的工作量估算（见委员会与 janx 在 2025 年报告帖下的讨论），本项目的核心成本不在编码时长，而在验证与上游问题排查，预算据此分配。

## 6. How to Verify / 如何验证

任何社区成员用一台普通电脑、15 分钟、零成本即可完成全部验收，不需要读代码。下面的验证 A/B/C 现已实现为 Playwright e2e（`no-rpc.spec.ts`、`connector.spec.ts`、`wallet.spec.ts`），每次推送在 CI 上重跑。

**验证 A：脚手架（对应 D2）**

1. `npm create light-dapp@latest verify-app` → `cd verify-app && npm install && npm run dev`
2. 浏览器打开 `http://localhost:5173`，看到「正在同步」进度条，等待至「已同步」。
3. 预期：同步完成后页面显示当前测试网区块高度，且与 [testnet explorer](https://testnet.explorer.nervos.org) 一致（允许落后 ≤ 3 个区块）。

**验证 B：无 RPC（对应 D1、D3）**

1. 打开在线 demo [Light Wallet](https://占位.github.io/light-wallet)（结项时填入实际地址）。
2. 打开浏览器 DevTools → Network 面板，筛选 `Fetch/XHR`。
3. 连接 CCC 钱包，向测试网 faucet 地址领取 CKB，刷新余额。
4. 预期：Network 面板中**没有任何**发往 `*.nervos.org` / `*.ckb.dev` 或其他 JSON-RPC 端点的 HTTP 请求；只有 `wss://` 的 P2P 连接。

**验证 C：发交易（对应 D1）**

1. 在 demo 中向任意地址转 100 CKB，用钱包签名。
2. 预期：页面返回 tx hash，1–2 个区块后余额更新；在 explorer 中可查到该交易。结项报告将附至少 3 笔由验证者发出的 tx hash。

**验证 D：上游反馈（对应 D4）**

- 结项报告列出提交到 `nervosnetwork/ckb-light-client` 的 issue / PR 链接，每条附复现步骤；委员会可直接在 GitHub 核对。

**自动化**：仓库 CI 在每次 push 时用 Playwright 跑验证 A 和 B（headless Chrome 对测试网同步，断言零 HTTP RPC 请求）；main 分支每次 push 还会用私钥 signer 跑验证 C：在测试网真实发一笔 100 CKB 转账并等到 committed，同样断言零 RPC。连接器路径由 `connector.spec.ts` 覆盖（注入 EIP-6963 钱包走真实连接器，推导 Omnilock 地址并 personal_sign）。CI 徽章放在 README；完整的验证速查见仓库 `docs/how-to-verify.md`。

**CI 实测数字**（headless Chromium，测试网）：

| 指标 | 值 |
| --- | --- |
| 头同步到链顶 | 65–90 s，6–8 peers |
| 余额页 ready（给定起始块） | 135–195 s |
| 发送 pending → committed | 32–64 s（约 23 s 为网络打包） |
| cell 过滤器扫描吞吐 | 约 600 块/秒 |

自转账真实上链，近期 CI 例如 `0x8cd41552aabc6f3db857dbab68a2145e37360b22bcd32a4f3a3266003a427563`、`0xe486aba100859146478a1992c0cede698b6483da3f925f01a0abbcbf8a7e1726`（pudge.explorer.nervos.org 可查）。

**和 ckb-verify 同一方法论**：验收不是文字而是可重跑的证据——这与申请人的 ckb-verify 项目是同一套做法；能在 OffCKB devnet 上表达的部分（如 `useDaoDeposits` 对 DAO cell 数据的解析）会用 `verify.toml` 以同一证据格式声明。

需要如实说明的是：目前**超出的是工程深度，尚未完全覆盖的是原承诺范围**。已实现并由 CI 可重跑验证的是 A/B/C（零 RPC 同步、连接器路径、真实转账），另外还做了原计划未列的工程（失败退避自愈、轻客户端懒加载、按网络绑定基类、watch 对账不重扫、`watchFromDate` 原型）；但验证 D（上游 issue/PR）目前为零，npm 发布、主网只读验证、Pages 上线仍是待交付项。这些留到结项报告逐项给出，不作“已全面超额交付”的表述。

## 7. CKB 契合度 / Web5 契合度

本项目直接命中 Spark 2026 技术展望中的 CCC 方向，并服务于 Web5「数据主权」的前提：用户自己验证链上状态。

- **CCC**：所有钱包连接、交易构建、签名都通过 `@ckb-ccc/core` 和 `@ckb-ccc/connector-react`，本项目只提供一个可替换的 `Client` 实现。做完后会向 CCC 仓库提 PR，讨论把轻客户端作为官方 `Client` 选项之一。
- **自托管叙事**：Pocket Node 两次获 DAO 资助证明社区重视「不依赖远程 RPC」。本项目把同一能力带到 Web，且不与 Pocket Node 竞争。
- **只支持 CKB L1**：不涉及其他链，符合社区基金「仅支持 CKB Layer 1」的范围。
- **公共知识沉淀**：结项后仓库 fork 到 Spark-Program GitHub 组织，集成指南和上游 issue 成为后来者的参考。
- **小而真实**：不发币、不做金融产品、不画大饼；7 周内交付一个开发者当天就能用的工具。

## 8. AI 使用披露 / AI Disclosure

按委员会在 2025 年报告帖中建议的「披露 + 边界控制」原则：

| 模块 | AI 参与程度 | 人工保证 |
| --- | --- | --- |
| 脚手架模板、UI 组件、文档初稿、中英翻译 | 高（Claude / Copilot 生成初稿） | 人工审阅、运行、修改 |
| Hook 库核心逻辑（同步状态、cell 查询、与 CCC 的 Client 适配） | 中（AI 辅助编写，人工设计接口） | 单元测试 + 浏览器集成测试全部人工验证 |
| 交易构建与签名流程 | 低 | 完全走 CCC 既有 API，不自行实现签名；每一笔测试交易人工核对 |
| 上游 bug 复现与 issue 报告 | 低 | 人工复现、人工撰写 |

不涉及任何新的链上脚本（lock / type），因此没有需要审计的链上代码。AI 工具费用在预算中单列（50 USD）。

## 9. 风险与应对 / Risks

| 风险 | 可能性 | 应对 |
| --- | --- | --- |
| 浏览器端轻客户端在测试网同步不稳定或耗时过长（首次同步可能需数分钟） | 中 | M1 专门测量并记录；UI 上做清晰的进度提示和「后台同步」模式；无法接受时如实报告并缩减范围 |
| `ckb-light-client-js` 上游 API 变动或遇到阻塞性 bug | 中 | 锁定版本；bug 提 issue 并在本仓库打补丁；与核心团队（@quake、@Officeyutong 等）在 Talk / GitHub 沟通 |
| Safari / 移动浏览器对 IndexedDB 与 Worker 支持差异 | 高 | Spark 阶段只承诺 Chrome / Firefox 桌面；Safari 列为已知限制 |
| 开发者试用招募不足 | 低 | 提前在 Talk 和 CKB 开发者群招募；用 Showcase 演示吸引试用；不足 3 人则延长 M4 一周 |
| 跨域隔离（`SharedArrayBuffer` 所需）与弹窗钱包冲突：`COOP: same-origin` 下 JoyID 弹窗丢失 opener，报 "Popup closed" | 已发生（预研实测） | Chromium 137+ 改用 `Document-Isolation-Policy`，实测轻客户端与 JoyID 同时可用，是目前唯一同时满足两者的方案；其他浏览器回退 COOP/COEP，JoyID 在其上列为已知限制，扩展钱包不受影响 |
| 申请人同时在途的另一个资助项目分散精力 | — | 本提案在该项目结项报告提交后才正式启动，不重叠 |

## 10. Post-Spark 路径 / After Spark

Spark 阶段验证「浏览器轻客户端 dApp 能用」；验证成功后，向 CKB Community Fund DAO 申请 Phase 2（预估 10,000–15,000 USD，不在本提案范围内）。

候选方向（结项时根据试用反馈二选一）：

1. **Light Wallet 浏览器扩展**：把参考 dApp 做成 Chrome / Firefox 扩展，提供自托管钱包 + CCC 兼容的 dApp 签名器，对标 Pocket Node iOS 的「Identity / Signer」定位。
2. **CCC 官方轻客户端 Client**：与 CCC 维护者合作，把 `LightClient` 作为 `@ckb-ccc/core` 内置 Client 之一，并补齐 Safari / 移动浏览器支持。

无论哪条路，Spark 阶段的结项报告、试用反馈和上游 PR 记录将作为 DAO 提案的信用基础。

## 11. 开源许可、仓库与联系方式

- **许可**：MIT。
- **仓库**：`github.com/[你的 GitHub]/light-dapp-kit`（monorepo：`packages/react`、`packages/create-light-dapp`、`apps/light-wallet`、`docs/`）；结项后 fork 到 `github.com/Spark-Program`。
- **进度更新**：每个里程碑在本帖回复 \[Status Update\]；代码每周至少一次 push。
- **收款地址**：`ckb1...`（立项后提供多签或个人地址）。
- **联系**：Nervos Talk @\[你的用户名\]；GitHub @\[你的 GitHub\]；Discord \[你的 ID\]。

---

*设计文档（架构、API、状态机、测试策略）另见：[Light dApp Kit 设计文档](https://claude.ai/artifact/MXiheaJZovSEQ1UfCBgj2b)。*
