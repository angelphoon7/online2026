# Arc Testnet 本地配置

根目录 `.env` 保存 Arc 网络参数和专用测试部署钱包私钥，已被 Git 忽略。`.env.example` 是不含真实私钥的配置模板；Next.js 读取 `.env`，不会读取 `.env.example`。

| 配置 | 值 |
| --- | --- |
| RPC | `https://rpc.testnet.arc.io` |
| chainId | `5042002` |
| USDC ERC-20 | `0x3600000000000000000000000000000000000000` |
| 浏览器 | https://testnet.arcscan.app |
| 水龙头 | https://faucet.circle.com |

参数来源：[Arc 网络参数](https://docs.arc.io/arc/references/rpc-endpoints)、[USDC 接口](https://docs.arc.io/arc/references/contract-addresses)。USDC ERC-20 接口使用 6 位小数，原生 gas 余额使用 18 位，两者对应同一底层余额。

## 领币和检查

1. 在本地 `.env` 找到 `DEPLOYER_ADDRESS`，复制这个公开地址。
2. 打开 Circle 水龙头，选择 Arc Testnet、USDC，粘贴地址并完成页面验证。
3. 在项目根目录运行 `npm.cmd run arc:check`，检查网络、USDC 精度和钱包余额。该命令只读取链上状态，不发送交易，也不输出私钥。
4. 重启开发服务器，让前端读取新的 `NEXT_PUBLIC_*` 参数。

`PRIVATE_KEY` 是本地生成的专用测试钱包密钥，不是浏览器钱包的密钥。不要添加 `NEXT_PUBLIC_` 前缀或提交到仓库。

## 部署与 seed

四个合约已部署到 Arc Testnet。完整地址、部署起始区块和每笔交易哈希保存在 `deployments/arc-testnet.json`，前端地址及 `NEXT_PUBLIC_DEPLOYMENT_BLOCK` 已写入本地 `.env`。

本机 Foundry 位于 `.tools/foundry/forge.exe`，版本为 1.8.1；Solidity 固定为 0.8.36、目标为 Paris。OpenZeppelin 固定到 5.0.2，因为原先 5.7.0 的 `MCOPY` 无法编译为 Paris。这里采用 Paris 是项目的兼容性选择；不据此声称当前 Arc 不支持 PUSH0，当前网络差异应参考 [Arc EVM 文档](https://docs.arc.io/arc/references/evm-differences)。

在项目根目录执行：

```powershell
.tools/foundry/forge.exe build
.tools/foundry/forge.exe test --gas-report
npm.cmd run arc:deploy
npm.cmd run arc:seed
npm.cmd run arc:verify
npm.cmd run arc:seed:simulate
```

实际部署与 seed 入口为 `scripts/arc-live.mjs`，使用 Node.js 20.12+、`.env` 和 Foundry 生成的 ABI/字节码。发送前检查 chainId、Paris 编译目标，并执行 `eth_call`。每笔交易确认后才进入下一步。部署钱包也是管理员和注册 issuer。

实际发送的每笔交易均有显式 gas limit：部署 8,000,000；普通合约写入 500,000；deposit 1,000,000；USDC approve 200,000；原生 USDC 转账 100,000。这些是配置上限，不是实测耗气量。USDC 写操作不调用 `eth_estimateGas`。`ARC_SCRIPT_GAS_LIMIT` 仅用于保留的 Forge 模拟入口 `arc:deploy:simulate`，不控制这个直接广播入口。

Seed 创建三个参与者，每人四张相邻票，同一个 event：A 持 Saturday Floor，B 持 Sunday Floor，C 持 Saturday Tier 1；每人要求下一组的四张相邻票。A 的付款上限为 0.1 USDC，B 为 0，C 的收款底线为 0.1 USDC。意图期限是首次 seed 链上时间起 30 天。

A 使用 `.env` 的部署钱包。B/C 的专用测试私钥保存于被 Git 忽略的 `.env.seed`，各收到 1 测试 USDC；三人对 Settlement 的额度均为 0.5 USDC。12 张票均已 deposit，三个 intent 均经 EIP-712 签署并由部署钱包 relay commit。Seed 不执行 settlement。

`.arc-journal.json` 保存恢复进度和已签名交易，被 Git 忽略。保留该文件及 `.env.seed`；中断后重新执行同一命令会复用原交易，避免重复 mint/commit。不要同时运行两个部署或 seed 进程。已经撤销、过期或结算的意图不会被该 seed 自动重置，需要重新签署新的意图。

`arc:seed:simulate` 从链上快照读取托管、票据状态、意图状态、USDC 余额与额度，交给现有 solver 搜索，再对选中方案执行最新状态的 `eth_call`；不广播结算。证据保存于 `deployments/arc-seed-evidence.json`。结果是运行时计算的，未预置成交结果。

## 打开演示

重启 `npm.cmd run dev`，打开 `/reshuffle`。将浏览器钱包切换到 Arc Testnet 并连接，即可加载链上票据和意图；按 Refresh 更新状态。需要操作 A 的票据或撤销 A 的意图时，在自己的本地钱包中导入 `.env` 的测试密钥；B/C 对应 `.env.seed`。私钥不进入网页代码。

当前页面用 RPC 日志读取意图，尚未接入 The Graph；`SUBGRAPH_URL` 和 `SUBGRAPH_API_KEY` 仍留空。`deployments/arc-testnet.json` 的 `startBlock` 与合约地址可用于后续索引配置。这次部署与 seed 不代表网页已公开托管。

切换网络或重部署 IntentRegistry 后，EIP-712 的 chainId / verifyingContract 会变化，原来的意图签名不能沿用，必须重新签署并提交。
