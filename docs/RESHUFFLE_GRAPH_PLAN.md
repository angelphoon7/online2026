# RESHUFFLE × The Graph 接入工程表

> 目标赛道：The Graph — Best AI Tooling or AI Use Case with The Graph (From Scratch)，走 **AI Use Case** 路径，**Start Fresh** 池。
> 范围：只写 The Graph 这条线怎么接进已经完成的 Arc 部分。不写时间。
> 目录名、文件名按你 repo 的实际情况调整；凡是写着「以 0-A 输出为准」的地方，都必须用你合约的真实签名替换。

---

## 0. 全貌

### 0.1 数据流

```
 用户签名 / judge 控件
        │ tx
        ▼
┌──────────────── Arc Testnet (chainId 5042002) ────────────────┐
│  TicketNFT      Escrow      IntentRegistry      Settlement     │
└───────┬──────────────────────────┬──────────────────▲─────────┘
        │ events                   │ events           │ settle() tx + eth_call 模拟
        ▼                          ▼                  │
┌──────── Subgraph Studio (network: arc-testnet) ─────┼─────────┐
│  Ticket   ·   Intent   ·   Settlement   (+ _meta.block)       │
└──────────────────────┬──────────────────────────────┼─────────┘
                       │ GraphQL                      │
        ┌──────────────┼───────────────────┐          │
        ▼              ▼                   ▼          │
   前端读取层      solver 服务 ────────────────────────┘
 (getIntentPool…)  池 = subgraph 快照
                       ▲
                 agent 服务 (/agent/ask)
          钉死一个快照 → 确定性诊断 → LLM 叙述
```

一句话：**subgraph 负责发现，Arc 合约负责真相。**

### 0.2 为什么 subgraph 在你的架构里是承重的

IntentRegistry 只存 `hash → state`。意图的全部匹配条件在链上**只存在于 `IntentCommitted` 事件里**，而 mapping 在链上无法枚举。solver 要知道「现在有哪些活着的意图、每个要什么、拿什么换」，只能从事件重建——这正是 subgraph 做的事。

README 里用 SKILL 批准过的措辞：*This implementation relies on The Graph to reconstruct the live intent pool.* 不要写「唯一可能的方式」。

### 0.3 三条信任规则（整份工程都围绕它们）

1. **哈希绑定。** 从 subgraph 取到的每个意图，都在链下用同一个 `hashIntent()` 重算，必须等于 `intent.id`（链上承诺的哈希）。不等就丢弃并记名。subgraph 的解码错误或 mapping bug 因此不可能变成一个错误的意图。
2. **新鲜度下限。** 凡是「刚做完一笔交易之后」的读取，查询都带 `block: { number_gte: 交易所在区块 }`。graph-node 没追上会报错，我们等，不会读到旧池。
3. **链上复核。** solver 提交前照常 `eth_call` 模拟，Settlement 照常跑 V1–V8。索引滞后最坏的结果是模拟失败，不可能是错误结算。

### 0.4 目录落点

```
reshuffle/
├── contracts/                        已有（Foundry）
│   ├── out/                          已有：ABI 从这里抽
│   └── broadcast/<部署脚本>/5042002/  已有：地址和部署区块从这里抽
├── deployments/arc-testnet.json      新：地址 + startBlock + subgraphUrl 的唯一真源
├── subgraph/                         新
├── shared/                           新：hashIntent、类型、Graph 客户端（前后端共用）
├── solver/ 或 backend/               已有：输入换成 subgraph 快照；新增 agent/
├── frontend/                         已有：读取层换实现；新增 Agent 抽屉
└── scripts/                          新：export-deployment、gen-subgraph-config、
                                          check-subgraph-parity、capture-snapshot
```

### 0.5 改动落点总表（「哪里要写进我的 Arc」）

| 位置 | 现在 | 改成 | 为什么 |
|---|---|---|---|
| 四个 Arc 合约 | 已部署 | **默认不改**。只有第 0 步 C1/C4/C5 不通过才补事件字段 | 事件是 subgraph 唯一的输入 |
| Arc 部署脚本的 broadcast 输出 | 地址散在各处 | 部署后跑 `export-deployment` 写出 `deployments/arc-testnet.json` | 一处真源，换链不漏改 |
| 前端 chain 配置和 EIP-712 domain | 可能硬编码 | 从 `deployments/*.json` 读 `chainId` 和 `verifyingContract` | domain 错一个字段，所有签名作废 |
| `hashIntent()`（现在在前端 contracts lib） | 只有前端用 | 挪到 `shared/intent.ts`，前端签名、solver、快照校验共用同一个实现 | 规则 1 要求同一实现 |
| 读取层模块（`getIntentPool` 等所在文件） | viem 直读 RPC | 同一接口下两个实现：`graph`（Arc Testnet）和 `rpc`（本地 Anvil），env 切换 | Studio 索引不了 Anvil |
| 每个写操作之后的刷新 | 立即读 | receipt 走 RPC → `waitForIndexed(区块)` → 再读 | 规则 2 |
| solver 服务入口 | 从 RPC 或前端状态拿池 | `getPoolSnapshot()` | The Graph 承重的地方 |
| `lib/find-settlement.ts`（前端本地 solver） | 前端本地跑 | 前端改为调用后端 `/solve` | Arc 要求有后端，solver 也要是部署的服务 |
| judge 控件 Apply budget / Revoke | 未知 | 必须是真实的链上 `revoke` + `commit`，返回区块号 | 否则 subgraph 看不到，agent 答案不会变，演示那一拍就断了 |
| 后端 | solver | 新增 `/agent/ask`、`/agent/diagnose/:hash` | AI Use Case 本体 |
| 前端 | — | 新增 Agent 抽屉 | 演示和评委入口 |
| README / 提交表 | — | Graph 章节、bounty 声明、AI 使用说明 | 资格 |

---

## 第 0 步：盘点 Arc 合约（先做，决定后面走哪条路）

### 0-A 把四个合约的事件签名全部打出来

```bash
cd contracts
forge build
for c in TicketNFT Escrow IntentRegistry Settlement; do
  echo "== $c"
  jq -r '.abi[] | select(.type=="event")
    | "\(.name)(\([.inputs[] | "\(.type)\(if .indexed then " indexed" else "" end) \(.name)"] | join(", ")))"' \
    out/$c.sol/$c.json
done
```

再打出几个关键函数和结构体：

```bash
jq '.abi[] | select(.name=="settle")'                 out/Settlement.sol/Settlement.json
jq '.abi[] | select(.name=="state" or .name=="stateOf")' out/IntentRegistry.sol/IntentRegistry.json
jq '.abi[] | select(.name=="meta")'                    out/TicketNFT.sol/TicketNFT.json
grep -n "struct Intent" -A 20 src/*.sol
grep -n "intentHash\s*=" -B 2 -A 4 src/IntentRegistry.sol   # 找 registry 用哪个哈希当 key
```

把输出存成 `docs/graph-audit.txt`，后面每一步都要对照它。

### 0-B 六项检查

| # | 检查什么 | 通过标准 | 不通过怎么办 |
|---|---|---|---|
| C1 | `IntentCommitted` 是否带齐 `Intent` 结构体的每个字段 | 结构体里每个字段在事件里都有，类型一致（`owner` 作为 indexed topic 也算） | **必须改合约**：补字段 → 重部署 → 重灌数据。缺字段 subgraph 重建不出意图，solver 也算不出哈希 |
| C2 | registry 用哪个哈希当 key | 找到合约算 `intentHash` 的那一行（`_hashTypedDataV4(structHash)` 还是裸 `structHash`），确认前端 `hashIntent()` 算的是同一个 | 先修 `hashIntent()`，否则第 5 步会把所有意图都当 `HASH_MISMATCH` 丢掉 |
| C3 | 有没有事件告诉 subgraph「哪些意图被结算了」 | 满足其一：`Settled` 带 `bytes32[] intentHashes`；或 registry 标记结算时发 `IntentSettled(bytes32)` 之类的事件 | **D1**：加事件并重部署。**D2**：不改合约，快照里用 RPC 批量读 `state(hash)` 过滤已结算的意图，README 写明 |
| C4 | `settle()` 需不需要签名参数 | 参数只有 `Intent[]` 和 `Leg[]`（签名在 commit 时已验） | 如果还要 `bytes[] sigs`，`IntentCommitted` 必须带 `sig`，subgraph 也要存；不带就同 C1 |
| C5 | 票的元数据拿不拿得到 | `TicketMinted` 带 session/section/row/seat；或 `meta(uint256)` 是只含值类型字段的 public getter | 两者都没有 → 加一个 view 函数 → 重部署 |
| C6 | Arc Testnet 部署记录在不在 | `broadcast/<部署脚本>.s.sol/5042002/run-latest.json` 存在，含四个合约的 CREATE 交易和 receipt | 去 Arcscan 手查地址和部署区块，手填第 1 步的 json |

