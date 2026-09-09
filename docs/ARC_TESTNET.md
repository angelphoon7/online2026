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

## 尚待部署

网络配置不代表应用合约已经部署。需要可用的 Foundry、已领币的部署钱包，以及部署前合约检查。部署入口是 `script/Deploy.s.sol`，脚本读取 `.env` 的 `PRIVATE_KEY`，使用对应账户广播，并将该账户注册为 issuer。

安装 Foundry 和项目 Solidity 依赖后，在项目根目录执行：

```powershell
forge build
forge test -vvvv
npm.cmd run arc:deploy:simulate
# 检查模拟结果后，以下命令才会真正发送部署交易：
npm.cmd run arc:deploy
```

部署入口使用 Node.js 20.12+，读取 `.env`。`foundry.toml` 和部署命令均显式指定 `paris`，RPC 别名 `arc_testnet` 读取 `ARC_RPC`。

`.env` 的 `ARC_SCRIPT_GAS_LIMIT=30000000` 通过 `--gas-limit` 传给 Forge。这是脚本执行预算，不是实测耗气量，也不是每笔广播交易的固定 gas 上限。每笔交易仍由 Forge 估算 gas，部署命令显式设置 `--gas-estimate-multiplier 130`；`--slow` 等待前一笔交易确认后再发送下一笔。保留模拟步骤，不使用 `--skip-simulation`。

部署成功后，将真实地址填写到 `.env` 的 `NEXT_PUBLIC_TICKET_NFT`、`NEXT_PUBLIC_ESCROW`、`NEXT_PUBLIC_INTENT_REGISTRY`、`NEXT_PUBLIC_SETTLEMENT`。`SUBGRAPH_URL` 和 `SUBGRAPH_API_KEY` 需要真实索引服务配置，目前留空。

切换网络或重部署 IntentRegistry 后，EIP-712 的 chainId / verifyingContract 会变化，原来的意图签名不能沿用，必须重新签署并提交。
