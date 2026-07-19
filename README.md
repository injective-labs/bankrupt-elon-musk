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
保存当前持仓，`Transaction` 是不可变的买入、卖出和重置账本。`Asset` 保存 160 个可交易资产，
`AssetQuote` 保存每个资产的权威最新报价，`AssetDailyPrice` 只从上线后的刷新任务开始逐日积累；
部署不会回填历史行情。排行榜完全根据数据库中的现金、持仓和权威报价计算，不接受客户端 P&L。

## 运行

```bash
pnpm install

# 启动一个本地 Postgres,并把连接串写进 .env(见 .env.example)
docker run -d --name bankrupt-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=bankrupt_elon -p 5433:5432 postgres:16

pnpm prisma generate           # 生成 Prisma Client
pnpm prisma migrate deploy     # 在全新库上套用 prisma/migrations 建表
pnpm prisma db seed            # 幂等写入 160 个资产

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

连接 INJ Pass 钱包后,游戏向同源后端登录(`/api/auth/nonce` → 钱包 EIP-191 签名 →
`/api/auth/verify` 发 JWT),随后 `GET /api/state` 载入云端存档(有则覆盖本地,无则上推),
之后状态变化去抖写回 `PUT /api/state`。可在钱包菜单手动「☁ 同步存档」(弹窗被拦截时重试)。

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

## 结构

- `src/data/` — 常量、产品目录、市场分组、扩展资产生成、分类标签(逐字移植)
- `src/i18n/` — 中英双语字符串与 `t()`/`labelFrom()`
- `src/game/` — `engine.ts`(纯游戏公式 + 交易/杠杆/清算)、`pricing.ts`、`marketClock.ts`、`format.ts`
- `src/state/` — `GameProvider`(Context+commit 模型)、`persistence`(localStorage,沿用旧存档 key)
- `src/sound/` — Web Audio 音效
- `src/wallet/` — `InjPassProvider` + `ConnectButton`
- `src/components/` — TopBar / FxTicker / PortfolioPanel / MarketPanel / ProductCard / FinancePanel
- `app/api/chart/route.ts` — Yahoo 行情代理
