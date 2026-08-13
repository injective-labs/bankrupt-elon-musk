# Bankrupt Elon Musk — React / TS / Tailwind

INJ Pass 夏季特别活动小游戏的 React + TypeScript + Tailwind (Next.js) 重写版。
功能与原 `bankrupt-elon-musk/`(vanilla JS)一致:500 亿美元模拟资金,在
约 750 个全球资产里加杠杆买卖,看能否把账户玩到爆仓;并新增**连接 INJ Pass 钱包**。

## 技术栈

- Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4
- `@injpass/cli`(INJ Pass 官方连接器 SDK,经 pnpm 安装)
- 行情:Yahoo Finance,经 `app/api/chart/route.ts` 同源代理(移植自原 `server.py`)
- **前后端一体**:内置后端用 Next Route Handlers(`app/api/auth/*`、`app/api/state`、`app/api/leaderboard`)
  + **Prisma + Postgres(规范化多表)**,钱包签名登录(`viem` 验签 + `jose` JWT)。与 inj-pass-backend 零依赖。

## 数据库(规范化)

数据库定义见 [prisma/schema.prisma](prisma/schema.prisma)。`Player` 保存服务端资金，`Position`
保存当前持仓，`Transaction` 是不可变的买入、卖出和重置账本。`Asset` 保存 161 个可交易资产，
`AssetQuote` 保存每个资产的权威最新报价，`AssetDailyPrice` 只从上线后的刷新任务开始逐日积累；
部署不会回填历史行情。排行榜完全根据数据库中的现金、持仓和权威报价计算，不接受客户端 P&L。

## 运行

```bash
pnpm install

# 启动一个本地 Postgres,并把连接串写进 .env(见 .env.example)
docker run -d --name bankrupt-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=bankrupt_elon -p 5433:5432 postgres:16

pnpm prisma generate           # 生成 Prisma Client
pnpm prisma migrate deploy     # 在全新库上套用 prisma/migrations 建表
pnpm prisma db seed            # 幂等写入 161 个资产

pnpm dev                       # http://localhost:3002
```

构建:`pnpm build && pnpm start`。没有 Postgres 时游戏仍可玩(仅本地 localStorage 存档);
云存档需要 `DATABASE_URL` 可用。

## 部署、检查与恢复

生产部署严格按以下顺序执行。迁移只向前应用，种子为幂等 upsert：

```bash
pnpm install --frozen-lockfile
pnpm prisma migrate deploy
pnpm prisma db seed
pnpm test
pnpm build
```

资产目录发生变化时（例如新增 TSLA），seed 后必须在开放交易前主动刷新一次行情，不能只等待
每天的 Vercel cron。`MUSK_DEPLOYMENT_URL` 指向即将发布或当前兼容的 Musk 部署：

```bash
MUSK_DEPLOYMENT_URL=https://bankrupt-elon-musk-next.vercel.app
curl --fail --silent --show-error \
  -H "Authorization: Bearer $CRON_SECRET" \
  "$MUSK_DEPLOYMENT_URL/api/cron/refresh-market"
psql "$DATABASE_URL" -c \
  "SELECT a.id, a.ticker, a.\"quoteSymbol\", q.status, q.\"marketDate\" FROM \"Asset\" a LEFT JOIN \"AssetQuote\" q ON q.\"assetId\" = a.id WHERE a.id = 'tesla-basket';"
```

验收结果必须存在 `tesla-basket / TSLA / TSLA`，且报价状态为 `ACTIVE`，然后才部署或开放
依赖该资产的 Chat 命令。

另外单独运行数据库集成验证。此命令自行创建干净的本地一次性 PostgreSQL 容器，应用迁移，
连续执行两次种子以验证幂等性，串行运行数据库测试，并在结束时删除容器；它不会读取或连接生产
`DATABASE_URL`：

```bash
pnpm test:integration
```

部署后用只读 SQL 检查资产报价数、逐日价格数和交易账本。以下命令读取当前环境的
`DATABASE_URL`，不会修改数据：

```bash
psql "$DATABASE_URL" -c 'SELECT COUNT(*) AS assets, COUNT(q."assetId") AS quotes FROM "Asset" a LEFT JOIN "AssetQuote" q ON q."assetId" = a.id;'
psql "$DATABASE_URL" -c 'SELECT COUNT(*) AS daily_prices, MIN("marketDate") AS first_date, MAX("marketDate") AS last_date FROM "AssetDailyPrice";'
psql "$DATABASE_URL" -c 'SELECT id, "walletAddress", type, "assetId", quantity, "usdAmount", "cashAfter", "createdAt" FROM "Transaction" ORDER BY id DESC LIMIT 20;'
```

要关闭游戏重置，在运行环境中设置变量并重新部署应用：

```bash
ENABLE_GAME_RESET=false
```

应用版本需要回退时，只回滚应用部署，不执行降级迁移，也不删除新表或新数据。Vercel 部署可用：

```bash
vercel rollback <previous-production-deployment-url>
```

回退后再次运行上面的三条只读检查命令，确认报价、逐日价格和交易账本仍然存在。若旧应用版本
与已向前迁移的 schema 不兼容，应部署一个兼容性修复版本；不要运行 `prisma migrate reset`、
`prisma db push --force-reset` 或手工删除生产数据。

## 行情来源

股票/加密/商品的实时价来自 **Yahoo Finance**:客户端走同源代理 `/api/chart` →
`query1.finance.yahoo.com/v8/finance/chart/{symbol}` 取每日收盘价;汇率走 `XXXUSD=X`;
美股收盘(纽约 16:00)后刷新,断网/失败回落到 `FALLBACK_FX` 与内置快照。
注:这是免费的非官方接口,无 API key、可能限流——适合演示,生产建议换有 SLA 的行情商。