补充一个类型陷阱（C1 顺手看）：public mapping 自动生成的 getter **不返回结构体里的数组字段**。所以「事件缺 `offered`、handler 里调合约补」这条路，只有在合约另有一个返回完整 struct 的 view 函数时才走得通。

### 0-C 决策

- C1、C4、C5 全过，C3 也过 → **合约一行不改**，直接往下走。
- 只有 C3 不过 → 走 D2（不改合约）。除非你反正要重部署，那就顺手 D1。
- C1、C4、C5 任何一项不过 → 必须改合约。**改完、重部署、重灌演示数据之后，才能开始第 3 步。** subgraph 绑地址和起始区块，合约要先冻结。

合约一旦重部署，EIP-712 domain 的 `verifyingContract` 就变了，所有已 commit 的意图作废。这是正确性问题，不是配置问题。

---

## 第 1 步：部署配置的唯一真源

Arc 地址、起始区块、chainId、subgraph URL 只写在一个地方。前端、solver、agent、subgraph 全从这里读。之后上主网只需要多一个文件。

### 1-A `scripts/export-deployment.ts`

读 Foundry 的 `run-latest.json`，写出 `deployments/arc-testnet.json`：

```ts
// usage:
//   npx tsx scripts/export-deployment.ts \
//     contracts/broadcast/DeployArc.s.sol/5042002/run-latest.json arc-testnet
import fs from "node:fs";

const [, , runFile, network] = process.argv;
const run = JSON.parse(fs.readFileSync(runFile, "utf8"));
const receiptByHash = new Map<string, any>(run.receipts.map((r: any) => [r.transactionHash, r]));

const contracts: Record<string, { address: string; startBlock: number; deployTx: string }> = {};
for (const tx of run.transactions) {
  if (tx.transactionType !== "CREATE") continue;
  const rc = receiptByHash.get(tx.hash);
  contracts[tx.contractName] = {
    address: tx.contractAddress,
    startBlock: parseInt(rc.blockNumber, 16), // receipts store block numbers as hex strings
    deployTx: tx.hash,
  };
}

const out = { network, chainId: Number(run.chain), contracts, subgraphUrl: "" };
fs.mkdirSync("deployments", { recursive: true });
fs.writeFileSync(`deployments/${network}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
```

跑完检查：`TicketNFT`、`Escrow`、`IntentRegistry`、`Settlement` 四个都在，`chainId` 是 5042002。USDC 用 Arc 上的地址，不在这个文件的 CREATE 列表里，单独加一个 `usdc` 字段。`subgraphUrl` 等第 4 步部署完再填。

### 1-B 让已有的 Arc 代码读这个文件

1. 前端里写死合约地址和 EIP-712 domain 的地方，改成从 `deployments/${DEPLOYMENT}.json` 读。domain 的 `chainId` = 5042002，`verifyingContract` = IntentRegistry 地址。
2. solver 服务的合约地址配置，同样改成读这个文件。
3. 以后每次 Arc 重部署：重跑 `export-deployment` → 前端、solver、subgraph 自动拿到新地址。**不允许任何地方再手抄地址。**

---

## 第 2 步：Subgraph Studio 和 CLI

1. 打开 Subgraph Studio，用钱包登录，Create a Subgraph，slug 用 `reshuffle-arc-testnet`。
2. 复制 Studio 页面上的 **Deploy Key**（部署用）。再到 API Keys 页建一个 **API key**（查询用；即使 Studio 的 query URL 暂时不强制 key，也先建好，后端客户端支持可选的 key）。
3. 本机安装：
   ```bash
   npm i -g @graphprotocol/graph-cli@latest
   graph --version
   graph auth <DEPLOY_KEY>   # 以 Studio 页面给出的命令为准，CLI 版本不同写法略有差异
   ```
4. 网络名是 `arc-testnet`（The Graph 文档 Arc Testnet 页面上的标识）。
5. API key 在 Studio 里可以限制允许的域名。如果前端要直连 subgraph，就把 key 限定到你的前端域名；更好的做法是前端全部走后端代理（见 6-A），key 只放在服务端。

---

## 第 3 步：subgraph 工程

### 3-A 目录

```
subgraph/
├── package.json             依赖 @graphprotocol/graph-cli、@graphprotocol/graph-ts
├── abis/                    从 contracts/out 抽出的纯 ABI 数组
│   ├── TicketNFT.json
│   ├── Escrow.json
│   ├── IntentRegistry.json
│   └── Settlement.json
├── schema.graphql
├── subgraph.yaml
├── networks.json            由 deployments/arc-testnet.json 生成，不手写
└── src/
    ├── config.ts            生成：Escrow / Settlement / TicketNFT 地址常量
    ├── helpers.ts
    ├── ticket.ts
    ├── registry.ts
    ├── settlement.ts
    └── escrow.ts            可选，见 3-F
```

### 3-B 抽 ABI

Foundry 的 artifact 是一个对象，ABI 在 `.abi` 字段里，graph-cli 要的是纯数组：

```bash
for c in TicketNFT Escrow IntentRegistry Settlement; do
  jq '.abi' contracts/out/$c.sol/$c.json > subgraph/abis/$c.json
done
```

合约改过就重抽，然后重跑 `graph codegen`。

### 3-C 生成 `networks.json` 和 `src/config.ts`

`scripts/gen-subgraph-config.ts`：

```ts
// usage: npx tsx scripts/gen-subgraph-config.ts arc-testnet
import fs from "node:fs";

const net = process.argv[2] ?? "arc-testnet";
const d = JSON.parse(fs.readFileSync(`deployments/${net}.json`, "utf8"));
const pick = (n: string) => ({ address: d.contracts[n].address, startBlock: d.contracts[n].startBlock });

fs.writeFileSync("subgraph/networks.json", JSON.stringify({
  [net]: {
    TicketNFT: pick("TicketNFT"),
    Escrow: pick("Escrow"),
    IntentRegistry: pick("IntentRegistry"),
    Settlement: pick("Settlement"),
  },
}, null, 2));

fs.writeFileSync("subgraph/src/config.ts",
`// GENERATED by scripts/gen-subgraph-config.ts — do not edit by hand
import { Address } from "@graphprotocol/graph-ts";
export const TICKET_NFT = Address.fromString("${d.contracts.TicketNFT.address}");
export const ESCROW     = Address.fromString("${d.contracts.Escrow.address}");
export const SETTLEMENT = Address.fromString("${d.contracts.Settlement.address}");
`);
console.log("networks.json + src/config.ts written for", net);
```

`networks.json` 里的 key（`TicketNFT` 等）必须和 `subgraph.yaml` 里 dataSource 的 `name` 完全一致，graph-cli 靠它替换地址和起始区块。

### 3-D `schema.graphql`

```graphql
enum IntentState { LIVE REVOKED SETTLED }

type Ticket @entity {
  id: ID!                     # tokenId as decimal string
  tokenId: BigInt!
  eventId: Int!
  sessionId: Int!
  sectionId: Int!
  row: Int!
  seat: Int!
  owner: Bytes!               # current ERC-721 owner (the Escrow address while escrowed)
  depositor: Bytes            # who escrowed it; null when not in escrow
  escrowed: Boolean!
  redeemed: Boolean!
  updatedAtBlock: BigInt!
}

type Intent @entity {
  id: Bytes!                  # intentHash — the on-chain commitment
  owner: Bytes!
  eventId: Int!
  offered: [BigInt!]!         # exact signed order — required to recompute the hash
  offeredTickets: [Ticket!]!  # same ids as relations, for nested custody checks
  sessionMask: BigInt!
  sectionMask: BigInt!
  exactCount: Int!
  mustShareSession: Boolean!
  mustShareSection: Boolean!
  mustBeAdjacent: Boolean!
  maxNetPay: BigInt!          # signed: >0 pays up to, <0 must receive at least
  deadline: BigInt!
  nonce: BigInt!
  state: IntentState!
  committedAtBlock: BigInt!
  committedTx: Bytes!
  closedAtBlock: BigInt
  closedTx: Bytes
  settlement: Settlement
}

type Settlement @entity(immutable: true) {
  id: Bytes!                  # txHash ++ logIndex
  proposer: Bytes!
  txHash: Bytes!
  blockNumber: BigInt!
  timestamp: BigInt!
  intents: [Intent!]!
  legs: [SettlementLeg!]! @derivedFrom(field: "settlement")
}

# Only if the Settled event carries per-leg data (see 3-F settlement.ts).
type SettlementLeg @entity(immutable: true) {
  id: Bytes!
  settlement: Settlement!
  intent: Intent!
  participant: Bytes!
  receives: [BigInt!]!
  netPayment: BigInt!
}
```

C4 如果要求签名，`Intent` 再加 `signature: Bytes!`。
C3 走 D2 的话，`Settlement` 和 `SettlementLeg` 两个实体可以先不建。

### 3-E `subgraph.yaml`

```yaml
specVersion: 1.2.0             # 保留 graph init 为你的 CLI 版本生成的值
schema:
  file: ./schema.graphql
