# Light dApp Kit 设计文档

> 导出自 Claude Doc（https://claude.ai/artifact/MXiheaJZovSEQ1UfCBgj2b），持续更新的权威版本在该链接。
>
> 这是提案阶段的设计文档。实现过程中有几处演进，以代码与下列文档为准：客户端按网络绑定 CCC 基类（mixin + `createLightClientCccClient`，非单一 `extends ccc.Client`）；`ckb-light-client-js` 不提供按块号取头的接口，故 `watchFromDate` 用 genesis↔tip 插值估算而非二分；`coi-serviceworker.js` 现已在 Chromium 137+ 注入 `Document-Isolation-Policy`。迁移步骤、浏览器支持矩阵、可重跑的验证见 `docs/integration-guide.md` 与 `docs/how-to-verify.md`。

Oct 28, 2026 · @Bob

## 1. 目标与非目标

Light dApp Kit 让一个 CCC dApp 用浏览器内的 CKB 轻客户端替代远程 RPC，开发者改动不超过 10 行代码。

**目标**

- 提供 `LightClientProvider`，把 `ckb-light-client-js` 封装成 CCC 可识别的 `Client`，现有 `ccc.Signer` / 交易构建代码零改动。
- 提供五个 React Hook：`useLightClient`、`useBalance`、`useLiveCells`、`useDaoDeposits`、`useSendTransaction`。
- 提供 `create-light-dapp` CLI，一条命令生成可运行项目。
- 同步状态对用户可见、可控（暂停 / 继续 / 重置本地数据）。
- 桌面 Chrome 和 Firefox 在测试网和主网可用。

**非目标（Spark 阶段）**

- 不实现签名或密钥管理；签名全部交给 CCC 连接的钱包。
- 不做浏览器扩展、移动端、Safari 兼容。
- 不实现 xUDT / Spore 等资产类型的专用 Hook（只保证通用 cell 查询能覆盖它们）。
- 不修改 `ckb-light-client` 上游代码，只打补丁和提 issue。
- 不做服务端组件；仓库里没有任何需要部署的后端。

## 2. 整体架构

本项目只新写两层：Hook 库和 CCC 适配器。轻客户端本身、IndexedDB 持久化和钱包签名都用已有组件。

&#91;embedded content: 整体架构 · 6 层 · 2 个新写组件\]

读数据自上而下走左侧主链路；dApp 要签名时，Hook 把未签名交易交给 CCC Signer，签完后再由适配器通过轻客户端 P2P 广播。整条链路没有 HTTP JSON-RPC。

**关键设计决定**

| 决定 | 选择 | 理由 |
| --- | --- | --- |
| 和 CCC 的集成点 | 实现 `ccc.Client` 接口，而不是重写交易构建 | 开发者现有代码和所有 CCC 钱包连接器零改动；未来可直接向 CCC 提 PR |
| WASM 运行位置 | Web Worker | 同步计算不阻塞 UI 线程；上游 wasm 包本身面向 worker 设计 |
| 状态管理 | React Context + 轻量订阅，不引入 Redux / Zustand | 减少依赖；开发者用自己的状态库不冲突 |
| JS 层的 cell 索引 | 完全依赖轻客户端自带的 `set_scripts` 过滤 + `get_cells` | 不在 JS 层再做一套索引，避免两套状态不一致 |
| 错误处理 | 所有 Hook 返回 `{ data, error, status }`，不抛异常 | 同步中的“暂时没数据”和真正的错误要分开展示 |

## 3. 仓库与包结构

Bun workspaces monorepo，三个可发布包加一个参考应用；所有包共用一套 tsconfig、eslint 和 changeset 发版流程。包管理和脚本运行用 Bun；构建用 Vite，因为 Vite 是前端打包器，Bun 的 bundler 目前不处理 Web Worker 和 WASM 资源的 HTML 集成，这两样正是本项目的核心。开发者在生成的项目里用 npm 或 pnpm 也可以，模板不绑定 Bun。

```
light-dapp-kit/
├─ packages/
│  ├─ core/                 # @light-dapp-kit/core —— 框架无关
│  │  ├─ src/client.ts      # LightClientCccClient：实现 ccc.Client
│  │  ├─ src/worker.ts      # 启动 wasm worker + db worker，暴露 RPC 同构 API
│  │  ├─ src/sync.ts        # 同步状态机（见第 5 节）
│  │  └─ src/config.ts      # 网络配置：mainnet / testnet 的 bootnodes、chain spec
│  ├─ react/                # @light-dapp-kit/react —— 依赖 core + @ckb-ccc/connector-react
│  │  ├─ src/provider.tsx   # LightClientProvider
│  │  ├─ src/hooks/         # useLightClient / useBalance / useLiveCells / useDaoDeposits / useSendTransaction
│  │  └─ src/ui/            # SyncStatus 组件（可选引入）
│  └─ create-light-dapp/    # CLI：复制 templates/ 并替换占位符
│     └─ templates/vite-react/
├─ apps/
│  └─ light-wallet/         # 参考 dApp，部署到 GitHub Pages
├─ docs/                    # 集成指南、已知问题、上游 issue 清单
└─ e2e/                     # Playwright：同步 + 无 RPC 断言
```