## 真实英文资产名

`scripts/fetch-asset-names.mts` 在构建期从 Yahoo 抓取各 ticker 的英文名,生成
`src/data/assetNames.ts`(已提交,运行期零开销)。重跑刷新:

```bash
node --experimental-strip-types scripts/fetch-asset-names.mts
```

未命中的冷门 ticker 回落到 `TICKER · <英文类别>`(仍为纯英文)。

## 云存档(连接钱包后)

连接 INJ Pass 钱包后，游戏通过服务端 nonce 和 EIP-191 签名验证钱包所有权。独立站调用
`/api/auth/verify` 获取第一方 HttpOnly Cookie；运行在 INJ Pass iframe 中时调用
`/api/auth/agent-verify` 获取仅存于内存的短期 scoped Bearer，避免依赖第三方 Cookie。
余额、持仓、模拟成交和排行榜均以 Musk 服务端数据库为准。

不同类型 dApp 的宿主 session、链上签名、服务端 Bearer、自定义宿主 RPC 和 Chat Agent
选型见 [INJ Pass dApp 接入模式与选型](docs/INJPASS_DAPP_INTEGRATION_PATTERNS.md)。

## 连接 INJ Pass(仅钱包连接)

游戏顶栏的「连接 INJ Pass」通过 `@injpass/cli` 连接器,以浮窗 iframe +
弹窗 passkey 登录,登录后显示钱包地址/名称,并可签名。游戏本身仍是模拟资金,
不接后端 NINJA 积分。

配置 `.env.local`(见 `.env.example`):

```bash
NEXT_PUBLIC_INJPASS_EMBED_URL=http://localhost:3000/embed
```

`embedUrl` 必须指向**正在运行的** `inj-pass-frontend` 的 `/embed`。
因此连接前需先启动 inj-pass-frontend(默认 3000 端口);本游戏跑在 3002 以避免冲突。
`next.config.ts` 已据该地址放行 CSP `frame-src`。

## AgentOS Chat Mini-App

Elon 也可作为 INJ Pass AgentOS mini-app 被 Chat 直接调用。INJ Pass 通过隐藏 iframe
发送 `injpass-miniapp-v1` 命令；Elon 仍使用自己的服务端权威报价、余额、持仓与成交逻辑，
不会执行真实资产或链上交易。

本地联调端口：

```text
inj-pass-frontend  http://localhost:3000
inj-pass-backend   http://localhost:3001
Elon game          http://localhost:3002
Elon PostgreSQL    localhost:5433
```

INJ Pass 前端需配置：

```bash
NEXT_PUBLIC_BANKRUPT_ELON_APP_URL=http://localhost:3002
```

Elon 需配置精确的可信宿主：

```bash
NEXT_PUBLIC_INJPASS_EMBED_URL=http://localhost:3000/embed
NEXT_PUBLIC_INJPASS_ALLOWED_HOST_ORIGINS=
```

生产环境接受 `NEXT_PUBLIC_INJPASS_EMBED_URL` 对应的精确 origin；如同一部署还需嵌入
官方测试前端，可通过逗号分隔的 `NEXT_PUBLIC_INJPASS_ALLOWED_HOST_ORIGINS` 增加其他
精确 HTTP(S) origin。未列出的父页面以及无效配置都会被拒绝；开发环境额外允许
`http` loopback 地址。

例如，保留正式钱包连接并同时允许 INJ Pass test：

```bash
NEXT_PUBLIC_INJPASS_EMBED_URL=https://www.injpass.com/embed
NEXT_PUBLIC_INJPASS_ALLOWED_HOST_ORIGINS=https://inj-pass-frontend-test.vercel.app
```

首次执行账户查询或模拟买卖时，Elon 会请求当前 INJ Pass 钱包签名，并签发仅存于
iframe 内存、有效期 15 分钟的 `game:read game:trade` bearer。钱包切换或鉴权失败会清除它。

Chat 示例：

```text
@Bankrupt Elon Musk 查询 TSLA 行情
@Bankrupt Elon Musk 查看余额
@Bankrupt Elon Musk 查看持仓
@Bankrupt Elon Musk 买入 1 股 TSLA
@Bankrupt Elon Musk buy all doges coin with my virtual assets
@Bankrupt Elon Musk show my last 5 trades
@Bankrupt Elon Musk sell all TSLA
```

完整且无歧义的买卖命令会立即执行模拟交易；资产或数量缺失、资产名歧义时不会成交。
Chat 解析层会移除 `with my virtual assets` 等资金来源修饰，Elon 执行层再把常见别名
（例如 `dogecoin`、`doge coin`、`doges coin`）解析到权威资产目录；最终仍只允许目录中存在且
有可用服务端报价的资产成交。
成交价、金额、成交 ID 和成交后状态只采用 Elon 服务端回执。

## 结构

- `src/data/` — 常量、产品目录、市场分组、扩展资产生成、分类标签(逐字移植)
- `src/i18n/` — 中英双语字符串与 `t()`/`labelFrom()`
- `src/game/` — `engine.ts`(纯游戏公式 + 交易/杠杆/清算)、`pricing.ts`、`marketClock.ts`、`format.ts`
- `src/state/` — `GameProvider`(Context+commit 模型)、`persistence`(localStorage,沿用旧存档 key)
- `src/sound/` — Web Audio 音效
- `src/wallet/` — `InjPassProvider` + `ConnectButton`
- `src/agentos/` — AgentOS 协议、可信宿主、内存鉴权、资产解析与命令桥接
- `src/components/` — TopBar / FxTicker / PortfolioPanel / MarketPanel / ProductCard / FinancePanel
- `app/api/chart/route.ts` — Yahoo 行情代理