dataSources:
  - kind: ethereum/contract
    name: TicketNFT
    network: arc-testnet
    source:
      address: "0x0000000000000000000000000000000000000000"   # --network 时由 networks.json 覆盖
      abi: TicketNFT
      startBlock: 0                                             # 同上
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.9        # 保留 graph init 生成的值
      language: wasm/assemblyscript
      entities: [Ticket]
      abis:
        - name: TicketNFT
          file: ./abis/TicketNFT.json
      eventHandlers:
        - event: Transfer(indexed address,indexed address,indexed uint256)
          handler: handleTransfer
        - event: TicketRedeemed(indexed uint256)               # 以 0-A 输出为准
          handler: handleTicketRedeemed
      file: ./src/ticket.ts

  - kind: ethereum/contract
    name: IntentRegistry
    network: arc-testnet
    source:
      address: "0x0000000000000000000000000000000000000000"
      abi: IntentRegistry
      startBlock: 0
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.9
      language: wasm/assemblyscript
      entities: [Intent]
      abis:
        - name: IntentRegistry
          file: ./abis/IntentRegistry.json
      eventHandlers:
        - event: IntentCommitted(indexed bytes32,indexed address,indexed uint32,uint256[],uint256,uint256,uint8,bool,bool,bool,int256,uint64,uint256)
          handler: handleIntentCommitted
        - event: IntentRevoked(indexed bytes32)                # 以 0-A 输出为准
          handler: handleIntentRevoked
        # 只有 C3 在 registry 里找到了结算事件才打开：
        # - event: IntentSettled(indexed bytes32)
        #   handler: handleIntentSettled
      file: ./src/registry.ts

  - kind: ethereum/contract
    name: Settlement
    network: arc-testnet
    source:
      address: "0x0000000000000000000000000000000000000000"
      abi: Settlement
      startBlock: 0
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.9
      language: wasm/assemblyscript
      entities: [Settlement, SettlementLeg, Intent]
      abis:
        - name: Settlement
          file: ./abis/Settlement.json
      eventHandlers:
        - event: Settled(indexed address,bytes32[])             # 以 0-A 输出为准
          handler: handleSettled
      file: ./src/settlement.ts
```

写 event 签名的三条规则：

1. 字符串必须和 ABI 完全一致，包括每个 `indexed`，参数之间不留空格。
2. 最省事的办法是先 `graph init --studio reshuffle-arc-testnet`，用本地 ABI 选 `arc-testnet`、填 IntentRegistry 地址，再用 `graph add <地址> --abi abis/X.json --contract-name X` 把其他合约加进来。CLI 会生成签名正确的条目，然后把 schema 和 mapping 换成本文件的版本。
3. handler 里调用哪个合约，那个合约的 ABI 就必须出现在**这个 dataSource** 的 `abis` 列表里。

Escrow 的 `TicketEscrowed` / `TicketWithdrawn` 这里没有索引，因为托管状态完全可以从 ERC-721 `Transfer` 推出来（见 3-F）。想做交叉验证的话，再加一个 Escrow dataSource。

### 3-F mappings

**托管状态的推导逻辑（先理解再写）：**
- `Transfer(from, to, id)`，`to == ESCROW` → 进入托管，`depositor = from`。
- `Transfer(from, to, id)`，`from == ESCROW` → 离开托管。可能是用户 withdraw，也可能是 Settlement 把票交给对手方，两种情况托管都结束了。
- `from == 0x0` → 铸造，第一次见到这张票，用合约调用补元数据。

这个推导不依赖 Escrow 自定义事件的具体形状。前提是 `Escrow.deposit()` 确实把 NFT 转进了 Escrow 合约——你们修过 `transferFrom onlySettlement` 那个 bug，说明是这样。

`src/helpers.ts`：

```ts
import { Address, BigInt, log } from "@graphprotocol/graph-ts";
import { Ticket } from "../generated/schema";
import { TicketNFT } from "../generated/TicketNFT/TicketNFT";

export function getOrCreateTicket(nft: Address, tokenId: BigInt, block: BigInt): Ticket {
  const id = tokenId.toString();
  let t = Ticket.load(id);
  if (t != null) return t;

  t = new Ticket(id);
  t.tokenId = tokenId;
  t.owner = Address.zero();
  t.escrowed = false;
  t.redeemed = false;
  t.updatedAtBlock = block;

  // eth_call at this block: metadata is written in the mint tx, so it is visible here.
  const r = TicketNFT.bind(nft).try_meta(tokenId);
  if (r.reverted) {
    log.warning("meta({}) reverted — ticket left with zero metadata", [id]);
    t.eventId = 0; t.sessionId = 0; t.sectionId = 0; t.row = 0; t.seat = 0;
  } else {
    // Accessor names follow codegen — check generated/TicketNFT/TicketNFT.ts
    t.eventId   = r.value.getEventId().toI32(); // uint32 → BigInt in codegen
    t.sessionId = r.value.getSessionId();       // uint16 → i32
    t.sectionId = r.value.getSectionId();
    t.row       = r.value.getRow();
    t.seat      = r.value.getSeat();
    t.redeemed  = r.value.getStatus() == 1;
  }
  return t;
}
```

如果 C5 发现 `TicketMinted` 本身就带元数据，就加一个 `handleTicketMinted` 直接用事件字段，不调合约。

`src/ticket.ts`：

```ts
import { Transfer, TicketRedeemed } from "../generated/TicketNFT/TicketNFT";
import { getOrCreateTicket } from "./helpers";
import { ESCROW } from "./config";

export function handleTransfer(e: Transfer): void {
  const t = getOrCreateTicket(e.address, e.params.tokenId, e.block.number);
  t.owner = e.params.to;
  if (e.params.to.equals(ESCROW)) {
    t.escrowed = true;
    t.depositor = e.params.from;
  } else if (e.params.from.equals(ESCROW)) {
    t.escrowed = false;   // withdrawal or settlement release — custody ends either way
    t.depositor = null;
  }
  t.updatedAtBlock = e.block.number;
  t.save();
}

export function handleTicketRedeemed(e: TicketRedeemed): void {
  const t = getOrCreateTicket(e.address, e.params.tokenId, e.block.number);
  t.redeemed = true;
  t.updatedAtBlock = e.block.number;
  t.save();
}
```

`src/registry.ts`：

```ts
import { log } from "@graphprotocol/graph-ts";
import { IntentCommitted, IntentRevoked } from "../generated/IntentRegistry/IntentRegistry";
import { Intent } from "../generated/schema";

export function handleIntentCommitted(e: IntentCommitted): void {
  const i = new Intent(e.params.intentHash);
  i.owner = e.params.owner;
  i.eventId = e.params.eventId.toI32();          // uint32 → BigInt in codegen
  i.offered = e.params.offered;                  // keep order exactly as signed

  const ids = new Array<string>();
  for (let k = 0; k < e.params.offered.length; k++) {
    ids.push(e.params.offered[k].toString());
  }
  i.offeredTickets = ids;

  i.sessionMask = e.params.sessionMask;
  i.sectionMask = e.params.sectionMask;
  i.exactCount = e.params.exactCount;            // uint8 → i32
  i.mustShareSession = e.params.mustShareSession;
  i.mustShareSection = e.params.mustShareSection;
  i.mustBeAdjacent = e.params.mustBeAdjacent;
  i.maxNetPay = e.params.maxNetPay;              // int256 → signed BigInt
  i.deadline = e.params.deadline;                // uint64 → BigInt
  i.nonce = e.params.nonce;
  i.state = "LIVE";
  i.committedAtBlock = e.block.number;
  i.committedTx = e.transaction.hash;
  i.save();
}

export function handleIntentRevoked(e: IntentRevoked): void {
  const i = Intent.load(e.params.intentHash);
  if (i == null) {
    log.warning("revoke for unknown intent {}", [e.params.intentHash.toHexString()]);
    return;
  }
  i.state = "REVOKED";
  i.closedAtBlock = e.block.number;
  i.closedTx = e.transaction.hash;
  i.save();
}
```

`src/settlement.ts`（C3 情况 A：`Settled` 带 `intentHashes`）：

```ts
import { Bytes } from "@graphprotocol/graph-ts";
import { Settled } from "../generated/Settlement/Settlement";
import { Intent, Settlement } from "../generated/schema";

