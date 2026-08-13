# INJ Pass dApp 接入模式与选型

本文记录当前几个 dApp 的实际接入方式，并给后续应用提供认证与执行层的选型预案。
这里的“INJ Pass 已登录”只代表宿主已经选择并解锁钱包；它可以安全地用于展示钱包身份，
但不能自动替代独立 dApp 后端所需的请求授权。

## 所有 mini app 的共同基础

外部 dApp 在 INJ Pass 中运行于独立 origin 的 iframe。应用使用
`InjPassMiniAppConnector` 接收经过 origin 和 `event.source` 校验的
`injpass-miniapp-v1` 会话，并通过宿主 EIP-1193 Provider 请求签名或交易。宿主 manifest
限制应用可用的权限、链、RPC 和合约。

必须遵守以下边界：

- `session.authenticated/address/walletName` 可作为 UI 当前身份，不可单独作为远程后端的
  写权限凭证。
- 私钥始终留在 INJ Pass。dApp 只接收签名、交易哈希或受限操作结果。
- 外部 iframe 不依赖第三方 Cookie。跨站 iframe 中即使服务端成功设置
  `SameSite=Lax` Cookie，后续 `fetch` 也不会携带它；`SameSite=None` 仍可能被浏览器的
  第三方 Cookie 策略拦截。
- Bearer 不写入 localStorage、sessionStorage、URL、日志或聊天内容；只放内存并设置短期
  audience/scope/expiry。
- `Authorization` 存在但无效时必须失败，不能静默回退到 Cookie。

## 当前 dApp 对比

| dApp / 场景 | 权威状态 | 钱包身份来源 | 写操作如何授权 | dApp 自有会话 | 适用模式 |
| --- | --- | --- | --- | --- | --- |
| INJ Gift 可视应用 | Injective EVM 合约 | 宿主 session + EIP-1193 Provider | `eth_sendTransaction` 或 EIP-712；每次链上写入自身带签名 | 不需要 | 纯链上 dApp |
| INJ Gift Chat 创建 | 合约；命令在宿主执行 | INJ Pass 当前钱包 | 宿主直接构造受 manifest 限制的交易并广播 | 不需要 | 高频、可明确约束的宿主原生操作 |
| Eric Mfer | CatNFT 合约 + 宿主索引 | 同源 mini app 的宿主 session | 自定义 `injpass_mintCatNft` RPC；宿主负责白名单、签名与赞助 gas | 不需要 | 宿主专用/赞助能力 |
| Omisper | XMTP 网络与本地 XMTP 客户端 | 宿主 session + 钱包签名 | 钱包签名初始化 XMTP 身份，消息由 XMTP 客户端发送 | 不依赖 iframe Cookie | 签名建立协议身份 |
| Musk 可视游戏（嵌入） | Musk Postgres 与服务端交易逻辑 | 宿主 session 用于 UI；签名 nonce 证明所有权 | `/api/auth/agent-verify` 签发 15 分钟 `game:read game:trade` Bearer | 内存 Bearer | 服务端权威 dApp |
| Musk 独立站 | Musk Postgres 与服务端交易逻辑 | 浮动 INJ Pass Connector | 签名 nonce 后签发 7 天 HttpOnly、`SameSite=Lax` Cookie | 第一方 Cookie | 顶层独立网站 |
| Musk Chat Agent | Musk Postgres 与服务端交易计划 | 后端模型选择白名单工具；隐藏 iframe 收到宿主 session | 读取直接返回；交易先 prepare，再由 INJ Pass 展示确认、签名并 execute | 内存 Bearer + 服务端 TradePlan | 自然语言、多资产、服务端权威交易 |
| Omisper Chat Agent | Omisper 执行层 | 隐藏 iframe 收到的宿主 session | `agent-command` 只描述受控意图；执行层仍使用协议身份 | 按 Omisper 协议 | 规则明确的 iframe 命令 |

## 四类接入预案

### A. 纯链上 dApp

适用于资产、红包、NFT 或合约状态由链上决定的应用。读取使用公共 RPC，写入通过宿主
Provider 的 `eth_sendTransaction` 或 typed data 签名。因为每次写入都有链上签名，通常
不需要再建立 dApp Cookie 会话。

参考：INJ Gift。manifest 必须配置准确的 chain ID、RPC、`transactions`/`sign` 权限和
`allowedContracts`。服务端 relayer 若参与执行，应验证 typed data、nonce、deadline、链和
合约，而不是相信前端提交的地址。

### B. 服务端权威 dApp

适用于余额、库存、游戏进度、交易账本或权限保存在 dApp 数据库中的应用。宿主 session
只能告诉 UI 当前选择的钱包；dApp 后端仍需密码学证明。

嵌入流程：