| 包 | 发布到 | 依赖 | 说明 |
| --- | --- | --- | --- |
| `@light-dapp-kit/core` | npm | `ckb-light-client-js`、`@ckb-ccc/core` | Vue / Svelte 用户也能用 |
| `@light-dapp-kit/react` | npm | `core`、`react ≥18`、`@ckb-ccc/connector-react` | 主要交付物 |
| `create-light-dapp` | npm | 无运行时依赖 | `npm create light-dapp` 入口 |
| `light-wallet` | GitHub Pages | `react` 包 | 验收用 demo |

把框架无关逻辑放进 `core` 是为了后续向 CCC 提 PR 时能直接搬过去。

## 4. 核心 API 设计

开发者接入的最小改动：把 `ccc.ClientPublicTestnet` 换成 `LightClientProvider`，其余代码不变。

```tsx
// main.tsx —— 之前
<ccc.Provider defaultClient={new ccc.ClientPublicTestnet()}>
  <App />
</ccc.Provider>

// main.tsx —— 之后
<LightClientProvider network="testnet">
  <App />
</LightClientProvider>
```

`LightClientProvider` 内部创建 `LightClientCccClient`，并把它作为 `defaultClient` 传给 `ccc.Provider`，所以 `ccc.useCcc()`、`signer.sendTransaction()` 等全部照常工作。

**LightClientCccClient（core）**

```ts
class LightClientCccClient extends ccc.Client {
  constructor(opts: { network: 'mainnet' | 'testnet'; dbName?: string; bootnodes?: string[] })
  // ccc.Client 要求的方法，全部转发到 ckb-light-client-js：
  getTip(), getHeaderByNumber(), getTransaction(), getCellsPaged(), findCells(), sendTransaction() …
  // 轻客户端特有：
  watch(script: ccc.Script, fromBlock?: bigint): Promise<void>   // set_scripts
  unwatch(script: ccc.Script): Promise<void>
  syncState(): SyncState                                         // 见第 5 节
  onSyncState(cb: (s: SyncState) => void): () => void
  reset(): Promise<void>                                          // 清空 IndexedDB
}
```

**Hook（react）**

| Hook | 签名 | 返回 | 说明 |
| --- | --- | --- | --- |
| `useLightClient()` | `()` | `{ client, sync: SyncState, pause(), resume(), reset() }` | 同步状态与控制；`SyncStatus` 组件基于它 |
| `useBalance(address?)` | `(addr?: string)` | `{ data: bigint \| undefined, status, error }` | 默认取当前 Signer 地址；自动 `watch` 其 lock script |
| `useLiveCells(filter)` | `({ lock?, type?, withData? })` | `{ data: ccc.Cell[], status, error, hasMore, loadMore() }` | 分页封装 `getCellsPaged` |
| `useDaoDeposits(address?)` | `(addr?: string)` | `{ data: DaoCell[], status, error }` | 过滤 DAO type script 的 cell，附存款高度与可提取高度 |
| `useSendTransaction()` | `()` | `{ send(tx: ccc.Transaction): Promise<Hex>, status, error, txHash }` | 走 Signer 签名 → `client.sendTransaction` P2P 广播 |

`status` 取值统一为 `idle` / `syncing` / `ready` / `error`。`syncing` 时 `data` 可能是上次缓存值，由 UI 决定是否显示陈旧标记。

**自动 watch 规则**：Hook 首次拿到地址时调用 `client.watch(lock, tipHeight - 1000)`，默认只回溯最近 1,000 个区块以缩短首次同步；开发者可通过 `LightClientProvider` 的 `watchFrom` 覆盖（`0` 表示全量）。

## 5. 同步生命周期与状态机

轻客户端的同步分两段：先追平头链（不依赖 watch 列表），再按 watch 的脚本拉过滤块。UI 必须区分这两段，否则用户看到的“进度 100%”与余额为 0 会同时出现。

&#91;embedded content: 同步状态机 · 7 个状态\]