export function handleSettled(e: Settled): void {
  const sid = e.transaction.hash.concatI32(e.logIndex.toI32());
  const s = new Settlement(sid);
  s.proposer = e.params.proposer;                // if not in the event: e.transaction.from
  s.txHash = e.transaction.hash;
  s.blockNumber = e.block.number;
  s.timestamp = e.block.timestamp;

  const hashes = e.params.intentHashes;
  const ids = new Array<Bytes>();
  for (let k = 0; k < hashes.length; k++) {
    ids.push(hashes[k]);
    const i = Intent.load(hashes[k]);
    if (i == null) continue;
    i.state = "SETTLED";
    i.closedAtBlock = e.block.number;
    i.closedTx = e.transaction.hash;
    i.settlement = sid;
    i.save();
  }
  s.intents = ids;
  s.save();

  // If Settled also carries legs (participants[], netPayments[], receives…),
  // create one SettlementLeg per index here with id = sid.concatI32(index).
}
```

C3 情况 C（registry 发 `IntentSettled(bytes32)`）：在 `registry.ts` 里加一个 handler，逻辑同上，只改 state 和 closed 字段。
C3 情况 D2（没有任何结算事件）：不写这个 handler，过滤放到第 5 步快照里做。

**AssemblyScript 常见坑：**
- `Entity.load()` 返回可能为 `null`，必须判空，否则整个 subgraph 卡死在那个区块。
- 实体上的数组字段不能原地改：`let a = e.arr; a.push(x); e.arr = a;` 才会保存。
- 数组方法里的闭包不能引用外部变量，一律用 `for` 循环。
- 类型映射：`uint8`/`uint16`/`int8`–`int32` → `i32`；`uint32` 及以上 → `BigInt`，所以 `eventId` 要 `.toI32()`。
- `@entity(immutable: true)` 的实体 save 之后不能再改。
- 改了 ABI 或 schema 必须重跑 `graph codegen`。
- 调试用 `log.warning`，在 Studio 的 Logs 页能看到。

### 3-G 构建和部署

```bash
npx tsx scripts/gen-subgraph-config.ts arc-testnet
cd subgraph
npm install
graph codegen
graph build --network arc-testnet
graph deploy reshuffle-arc-testnet --network arc-testnet --version-label v0.1.0
```

mapping 修 bug 后用新的 `--version-label` 重新部署（v0.1.1…）。每次部署后到 Studio 确认 Query URL 有没有变，变了就更新 `deployments/arc-testnet.json` 的 `subgraphUrl`。

---

## 第 4 步：部署验收

### 4-A Studio 里看

1. 状态显示 Synced，Indexing errors 为空，Logs 里没有 `reverted` 或 `unknown intent` 的警告。
2. 在 Playground 跑：

```graphql
{
  _meta { block { number timestamp } hasIndexingErrors }
  intents(first: 20, orderBy: committedAtBlock, orderDirection: desc) {
    id owner state eventId offered exactCount mustBeAdjacent maxNetPay committedTx
  }
  tickets(first: 50, where: { escrowed: true }) {
    id sessionId sectionId row seat depositor
  }
}
```

3. 数量对账：种子脚本 commit 了多少意图，这里就应该有多少个 `Intent`；托管中的票数和你的种子数据一致。
4. **测索引延迟**：发一笔真实交易（比如 revoke 一个测试意图），记下 receipt 的区块号 B，轮询 `_meta` 直到 ≥ B，记下实际等了多久。这是**实测值**，决定演示节奏，写进你的笔记，不要估。

### 4-B `scripts/check-subgraph-parity.ts`

用链上状态审计索引。这是「No promise without a check」用在索引器上，输出贴进 README。

```ts
// usage: npx tsx scripts/check-subgraph-parity.ts arc-testnet
import { createPublicClient, http } from "viem";
import { gql } from "../shared/graph/client";
import { hashIntent, fromGraph } from "../shared/intent";
import { registryAbi, ticketAbi } from "../shared/abis";
import d from "../deployments/arc-testnet.json";

const STATE = { 1: "LIVE", 2: "REVOKED", 3: "SETTLED" } as const;
const client = createPublicClient({ transport: http(process.env.ARC_RPC_URL) });

const q = await gql<any>(`{
  _meta { block { number } }
  intents(first: 1000) { id owner eventId offered sessionMask sectionMask exactCount
    mustShareSession mustShareSection mustBeAdjacent maxNetPay deadline nonce state }
  tickets(first: 1000) { id owner redeemed }
}`);
const B = BigInt(q._meta.block.number);
let pass = 0, fail = 0;
const check = (ok: boolean, msg: string) => { ok ? pass++ : (fail++, console.log("FAIL", msg)); };