1. dApp 后端创建短期、一次性 nonce，并绑定规范化钱包地址。
2. iframe 通过宿主 Provider 签名 nonce。
3. 后端验签并签发短期、audience/scope 受限的 Bearer。
4. iframe 在内存中保存 Bearer，并在查询和写操作上显式发送。
5. 钱包切换、宿主退出、Bearer 401 或过期时立即清空 dApp 私有状态和 Bearer。

参考：Bankrupt Elon Musk。独立顶层访问仍可使用 Secure、HttpOnly、SameSite Cookie；
同一个客户端 facade 根据运行上下文选择 Cookie 或 Bearer，业务 API 与响应验证保持一致。

### C. 宿主专用能力 dApp

适用于 gas 赞助、托管 relayer、受控铸造或必须由 INJ Pass 组合多项安全检查的操作。为该
能力定义窄而明确的 RPC，例如 `injpass_mintCatNft`；宿主按 app ID、manifest 权限、合约、
链和当前钱包验证后执行。

参考：Eric Mfer。不要暴露通用“任意代调用”RPC，也不要让 mini app 提交可覆盖的私钥、
from 地址或任意目标合约。

### D. Chat Agent dApp

适用于在 Chat 中通过 `@应用` 解析并执行意图。简单、封闭的命令可以由宿主确定性解析；
需要理解自由表达、多资产组合、百分比或上下文的应用，应由模型选择该 dApp 白名单内的
typed tool。两种方式最终都由宿主用带关联 ID 的 `agent-command` 发送结构化命令，dApp
返回一次 `agent-command-result`。该协议负责调用与结果关联，不负责绕过底层授权：

- 链上命令仍走交易/typed-data 签名；
- 服务端权威命令仍走 nonce + scoped Bearer；
- XMTP 等协议仍需其自身签名身份；
- 公开查询可以匿名执行。

参考：Musk AgentOS、Omisper Agent bridge 和 INJ Gift 命令。对买卖、发消息、领红包等
不可逆操作，命令解析必须无歧义，服务端或链上回执才是最终结果。模型只能把自然语言转换为
schema 允许的意图参数，不能提交价格、余额、成交结果或任意 URL。dApp 执行层再把资产名或
ticker 解析为权威资产 ID；未命中或命中多个资产时必须停止并要求澄清，不能猜测成交标的。

Musk 使用 `musk_get_balance`、`musk_get_portfolio`、`musk_get_market`、
`musk_get_history`、`musk_get_rank` 和 `musk_prepare_trade` 六个模型工具。买卖共用
`musk_prepare_trade`，它支持整数数量、现金金额、现金/持仓 basis points 和整类清仓。
游戏服务端根据当前数据库生成带哈希、过期时间和确认消息的 `TradePlan`。INJ Pass 展示每条
腿的数量、价格、金额及前后余额；批准后才签署该计划的确认消息并进入 execute phase，拒绝则
进入 cancel phase。execute/cancel 不是模型可选工具，因此模型不能伪造计划 ID 或跳过确认。
执行时服务端再次校验现金、持仓和报价快照，并在 Serializable 事务中一次写入全部交易；同一
计划重放返回原回执，不会重复成交。

## 选型决策

1. **写入的权威状态在哪里？**
   - 链上：选 A。
   - dApp 数据库：选 B。
   - 由 INJ Pass 赞助或代执行：选 C。
2. **是否需要在 Chat 中 `@应用`？**
   - 需要：在 A/B/C 的执行层外再加 D，不要用 D 替代授权。
3. **应用是否也能独立顶层打开？**
   - 可以为顶层站点保留第一方 Cookie，但嵌入态必须使用 Provider 签名或 Bearer。
4. **只有公开只读数据吗？**
   - 直接匿名读取；不要为了显示钱包名创建无意义的服务端会话。

## 上线检查清单

- 注册精确 production/test/local origin；双方 CSP `frame-ancestors` 与宿主 allowlist 一致。
- 校验 `event.origin`、`event.source`、channel、request ID，并为请求设置超时和取消路径。
- manifest 只授予必要的 `accounts`、`read`、`sign`、`transactions` 权限及合约白名单。
- 区分“宿主钱包未登录”“用户拒绝签名”“dApp 授权过期”“网络/服务端失败”，不要把所有
  401 或 RPC 错误都显示成 INJ Pass 会话过期。
- 钱包切换/退出时清理所有地址绑定的内存 token、账户投影和进行中的命令。
- 对服务端权威写操作校验 audience、scope、nonce、幂等键和服务端状态；客户端不提交
  权威余额、价格或成交结果。
- 分别测试独立站、production iframe、test iframe、Chat hidden iframe 和浏览器禁止第三方
  Cookie 的场景。