主链路从左到右；`ready` 之后每个新区块或新增 watch 都回到 `syncing-cells` 短暂处理后返回；pause / resume 只在同步中和 ready 之间切换；任何阶段的异常进入 `error`，只能通过 `reset()` 回到 `idle`。

**SyncState 结构**

```ts
type SyncState = {
  phase: 'idle' | 'booting' | 'syncing-headers' | 'syncing-cells' | 'ready' | 'paused' | 'error'
  headerTip: bigint        // 本地已验证的最高头
  networkTip: bigint       // peer 报告的链头（用于进度条）
  cellTip: bigint          // watch 脚本已扫描到的高度
  peers: number
  startedAt: number        // 用于估算剩余时间
  error?: { code: string; message: string; retryable: boolean }
}
```

**首次同步体验**（M1 要实测的数字）：头链同步用 FlyClient 采样，预期在分钟级；过滤块同步时长与 `watchFrom` 回溯深度成正比，所以默认只回溯 1,000 块。实际耗时在 M1 报告中给出，并写进集成指南。

**Tab 关闭 / 刷新**：worker 随页面销毁；IndexedDB 保留头链和已扫 cell，下次打开从 `headerTip` 继续。多个 Tab 同时打开同一 dApp 时，用 `navigator.locks` 保证只有一个 Tab 在写 IndexedDB，其他 Tab 只读并显示“另一个标签页正在同步”。

## 6. 交易构建与广播路径

一笔转账的每一步都在浏览器内完成，唯一出网的是 P2P 广播。

1. dApp 调 `ccc.Transaction.from({...})` 构建骨架，再 `tx.completeInputsByCapacity(signer)` —— CCC 内部通过 `client.findCells()` 选 input，这里被转发到轻客户端的 `get_cells`，读的是本地 IndexedDB。
2. `tx.completeFeeBy(signer)` 同样走本地 cell 数据估算手续费。
3. `signer.signTransaction(tx)` —— 交给 CCC 连接的钱包（JoyID 弹窗、MetaMask 等），本项目不碰私钥。
4. `client.sendTransaction(signedTx)` → `ckb-light-client-js` 的 `send_transaction` → 轻客户端把交易推给已连接的 peer。
5. 轻客户端返回 tx hash；Hook 进入 `pending`，并用 `fetch_transaction` 轮询状态直到被打包。

**与 RPC 模式的差异，需要在文档里明确告知开发者：**

| 行为 | RPC 模式 | 轻客户端模式 |
| --- | --- | --- |
| 交易是否进入 mempool 的反馈 | 立即（节点返回错误） | 延迟：peer 拒绝不会同步回传，需等 `fetch_transaction` 结果 |
| 未被 watch 的地址的 cell | 可查 | 查不到，`findCells` 返回空；Hook 层会先自动 `watch` 再查 |
| 交易所依赖的 cell dep（如 secp256k1 lock） | 节点自带 | 轻客户端自带 chain spec 中的系统 cell，自定义脚本需开发者显式 `watch` 其 type script |
| 手续费估算 | `estimate_cycles` RPC | 不可用，用固定费率（默认 1000 shannon/KB）+ 上浮 |

`useSendTransaction` 会在发送前检查 `sync.phase === 'ready'`，否则返回 `error.code = 'NOT_SYNCED'`，避免用过期 cell 构建交易导致双花失败。

## 7. 持久化与存储

全部状态在 IndexedDB，由上游 `light-client-db-worker` 管理；本项目只在其外层加一个小的元数据表。

| 存储 | 所有者 | 内容 | 本项目的处理 |
| --- | --- | --- | --- |
| `ckb-light-client-<network>`（IndexedDB） | 上游 db-worker | 头链、MMR、过滤块、已匹配 cell、交易 | 不直接读写；通过 js API 访问 |
| `light-dapp-kit-meta`（IndexedDB） | 本项目 | watch 列表及各自 `fromBlock`、上游包版本号、schema 版本 | 页面加载时用它重新注册 `set_scripts`，并判断是否需要迁移 |
| `localStorage` | 本项目 | 用户偏好：是否后台同步、是否显示陈旧数据标记 | 可选 |

**脚本订阅（watch）**：轻客户端的 `set_scripts` 是全量覆盖语义，不是增量。所以 Hook 层维护一份 watch 列表，每次增删都重新提交完整列表；`fromBlock` 取列表中最小值以免漏块。

**数据迁移**：上游 db schema 变动（PR #299 就改过写入方式）时，`light-dapp-kit-meta.upstreamVersion` 与当前包版本不一致 → 提示用户「需要重新同步」并调用 `reset()`。不尝试做跨版本迁移，这是 Spark 阶段明确的取舍。