for (const i of q.intents) {
  check(hashIntent(fromGraph(i)) === i.id, `hash ${i.id}`);
  const s = await client.readContract({
    address: d.contracts.IntentRegistry.address, abi: registryAbi,
    functionName: "state", args: [i.id], blockNumber: B,
  });
  check(STATE[Number(s) as 1 | 2 | 3] === i.state, `state ${i.id}: chain=${s} graph=${i.state}`);
}
for (const t of q.tickets) {
  const owner = await client.readContract({
    address: d.contracts.TicketNFT.address, abi: ticketAbi,
    functionName: "ownerOf", args: [BigInt(t.id)], blockNumber: B,
  });
  check(owner.toLowerCase() === t.owner, `owner #${t.id}`);
}
console.log(`block ${B}: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
```

注意三点：
- 按区块 B 读链上状态需要 RPC 支持历史 `eth_call`。Arc 的公共 RPC 不支持的话，改成在没有交易进行时读 latest。
- 走 D2 的话，已结算意图会显示 `chain=3 graph=LIVE`，这是预期的，脚本里对 D2 跳过 SETTLED 的对比，只校验哈希和 LIVE/REVOKED。
- 每次重灌种子数据、每次重部署 subgraph 都跑一遍。

---

## 第 5 步：共享 Graph 客户端（`shared/`）

前端和后端共用。这一层把「GraphQL 返回的字符串」变成「solver 能直接吃的类型」，并在这里执行三条信任规则里的前两条。

```
shared/
├── intent.ts          hashIntent()（从前端挪过来）、fromGraph()、Intent 类型
├── abis.ts            从 deployments + contracts/out 导出的 ABI
└── graph/
    ├── client.ts      gql()
    ├── queries.ts     POOL_SNAPSHOT、META、INTENT_BY_ID
    ├── snapshot.ts    getPoolSnapshot()
    └── wait.ts        waitForIndexed()
```

### 5-A `shared/intent.ts`

1. 把前端现在的 `hashIntent()` **原样**挪过来，前端改成从这里 import。不要写第二份。
2. 加 `fromGraph()`：把 subgraph 的字符串字段转成合约结构体的类型。

```ts
export function fromGraph(g: any): Intent {
  return {
    owner: g.owner as `0x${string}`,
    eventId: Number(g.eventId),
    offered: g.offered.map((x: string) => BigInt(x)),   // order preserved — the hash depends on it
    sessionMask: BigInt(g.sessionMask),
    sectionMask: BigInt(g.sectionMask),
    exactCount: Number(g.exactCount),
    mustShareSession: g.mustShareSession,
    mustShareSection: g.mustShareSection,
    mustBeAdjacent: g.mustBeAdjacent,
    maxNetPay: BigInt(g.maxNetPay),                      // negative strings parse fine
    deadline: BigInt(g.deadline),
    nonce: BigInt(g.nonce),
  };
}
```

字段名和顺序跟你的 `Intent` 结构体一致。subgraph 返回的地址是小写 hex，比较地址时统一 `toLowerCase()`。

### 5-B `shared/graph/client.ts`

```ts
export class GraphError extends Error {
  constructor(public errors: { message: string }[]) { super(errors.map(e => e.message).join("; ")); }
}

const isServer = typeof window === "undefined";

export async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  // Browser → the proxy in 6-A (no key in the bundle). Server → Studio directly, with the key.
  const url = isServer ? process.env.SUBGRAPH_URL! : "/api/graph";
  const key = isServer ? process.env.GRAPH_API_KEY : undefined;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors?.length) throw new GraphError(body.errors);
  return body.data as T;
}
```

同一份代码前后端都能跑：浏览器里自动走 6-A 的代理，key 永远不进前端 bundle；服务端直连 Studio。所以 `getPoolSnapshot()` 和 `waitForIndexed()` 两边共用，不用写两份。

### 5-C `shared/graph/queries.ts`

```ts
export const POOL_SNAPSHOT = /* GraphQL */ `
query PoolSnapshot($minBlock: Int!) {
  _meta(block: { number_gte: $minBlock }) { block { number timestamp hash } hasIndexingErrors }
  intents(first: 1000, where: { state: LIVE }, block: { number_gte: $minBlock }) {
    id owner eventId offered sessionMask sectionMask exactCount
    mustShareSession mustShareSection mustBeAdjacent maxNetPay deadline nonce
    committedAtBlock committedTx
    offeredTickets { id escrowed depositor redeemed }
  }
  tickets(first: 1000, where: { escrowed: true, redeemed: false }, block: { number_gte: $minBlock }) {
    id eventId sessionId sectionId row seat depositor
  }
}`;

export const META = /* GraphQL */ `{ _meta { block { number } hasIndexingErrors } }`;

export const INTENT_BY_ID = /* GraphQL */ `
query IntentById($id: Bytes!) {
  intent(id: $id) { id state closedTx closedAtBlock committedTx }
}`;
```

几个细节：
- 数据和 `_meta` 放在**同一个请求**里，返回的区块号就是这批数据所在的区块。agent 显示的 block #N 因此是真的。
- `first` 上限是 1000，嵌套列表默认最多 100 条。黑客松规模够用；超了用 `id_gt` 翻页。
- `number_gte` 的语义：graph-node 还没索引到这个区块会直接报错；索引到了就用最新区块回答。

### 5-D `shared/graph/snapshot.ts`

这里镜像 V1–V3，先把「肯定会被合约拒绝」的意图过滤掉，并**给每个被排除的意图记一个名字**。这些名字后面直接变成 agent 的诊断。

```ts
export type ExclusionReason =
  | "HASH_MISMATCH"         // subgraph fields do not hash to the committed id
  | "EXPIRED"               // deadline < block.timestamp            (mirrors V1)
  | "TICKET_UNKNOWN"        // an offered id has no Ticket entity
  | "TICKET_NOT_IN_ESCROW"  // offered ticket withdrawn or held by someone else (mirrors V2)
  | "TICKET_REDEEMED"       //                                        (mirrors V3)
  | "NOT_LIVE_ONCHAIN";     // D2 only: registry.state != LIVE

export type Snapshot = {
  block: bigint;
  timestamp: bigint;
  intents: (Intent & { hash: `0x${string}`; committedTx: string })[];
  tickets: Map<bigint, TicketMeta>;   // escrowed, unredeemed — the solver's ticket universe
  excluded: { id: string; reason: ExclusionReason; detail?: string }[];
};

export async function getPoolSnapshot(minBlock: bigint = 0n): Promise<Snapshot> {
  const d = await gql<any>(POOL_SNAPSHOT, { minBlock: Number(minBlock) });
  if (d._meta.hasIndexingErrors) throw new Error("SubgraphIndexingError");
  const block = BigInt(d._meta.block.number);
  const ts = BigInt(d._meta.block.timestamp);

  const intents: Snapshot["intents"] = [];
  const excluded: Snapshot["excluded"] = [];

  for (const g of d.intents) {
    const intent = fromGraph(g);
    const owner = g.owner.toLowerCase();

    if (hashIntent(intent) !== g.id) { excluded.push({ id: g.id, reason: "HASH_MISMATCH" }); continue; }
    if (intent.deadline < ts)        { excluded.push({ id: g.id, reason: "EXPIRED" }); continue; }
    if (g.offeredTickets.length !== g.offered.length) {
      excluded.push({ id: g.id, reason: "TICKET_UNKNOWN" }); continue;
    }
    const out = g.offeredTickets.find((t: any) => !t.escrowed || t.depositor?.toLowerCase() !== owner);
    if (out) { excluded.push({ id: g.id, reason: "TICKET_NOT_IN_ESCROW", detail: out.id }); continue; }
    const red = g.offeredTickets.find((t: any) => t.redeemed);
    if (red) { excluded.push({ id: g.id, reason: "TICKET_REDEEMED", detail: red.id }); continue; }

    intents.push({ ...intent, hash: g.id, committedTx: g.committedTx });
  }

  // D2 only (C3 failed): confirm registry state on-chain, one multicall.
  // const states = await multicallState(intents.map(i => i.hash));
  // move every non-LIVE one into excluded with reason NOT_LIVE_ONCHAIN.

  return { block, timestamp: ts, intents, tickets: toTicketMap(d.tickets), excluded };
}
```

`toTicketMap` 把票转成 solver 现有的 ticket 类型，key 是 `BigInt(id)`。**快照的输出类型直接等于 solver 现有的输入类型**，solver 内部逻辑一行不动。

D2 的补充：有 offered 票的意图，结算后票会离开 escrow，`TICKET_NOT_IN_ESCROW` 本来就会把它排除掉。真正需要 RPC 复核的只有 offered 为空的纯买家意图。

### 5-E `shared/graph/wait.ts`

```ts
export async function waitForIndexed(target: bigint, timeoutMs = 90_000): Promise<bigint> {
  const t0 = Date.now();
  let delay = 800;
  for (;;) {
    const { _meta } = await gql<any>(META);
    if (_meta.hasIndexingErrors) throw new Error("SubgraphIndexingError");
    const n = BigInt(_meta.block.number);
    if (n >= target) return n;
    if (Date.now() - t0 > timeoutMs) throw new Error(`SubgraphLagTimeout: indexed ${n}, need ${target}`);
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(Math.round(delay * 1.5), 5000);
  }
}
```

只在「刚发完交易」时调用。**不要在页面上每秒轮询**，Studio 的开发端点有速率限制。

---

## 第 6 步：接到 Arc 已有的代码

### 6-A 前端读取层

找到现在导出 `getIntentPool()`、`getTicketsFor()`、`getSettlements()`、`getSeatCustody()` 的那个模块。

1. 把现有实现原样移到 `read/rpc.ts`。
2. 新建 `read/graph.ts`，实现同样的四个函数签名。
3. 原来的入口文件只做切换：

```ts
// frontend/lib/read/index.ts
import * as rpc from "./rpc";
import * as graph from "./graph";
const impl = (process.env.NEXT_PUBLIC_READ_SOURCE ?? "graph") === "rpc" ? rpc : graph;
export const { getIntentPool, getTicketsFor, getSettlements, getSeatCustody } = impl;
```

`read/graph.ts` 里四个函数怎么查：

| 函数 | 查询 | 备注 |
|---|---|---|
| `getIntentPool(minBlock?)` | `getPoolSnapshot(minBlock)`（经 `/api/graph` 代理） | 每行带 `committedTx`，渲染成 Arcscan 链接；被排除的意图也显示，带排除原因 |
| `getTicketsFor(addr)` | `tickets(where: { or: [{ owner: $a }, { depositor: $a }] })` | 托管中的票 owner 是 Escrow，所以要查 depositor；`or` 报错就拆成两个查询 |
| `getSeatCustody(session, section)` | `tickets(where: { sessionId: $s, sectionId: $c })` | 座位图只读，不可交互（UI spec 已定） |
| `getSettlements()` | `settlements(orderBy: blockNumber, orderDirection: desc) { … legs { … } }` | 只有 `Settled` 带 legs 时才走 subgraph；否则保留 RPC 实现 |

前端不直连 subgraph，加一个后端代理，key 只在服务端：

```ts
// frontend/app/api/graph/route.ts   (Next.js route handler; or the same route on your backend)
export async function POST(req: Request) {
  const body = await req.text();
  const r = await fetch(process.env.SUBGRAPH_URL!, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.GRAPH_API_KEY ? { authorization: `Bearer ${process.env.GRAPH_API_KEY}` } : {}),
    },
    body,
  });
  return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
```

本地 Anvil 开发时设 `NEXT_PUBLIC_READ_SOURCE=rpc`，因为 Studio 索引不到 Anvil。

### 6-B 每个写操作之后

涉及的按钮：Deposit、Withdraw、Sign and commit、Revoke、Propose and settle、Apply budget、Redeem。统一改成：

```ts
const rc = await publicClient.waitForTransactionReceipt({ hash });  // RPC: receipt panel updates immediately
ui.setIndexing(rc.blockNumber);                                     // shows "Indexing block #…"
await waitForIndexed(rc.blockNumber);                                // via backend proxy
await refreshAll(rc.blockNumber);                                    // getIntentPool(minBlock = rc.blockNumber)
ui.setIndexed(rc.blockNumber);
```

receipt 面板（tx hash、具名错误、Arcscan 链接）**继续走 RPC**，不要经过 subgraph。subgraph 只负责「池子现在长什么样」。

### 6-C solver 服务

在后端 solver 的入口改三处：

1. **输入**：`const snap = await getPoolSnapshot(minBlock);` 然后 `solve(snap.intents, snap.tickets, BOUNDS)`。删掉原来从 RPC logs 或前端状态组装池子的代码（或者只留给 `--source rpc` 的本地模式）。每次求解都在日志里打印 `pool source: subgraph @ block N`，评委看得见。
2. **输出**：响应里加 `snapshotBlock`、`bounds`（参与者上限、候选上限、超时——你已发布的搜索边界）、`excluded`。
3. **提交**：不变。`simulateContract(settle)` → `writeContract`。模拟失败就报告失败，不绕过。

接口形状：

```
POST /solve   { minBlock?: string }   → { snapshotBlock, bounds, candidates[], excluded[] }
POST /settle  { candidateId }         → { txHash, blockNumber }   // 或你现有的形状
```

前端的 `lib/find-settlement.ts` 改成调用 `/solve`。本地文件可以留作 Anvil 开发用，但演示和 Arc Testnet 一律走后端。

solver 需要新增一个**假设模式**，给 agent 用：

```ts
solve(pool, tickets, bounds, { hypothetical?: { replaceHash: Hex; intent: Intent } })
```

用改过的意图替换池子里的原意图去搜索。返回结果带 `submittable: false`，任何代码路径都不允许把假设结果送进 `/settle`。

### 6-D judge 控件：Apply budget 和 Revoke participant

这是 The Graph 演示那一拍的前提，单独检查：

1. **必须上链。** Apply budget = `revoke(oldHash)` + `commit(newIntent, sig)`，新 nonce，由该参与者的 key 签新的 EIP-712。只改前端 state 不行。
2. **返回区块号。** 响应形如 `{ revokeTx, commitTx, commitBlock, newHash }`，前端拿 `commitBlock` 调 `waitForIndexed`。
3. **哈希换了。** 新意图有新哈希，Agent 抽屉要跟着切到 `newHash`。
4. **签名在哪里签。** 用你 single-operator 模式里种子参与者的 key，只在服务端，绝不进前端 bundle。

---

## 第 7 步：Agent

### 7-A 四条原则

1. **只读。** agent 没有私钥，不能签名，不能提交。它最多告诉用户「如果你签一个这样的新意图，在区块 #N 的池子里能找到方案」。
2. **一次提问钉死一个快照。** 请求开始时取一次 `getPoolSnapshot(minBlock)`，这次提问里所有工具都读这一个快照。答案里的 block #N 和证据完全对应。
3. **确定性引擎做判断，LLM 只选工具和叙述。** 「哪个条件卡住」由 solver 反事实重跑得出，不是模型猜的。评委问「你怎么知道」，答案是证据 JSON。
4. **答案必须能追溯到证据。** 答案里出现的每个完整地址都必须在证据里，区块号必须一致；不满足就换成确定性模板。

### 7-B 文件

```
backend/agent/
├── diagnose.ts     supply funnel + demand check + single-condition relaxations
├── whatIf.ts       apply user-specified changes → solver hypothetical mode
├── overview.ts     pool counts by session / section at the pinned block
├── tools.ts        tool schemas + dispatcher
├── narrate.ts      Claude API tool-use loop
├── guard.ts        banned words + evidence check + template fallback
├── template.ts     deterministic sentences from Evidence
└── routes.ts       POST /agent/ask, GET /agent/diagnose/:hash
```

### 7-C 证据的形状

```ts
export type Evidence = {
  block: string;
  intent: string;
  status: "SETTLEABLE" | "NOT_FOUND_WITHIN_BOUND" | "EXCLUDED" | "CLOSED" | "UNKNOWN";
  exclusion?: { reason: ExclusionReason; detail?: string };
  closed?: { state: "REVOKED" | "SETTLED"; tx: string };
  settleable?: { counterparties: string[]; participantCount: number; targetNetPay: string };
  supply?: {                       // necessary condition only: do the tickets you want exist?
    stages: { stage: string; remaining: number }[];
    firstZero?: string;
    largestGroup: number;
    need: number;
  };
  demand?: {                       // does anyone currently accept what you offer?
    perTicket: { ticket: string; acceptingIntents: number }[];
    unwanted: string[];
  };
  relaxations: {
    change: string;                // "maxNetPay→cap" | "mustBeAdjacent=false" | "addSection=3" …
    found: boolean;
    counterparties: string[];
    participantCount?: number;
    targetNetPay?: string;         // signed, contract units
  }[];
  bounds: SolverBounds;            // the published search bounds that produced this
  counterpartyTx: Record<string, string>;   // address → committedTx, rendered as Arcscan links
};
```

示例（数值是占位，`bounds` 从 solver 配置读，不要手填）：

```json
{
  "block": "<N>",
  "intent": "0x9f…",
  "status": "NOT_FOUND_WITHIN_BOUND",
  "supply": {
    "stages": [
      { "stage": "offeredByOthers", "remaining": 9 },
      { "stage": "eventId", "remaining": 9 },
      { "stage": "session", "remaining": 4 },
      { "stage": "section", "remaining": 3 },
      { "stage": "adjacentRun", "remaining": 2 }
    ],
    "largestGroup": 2,
    "need": 2
  },
  "demand": { "perTicket": [{ "ticket": "7", "acceptingIntents": 2 }], "unwanted": [] },
  "relaxations": [
    { "change": "maxNetPay→cap", "found": true, "counterparties": ["0x3a…", "0x7f…"],
      "participantCount": 3, "targetNetPay": "<30 USDC in contract units>" },
    { "change": "mustBeAdjacent=false", "found": false, "counterparties": [] }
  ],
  "bounds": "<from solver config>"
}
```

这个例子读出来就是：票是存在的（漏斗没到 0），有人要你的票（demand 非 0），卡住的是钱——预算放开后找到了一个三方方案，你在里面付 30。

### 7-D `diagnose(snap, hash)` 的算法

按顺序执行，每一步都是确定性的：

**1. 定位。**
- 在 `snap.intents` 里 → 继续。
- 在 `snap.excluded` 里 → 返回 `EXCLUDED` 和具名原因，例如「ticket #7 已不在托管中」。这本身就是一个很好的答案。
- 都不在 → 查 `INTENT_BY_ID`：`REVOKED` / `SETTLED` 返回 `CLOSED` 带 tx；查不到返回 `UNKNOWN`。

**2. 基线。** 用原始池子跑一次 solver。如果有候选方案包含这个意图 → 返回 `SETTLEABLE`。

**3. 供给漏斗**（`exactCount > 0` 时）：你要的票存在吗？
- 起点：其他参与者的 LIVE 意图 offered 出来、且在托管中的票。
- 依次过滤：`eventId` → `sessionMask` 位 → `sectionMask` 位，每一步记下剩余数量。
- 最后一步：在剩下的票里找满足 `mustShareSession` / `mustShareSection` / `mustBeAdjacent` 的最大一组，和 `exactCount` 比较。
- **分组和相邻的判断直接调用 solver 里现有的 V5 约束函数，不要重写一份。** 两份逻辑一旦不一致，诊断就会和合约打架。
- 位判断：`((mask >> BigInt(id)) & 1n) === 1n`。
- 漏斗只证明必要条件（票存在），不证明方案存在。文案里不要把「漏斗通过」说成「能成交」。

**4. 需求检查**（`offered` 非空时）：有人要你的票吗？
- 对每张 offered 票，数有多少个其他 LIVE 意图的 eventId/session/section 条件接受它。
- 全部为 0 → 问题在「给」这一侧，放宽你自己的条件没用。答案要直接说出来。

**5. 单项放宽**：每次只改目标意图的一个条件，用 solver 假设模式重跑。
- `BUDGET`：`maxNetPay` 设为 `BUDGET_CAP`。找到了就报告用户在方案里的付款额；多个候选时取用户付款最小的那个，文案写「在找到的候选里最小」。
- `ADJACENCY_OFF`、`SHARE_SECTION_OFF`、`SHARE_SESSION_OFF`：仅当原意图打开了这个条件。
- `ADD_SECTION(s)` / `ADD_SESSION(s)`：池子里存在、但不在用户 mask 里的每个 section/session，逐个加。
- **不放宽 `exactCount` 和 `eventId`**，那等于改了用户要的东西。如果只有这两个能解开，文案直接说「按你现在要的东西，在搜索范围内没有找到」。
- 非 BUDGET 的放宽，取 solver 按已发布排序规则排第一的候选。
- 只做单项放宽。都不行就说「尝试过的单项改动都没有产生方案」，不要暗示组合一定不行。

**6. 计时。** `/agent/diagnose` 的实际运行时间和它用的 bounds 一起记录。README 里要写就只写实测值和对应的 bounds。

### 7-E `whatIf(snap, hash, changes)`

- 校验 `changes`：只接受 7-F 工具 schema 里列出的字段；金额从 USDC 转成合约单位，**用前端现有的换算函数**，不另写。
- 构造假设意图 → solver 假设模式 → `{ found, counterparties, participantCount, targetNetPay, submittable: false }`。
- 返回里写死 `submittable: false`。

### 7-F 工具定义（Claude API tool use）

```ts
export const TOOLS = [
  {
    name: "diagnose_intent",
    description:
      "Explain why a live RESHUFFLE intent has no settlement at the pinned block: " +
      "supply funnel, demand for the offered tickets, and single-condition relaxations " +
      "re-run through the solver. Read-only.",
    input_schema: {
      type: "object",
      properties: { intentHash: { type: "string" } },
      required: ["intentHash"],
    },
  },
  {
    name: "what_if",
    description:
      "Re-run the solver with the user's own intent hypothetically changed. " +
      "The result is never submittable; the user would have to sign a new intent.",
    input_schema: {
      type: "object",
      properties: {
        intentHash: { type: "string" },
        changes: {
          type: "object",
          properties: {
            maxNetPayUsdc: { type: "number", description: "positive = pay up to, negative = must receive at least" },
            mustBeAdjacent: { type: "boolean" },
            mustShareSection: { type: "boolean" },
            mustShareSession: { type: "boolean" },
            addSections: { type: "array", items: { type: "integer" } },
            addSessions: { type: "array", items: { type: "integer" } },
          },
        },
      },
      required: ["intentHash", "changes"],
    },
  },
  {
    name: "pool_overview",
    description: "Counts of live intents and escrowed tickets by session and section at the pinned block.",
    input_schema: { type: "object", properties: {} },
  },
];
```

LLM 的决策发生在这里：「为什么我换不了」→ 调 `diagnose_intent`；「如果我接受 Tier 2 呢」→ 调 `what_if` 并把 Tier 2 映射成 section id；「现在池子里有什么」→ 调 `pool_overview`。section/session 的名字到 id 的映射放进 system prompt（从你的演示数据生成）。

### 7-G `narrate.ts`

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();                            // reads ANTHROPIC_API_KEY
const MODEL = process.env.AGENT_MODEL ?? "claude-sonnet-5";
const big = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v); // JSON can't serialize BigInt

export async function ask(snap: Snapshot, intentHash: `0x${string}`, question: string) {
  const log: { tool: string; input: unknown; output: unknown }[] = [];

  const run = async (name: string, input: any) => {
    const output =
      name === "diagnose_intent" ? await diagnose(snap, input.intentHash) :
      name === "what_if"         ? whatIf(snap, input.intentHash, input.changes) :
      name === "pool_overview"   ? poolOverview(snap) :
      { error: `unknown tool ${name}` };
    log.push({ tool: name, input, output });
    return output;
  };

  const messages: Anthropic.MessageParam[] = [{
    role: "user",
    content: `Selected intent: ${intentHash}\nPinned block: ${snap.block}\nQuestion: ${question}`,
  }];

  for (let turn = 0; turn < 4; turn++) {
    const res = await client.messages.create({
      model: MODEL, max_tokens: 700, system: SYSTEM_PROMPT, tools: TOOLS, messages,
    });
    if (res.stop_reason !== "tool_use") {
      const text = res.content.filter(b => b.type === "text").map(b => (b as any).text).join("\n");
      return guard(text, log, snap.block);
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const b of res.content) {
      if (b.type !== "tool_use") continue;
      const out = await run(b.name, b.input);
      results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out, big) });
    }
    messages.push({ role: "assistant", content: res.content }, { role: "user", content: results });
  }
  return guard("", log, snap.block);                      // loop exhausted → template
}
```

`SYSTEM_PROMPT`（英文，因为 UI 和评委是英文）：

```
You explain RESHUFFLE settlement results for one selected intent.
You decide nothing yourself: every fact you state must come from a tool result in this conversation.