**容量**：测试网 1,000 块回溯 + 头链的 IndexedDB 占用将在 M1 实测；超过 100 MB 时在 UI 提示。Chrome 默认配额按磁盘比例给，一般足够。

**隐私**：IndexedDB 按 origin 隔离，不同 dApp 各自同步，互不可见。文档会说明这意味着同一用户开 3 个 dApp 会同步 3 份头链，这是浏览器安全模型的代价。

## 8. 脚手架 CLI 与模板生成

`bun create light-dapp my-app`（或 `npm create light-dapp@latest my-app`）在 30 秒内生成一个可运行项目，不依赖网络下载模板。

**交互**（都有命令行参数可跳过）：

1. 项目名
2. 网络：`testnet`（默认）/ `mainnet`
3. 是否包含 Nervos DAO 示例页（默认是）
4. 包管理器：bun（默认，若检测到 \`bun\` 可执行）/ pnpm / npm / yarn，按调用方式自动检测

**生成内容**：

```
my-app/
├─ src/
│  ├─ main.tsx            # LightClientProvider + ccc connector
│  ├─ App.tsx             # 路由：Balance / Send / Dao
│  ├─ pages/Balance.tsx   # useBalance + SyncStatus
│  ├─ pages/Send.tsx      # useSendTransaction
│  └─ pages/Dao.tsx       # useDaoDeposits（可选）
├─ vite.config.ts         # 已配置 wasm 与 worker 的 asset 处理
├─ .github/workflows/pages.yml  # 一键部署到 GitHub Pages
└─ README.md              # 含「如何验证无 RPC」一节
```

**部署的坑**（看过 `ckb-light-client-js@1.0.3` 源码后更正）：两个 worker 已被 esbuild inline 打包进 `dist/index.js`，Vite 不需要 static-copy；真正的坑是它用 `SharedArrayBuffer`，页面必须 cross-origin isolated（`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`）。Vite dev / preview 在 `vite.config.ts` 里设头；GitHub Pages 不能设自定义头，模板用 `coi-serviceworker`（MIT，约 2 KB）在首次加载时注入。另外它锁定依赖 `@ckb-ccc/core@0.1.0-alpha.6`，与当前 1.23 会双版本共存，所以 `core` 包里所有返回值都经过一次类型转换，不直接把它的类型暴露给上层。

模板内嵌在 CLI 包里（`templates/vite-react/`），用占位符 `__APP_NAME__`、`__NETWORK__` 替换，不做复杂模板引擎。

## 9. 参考 demo 页面和组件

Light Wallet 是验收用的最小 dApp，三页加一个常驻状态条，刻意不做成完整钱包产品。

| 页面 / 组件 | 用到的 Hook | 展示内容 | 验收点 |
| --- | --- | --- | --- |
| `SyncStatus`（顶部常驻） | `useLightClient` | 阶段、本地高度 / 网络高度、peer 数、暂停 / 继续、重置 | 同步阶段可见；重置后能重新同步 |
| Balance | `useBalance`、`useLiveCells` | 当前地址余额、live cell 列表（capacity、是否有 data / type） | 与 explorer 数字一致 |
| Send | `useSendTransaction` | 收款地址、金额、费率；发送后显示 tx hash 和确认状态 | tx 在 explorer 可查 |
| Dao | `useDaoDeposits` | 每笔 DAO 存款的金额、存入高度、距下一个可提取周期的块数 | 有存款的测试地址能正确列出 |

**连接钱包**：用 `@ckb-ccc/connector-react` 自带的选择器，不定制。JoyID 在测试网最稳定，作为文档中的默认示例。

**「无 RPC」可视化**：页面右下角有一个小面板，展示本会话发出的网络请求计数——WebSocket P2P 连接数和 HTTP 请求数（通过 `PerformanceObserver` 统计），HTTP 应始终为 0（静态资源除外）。这是给验证者看的，比让他们自己开 DevTools 更直观。

**部署**：`apps/light-wallet` 由 GitHub Actions 构建后发布到 GitHub Pages；主网 / 测试网通过 URL 参数 `?network=mainnet` 切换，默认测试网。

## 10. 测试与验证策略

测试重点不是覆盖率，而是让委员会和社区能用 CI 徽章和一条命令确认「它真的不依赖 RPC」。

| 层 | 工具 | 测什么 | 何时跑 |
| --- | --- | --- | --- |
| 单元 | Vitest | 状态机转换、watch 列表合并、`fromBlock` 计算、`SyncState` 派生字段 | 每次 push |
| 适配器契约 | Vitest + mock 的 `ckb-light-client-js` | `LightClientCccClient` 每个方法的参数转换和返回类型与 `ccc.Client` 一致 | 每次 push |
| 浏览器集成 | Playwright（headless Chrome） | 真实连接测试网：同步到 ready、查到 faucet 地址余额、断言 0 个 HTTP JSON-RPC 请求 | 每次 push，允许 10 分钟超时 |
| 浏览器集成 | Playwright（Firefox） | 同上 | 每日定时 |
| 端到端交易 | 手动 + 脚本 | 用测试网私钥发一笔转账，确认上链 | 每个里程碑 |
| 脚手架 | CI 脚本 | `npm create light-dapp` → `npm run build` 成功 | 每次 push |

**无 RPC 断言的实现**：Playwright 的 `page.route('**/*', ...)` 记录所有请求；测试结束时断言不存在 `method: POST` 且 `content-type: application/json` 的请求指向非本地 origin。WebSocket 不经过 `route`，单独通过 `page.on('websocket')` 记录并要求至少 1 个连接。

**上游 bug 的回归测试**：每个提交到 `ckb-light-client` 的 issue，在 `e2e/upstream/` 下有一个对应的复现测试，标注 `skip` 直到上游修复发布，之后转为常规回归。这让结项报告中的「上游反馈」可被机器验证。

## 11. 已知限制、上游依赖与风险

最大的不确定性是上游 WASM 路径的稳定性，M1 的目的就是把它量化。

**上游依赖**

| 依赖 | 版本策略 | 说明 |
| --- | --- | --- |
| [`ckb-light-client-js`](https://www.npmjs.com/package/ckb-light-client-js) | 锁定到 M1 验证通过的版本 | 2026 年 10 月仍有浏览器端写入原子性修复在合并（[PR #299](https://github.com/nervosnetwork/ckb-light-client/pull/299)、[PR #302](https://github.com/nervosnetwork/ckb-light-client/pull/302)）；需跟踪发布 |
| `@ckb-ccc/core`、`@ckb-ccc/connector-react` | 跟随最新 minor | `ccc.Client` 接口若变动，适配器要同步更新 |
| 测试网 bootnodes | 使用上游 `config/testnet.toml` 中的列表 | 若 peer 不足导致同步慢，考虑申请把社区 NNCBN 引导节点加进来 |

**已知限制（文档中明示）**

- Safari：IndexedDB 在 Worker 中的行为与 Chrome 不同，不在 Spark 范围内。
- 移动浏览器：内存与后台限制，不承诺。
- 首次同步需要等待；对「打开就要看到余额」的产品场景，建议 RPC 作为首屏 fallback、轻客户端在后台接管——这个混合模式作为 Phase 2 候选。
- 只能查到 watch 过的脚本的 cell；通用的「任意地址查询」仍需 RPC 或 explorer。
- 自定义 type script 的 cell dep 需要开发者显式 watch。

**风险与缓解**

| 风险 | 触发信号 | 缓解 |
| --- | --- | --- |
| 首次同步 > 10 分钟 | M1 实测 | 缩小默认 `watchFrom`；文档建议混合模式 |
| 上游 WASM 在某些 Chrome 版本崩溃 | Playwright 每日任务失败 | 锁版本；提 issue 并附测试用例 |
| `ccc.Client` 抽象不足以覆盖轻客户端差异 | 适配器契约测试失败 | 在 `core` 中加薄层做差异抹平，并把发现写进向 CCC 的提案 |

## 12. 未来扩展（DAO Phase 2）

Spark 阶段的架构已为两条 Phase 2 路线留好接口，结项时按试用反馈选一条向 Community Fund DAO 申请。

| 路线 | 建立在哪一层上 | 新增内容 | 预估规模 |
| --- | --- | --- | --- |
| A. Light Wallet 浏览器扩展 | `core` + `react` | 扩展后台持续同步、`window.ckb` 注入、CCC 兼容的签名器接口、硬件钱包支持 | 10,000–15,000 USD |
| B. CCC 官方 `LightClient` | `core` | 把适配器合入 `@ckb-ccc/core`；Safari / 移动端兼容；混合模式（RPC 首屏 + 轻客户端接管） | 8,000–12,000 USD |

两条路都依赖 Spark 阶段三件事做扎实：`core` 包框架无关、契约测试覆盖 `ccc.Client` 全部方法、上游 issue 有记录可追溯。

---

*配套提案：[Spark Program | Light dApp Kit 提案](https://claude.ai/artifact/FuNwpBN2oa9jMzrscCTig1)。*