Rules:
- Begin with "At Arc Testnet block #<block>," using the pinned block.
- If no settlement was found, say "no settlement was found within the search bound".
  Never say a solution does not exist. Never use: optimal, best price, guaranteed, no risk,
  impossible, locked, eliminates.
- When a relaxation produced a settlement, call it "the smallest change among those tried".
- If the supply funnel reached zero, name the stage where it reached zero.
- If nobody accepts the offered tickets, say that changing the user's own conditions will not help.
- A what-if result is hypothetical: the user would have to sign a new intent; nothing moves until then.
- Mention only addresses, ticket ids and amounts that appear in tool results.
- At most four sentences, then one concrete next action.

Section ids: <generated from demo data, e.g. 0=Floor, 1=Tier 1, 2=Tier 2>
Session ids: <generated from demo data>
```

### 7-H `guard.ts`

```ts
const BANNED = /\b(optimal|best price|guaranteed|no risk|impossible|locked|no solution exists|eliminates)\b/i;

export function guard(text: string, log: unknown[], block: bigint) {
  const evidence = JSON.stringify(log, big).toLowerCase();
  const addrs = text.match(/0x[0-9a-fA-F]{40}/g) ?? [];
  const ok =
    text.length > 0 &&
    !BANNED.test(text) &&
    text.includes(`#${block}`) &&
    addrs.every(a => evidence.includes(a.toLowerCase()));
  return ok
    ? { answer: text, guardFallback: false, evidence: log }
    : { answer: renderTemplate(log, block), guardFallback: true, evidence: log };
}
```

`template.ts` 给每个 status 一句确定性文案，比如：
- `SETTLEABLE`：At Arc Testnet block #N, a settlement including your intent was found with K participants. Use Propose and settle to execute it.
- `EXCLUDED`：At Arc Testnet block #N, your intent is excluded from matching: ticket #7 is no longer in escrow.
- `NOT_FOUND_WITHIN_BOUND`：At Arc Testnet block #N, no settlement was found within the search bound. The smallest change among those tried: raise your limit to 30 USDC.

`guardFallback` 放进响应里，你自己调试时看；UI 不显示。

### 7-I `routes.ts`

```
POST /agent/ask
  body: { intentHash, question, minBlock? }
  → { answer, guardFallback, evidence, block, model }

GET /agent/diagnose/:intentHash?minBlock=
  → Evidence            // no LLM, no Anthropic key — judges can run this directly
```

- 请求开头 `const snap = await getPoolSnapshot(BigInt(minBlock ?? 0))`，整个请求只用这一个快照。
- `GraphError` 里如果是「还没索引到这个区块」→ 返回 409 和 `{ indexedBlock }`，前端继续等。
- 按 IP 限流；请求设超时。
- `ANTHROPIC_API_KEY` 只在后端。

---

## 第 8 步：前端 Agent 抽屉

**入口**
- 每一行意图上一个按钮：Why no match?
- 页面上一个常驻按钮打开抽屉，默认选中当前演示参与者的意图。

**头部（一直可见）**
- `Live · Arc Testnet block #N · via The Graph`，N 取 `evidence.block`。
- 旁边小字：`chain head #M · lag K`，M 来自 RPC `getBlockNumber()`。滞后公开显示，不藏。

**状态机**
- `idle` → 刚发完交易 → `indexing`（显示 Indexing block #M…，Ask 按钮禁用）→ `waitForIndexed` 返回 → `idle`
- `idle` → 提问 → `asking` → `answered`
- 任何一步出错 → `error`，把 `SubgraphLagTimeout` / `SubgraphIndexingError` 原样显示成一行说明

**内容**
- 三个建议问题：Why can't this intent settle? / What if I drop the adjacency requirement? / What if I accept another section?
- 回答文本。
- Evidence 折叠面板，默认收起：漏斗表（每阶段剩余数量）、放宽表（✓ / ✗、对手方、付款额）、对手方地址链接到 Arcscan 上他们的 `committedTx`、一行 bounds。
- 改完预算后 `newHash` 自动替换当前选中的意图。

**文案**
全部来自现有的 copy constants 模块，同一套禁用词规则。

---

## 第 9 步：测试

**快照解析**（`shared/graph/snapshot.test.ts`，mock `gql`）
- 字段被篡改一个 → `HASH_MISMATCH`
- offered 里有 id 没有 Ticket 实体 → `TICKET_UNKNOWN`
- offered 票被 withdraw → `TICKET_NOT_IN_ESCROW`，detail 是票号
- deadline 早于区块时间 → `EXPIRED`
- `maxNetPay` 为负数的意图哈希能对上（测有符号转换）

**诊断**（`backend/agent/test/diagnose.test.ts`）
- 先写 `scripts/capture-snapshot.ts`：把 subgraph 的原始 GraphQL 响应存成 `fixtures/snapshot-<block>.json`。测试走同一条解析路径，结果确定。
- 每个用例断言**具名结果**，不是「非空」：
  - 相邻被卡：`firstZero === "adjacentRun"`，`ADJACENCY_OFF` 的 `found === true`
  - 预算被卡：漏斗和需求都通过，`maxNetPay→cap` 的 `found === true`，`targetNetPay` 等于期望值
  - section 被卡：`firstZero === "section"`，对应 `addSection=<id>` 的 `found === true`
  - 没人要你的票：`demand.unwanted` 等于全部 offered
  - 已撤销：`status === "CLOSED"`，`closed.state === "REVOKED"`
  - 能成交：`status === "SETTLEABLE"`
- 假设模式：返回值 `submittable === false`；把假设结果传给 `/settle` 必须被拒绝。

**guard**
- 含禁用词 → 走模板
- 出现证据里没有的完整地址 → 走模板
- 区块号不对 → 走模板

**链上对账**
- `check-subgraph-parity.ts` 在 Arc Testnet 上 PASS。

**端到端（手动）**
- 按第 10 步的演示顺序完整走一遍，确认区块号在跳、答案在变。

---

## 第 10 步：演示接线（run of show 里 The Graph 那一段）

### 10-A 录之前的准备

1. 演示池设计成：参与者 X 的意图在预算 30 时能和 A、B 组成三方方案，降到 15 时找不到。
2. 录之前用 `GET /agent/diagnose/<X 的哈希>` 确认两种预算下的结果都符合预期。**初始数据可以预置，结果不能预置**——agent 的回答必须是现场算出来的。
3. 按 4-A 实测过的索引延迟排好节奏。

### 10-B 操作顺序

| 拍 | 操作 | 画面上必须看到的 | 背后是什么 |
|---|---|---|---|
| 1 | 抽屉打开，选中 X | `Live · Arc Testnet block #N · via The Graph` | 快照的 `_meta.block` |
| 2 | judge 控件 Apply budget 30→15 | receipt 面板出现 revoke 和 commit 两个 tx hash | 6-D，真实链上交易 |
| 3 | 等索引 | `Indexing block #M…` → 头部区块号跳到 ≥ M，选中意图切到新哈希 | 6-B 的 `waitForIndexed` |
| 4 | 点 Why can't this intent settle? | 回答以 `At Arc Testnet block #M` 开头，说出卡住的是预算、在尝试过的改动里最小的是回到 30、对手方是 A 和 B | `/agent/ask` → `diagnose_intent` |
| 5 | 展开 Evidence | 漏斗每一步都非零、`maxNetPay→cap ✓`、`mustBeAdjacent=false ✗`、Arcscan 链接 | 证据 JSON |
| 6（可选） | 问 What if I drop adjacency? | 回答说明这个改动没有产生方案，而且是假设 | `what_if` |

区块号变化、答案变化这两拍各停一秒。赶过去就看不出数据是活的。

### 10-C 剪辑规则

- 等索引的空白可以剪掉；**不能加速视频**，这是 ETHGlobal 的硬规则。
- 剪完后保证画面上区块号从 N 跳到 M 的那一帧还在。

---

## 第 11 步：README 与提交

### 11-A README 的 The Graph 章节（英文，直接改写）

```markdown
## The Graph

### Why an indexer is structurally required
`IntentRegistry` stores only `hash → state`. Every matching condition exists on-chain only
inside the `IntentCommitted` event, and Solidity mappings cannot be enumerated.
This implementation relies on The Graph to reconstruct the live intent pool.

### What is indexed
| Contract | Event | Entity effect |
|---|---|---|
| TicketNFT | Transfer | Ticket custody (escrowed / depositor / owner), metadata on mint |
| TicketNFT | TicketRedeemed | Ticket.redeemed |
| IntentRegistry | IntentCommitted | Intent (all signed fields), state LIVE |
| IntentRegistry | IntentRevoked | Intent state REVOKED |
| Settlement | Settled | Settlement; listed intents → SETTLED |

### Trust model
1. **Hash binding.** Every intent read from the subgraph is re-hashed off-chain with the same
   `hashIntent()` used for signing and must equal its committed id, or it is excluded.
2. **Freshness floor.** Reads after a user transaction use `block: { number_gte }`, so they
   are never older than that transaction.
3. **On-chain re-validation.** The subgraph is discovery. Settlement re-checks V1–V8 on every
   proposal; index lag can cause a failed simulation, never an invalid settlement.

Parity check at block <N>: <paste scripts/check-subgraph-parity.ts output>

### Endpoint
<Studio query URL> — example query: <PoolSnapshot>

### Agent
Pinned snapshot → deterministic diagnosis (supply funnel, demand check, single-condition
relaxations re-run through the solver) → LLM narration constrained to the evidence.
Read-only: the agent holds no keys and cannot submit.
`GET /agent/diagnose/:intentHash` returns the evidence without any LLM key.

### Limitations
- No settlement found means none found within the published search bound.
- Only single-condition relaxations are tried.
- Counterfactuals hold at the pinned block; the pool can change afterwards.
- Adjacency is checkable only because we issue the tickets.
```

### 11-B 环境变量表（写进 README）

| 变量 | 用在 | 说明 |
|---|---|---|
| `DEPLOYMENT` | 全部 | `arc-testnet`，决定读哪个 `deployments/*.json` |
| `SUBGRAPH_URL` | 后端 | Studio 的 Query URL |
| `GRAPH_API_KEY` | 后端 | 可选；Studio 的查询 key |
| `NEXT_PUBLIC_READ_SOURCE` | 前端 | `graph`（Arc Testnet）/ `rpc`（本地 Anvil） |
| `ARC_RPC_URL` | 后端、前端 | Arc Testnet RPC |
| `ANTHROPIC_API_KEY` | 后端 | 只有 `/agent/ask` 需要 |
| `AGENT_MODEL` | 后端 | 默认 `claude-sonnet-5` |
| `BUDGET_CAP_USDC` | 后端 | BUDGET 放宽用的上限 |

README 里写清楚：评委没有 Anthropic key 也能跑 `/agent/diagnose`，看到完整证据。

### 11-C 提交表

1. Partner prizes 选 Arc 和 The Graph。
2. The Graph 那一栏：
   - 怎么用的：贴 11-A 的前两段加 Agent 那段。
   - 声明：`The Graph — Best AI Tooling or AI Use Case with The Graph (From Scratch) · AI Use Case path · Start Fresh pool`
   - 反馈：只写你实际遇到的，例如 arc-testnet 的部署体验、实测的索引延迟、`number_gte` 是否好用。没验证过的不要写。
3. AI 使用说明：README 单独一节，列出哪些文件由 AI 生成或辅助。PRD、TRD、AGENTS.md、SKILL.md、UI spec、**这份文件**全部放进 repo 的 `docs/`。ETHGlobal 规则要求 spec-driven 的规划文件都要提交。

---

## 第 12 步：Arc 主网（9 月 30 日前，为了 Arc 那 $2,500）

1. 合约部署到 Arc 主网 → `export-deployment` → `deployments/arc.json`。网络名以 The Graph 文档的 Arc Mainnet 页面为准。
2. Studio 里**新建**一个 subgraph `reshuffle-arc`，不复用 testnet 那个。
3. `gen-subgraph-config arc` → `graph build --network <主网名>` → `graph deploy reshuffle-arc --network <主网名> --version-label v1.0.0`。
4. 改 env：`DEPLOYMENT=arc`、`SUBGRAPH_URL` 换成主网的。
5. EIP-712 domain 换成主网的 `chainId` 和新的 `verifyingContract`；testnet 的意图在主网上全部无效，这是设计如此。
6. 重灌数据 → 跑 parity → 跑一遍 `/agent/diagnose`。
7. testnet 的 subgraph 保留，提交里的链接指向它。

---

## 砍功能的顺序

**最小合格版，必须保留：**
1. 第 0 步的检查
2. subgraph：`Ticket` + `Intent`（按 C3 的结果处理结算标记）
3. parity 脚本（读 latest 即可）
4. 快照 + 哈希绑定；solver 从快照读池；`/solve` 返回 `snapshotBlock`
5. Apply budget 真实上链 + `waitForIndexed`
6. `diagnose`：排除原因 + 供给漏斗 + `BUDGET` + `ADJACENCY_OFF`；`/agent/ask` 只挂 `diagnose_intent`；guard 和模板
7. 抽屉：区块号 + 回答 + Evidence
8. README 的 Graph 章节 + 赛道声明

**按这个顺序砍：**
`what_if` → `pool_overview` → `SettlementLeg` 和 `getSettlements` 走 subgraph → `getTicketsFor` / `getSeatCustody` 走 subgraph（保留 RPC）→ 抽屉的 lag 显示 → `ADD_SECTION` / `ADD_SESSION` 放宽 → 按历史区块的 parity

**整条线放弃的条件：**
第 0 步要求改合约，而你承担不起重部署加重灌数据 → The Graph 整条砍掉。只有 subgraph 没有 agent，拿不到任何一个 Graph 奖。

---

## 完成判定（全部打勾才算接完）

- [ ] `docs/graph-audit.txt` 存在，C1–C6 每项都有结论
- [ ] `deployments/arc-testnet.json` 是地址的唯一来源，repo 里 grep 不到手抄的合约地址
- [ ] Studio 上 `reshuffle-arc-testnet` 显示 Synced，没有 indexing error
- [ ] parity 脚本 PASS，输出贴在 README
- [ ] 索引延迟有实测记录
- [ ] solver 日志显示 `pool source: subgraph @ block N`，`/solve` 响应带 `snapshotBlock`
- [ ] 任何链上操作后，UI 先显示 `Indexing block #M`，再刷新；没有读到旧池的情况
- [ ] Apply budget 产生两个真实 tx hash，抽屉切到新哈希
- [ ] 没有 Anthropic key 时 `/agent/diagnose/:hash` 能返回完整证据
- [ ] `/agent/ask` 的回答以区块号开头；guard 的三个测试通过
- [ ] 诊断测试用具名结果断言，全部通过
- [ ] copy 模块和 agent 测试输出里 grep 不到禁用词
- [ ] README 有：为什么需要索引器、索引了什么、信任模型、endpoint、agent、运行步骤、env 表、局限、赛道声明、AI 使用说明
- [ ] 视频里区块号 N → M 和答案变化两拍都在，没有加速
