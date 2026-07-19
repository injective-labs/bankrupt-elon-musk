-- Server-authoritative game schema. This migration is intentionally self-contained:
-- catalogue rows are inserted before Position.assetId receives its foreign key.

CREATE TYPE "TransactionType" AS ENUM ('BUY', 'SELL', 'RESET');
CREATE TYPE "QuoteStatus" AS ENUM ('ACTIVE', 'STALE', 'ERROR');

DROP INDEX "Player_pnl_idx";

ALTER TABLE "Player" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
UPDATE "Player"
SET "lastLoginAt" = COALESCE("updatedAt", "createdAt", CURRENT_TIMESTAMP);
ALTER TABLE "Player"
  ALTER COLUMN "lastLoginAt" SET NOT NULL,
  ALTER COLUMN "cash" TYPE DECIMAL(30,8) USING "cash"::numeric,
  DROP COLUMN "debt",
  DROP COLUMN "accruedInterest",
  DROP COLUMN "lastInterestAccruedAt",
  DROP COLUMN "liquidated",
  DROP COLUMN "leverage",
  DROP COLUMN "netWorth",
  DROP COLUMN "pnl",
  DROP COLUMN "holdingsValue",
  DROP COLUMN "locale",
  DROP COLUMN "sound",
  DROP COLUMN "sort";

ALTER TABLE "Position"
  RENAME COLUMN "productId" TO "assetId";
ALTER TABLE "Position"
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "Position" SET "updatedAt" = CURRENT_TIMESTAMP;
ALTER TABLE "Position"
  ALTER COLUMN "updatedAt" SET NOT NULL,
  ALTER COLUMN "quantity" TYPE DECIMAL(30,12) USING "quantity"::numeric,
  ALTER COLUMN "costBasis" TYPE DECIMAL(30,8) USING "costBasis"::numeric;
ALTER INDEX "Position_walletAddress_productId_key"
  RENAME TO "Position_walletAddress_assetId_key";

CREATE TABLE "Asset" (
  "id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "quoteSymbol" TEXT NOT NULL,
  "nameZh" TEXT NOT NULL,
  "nameEn" TEXT,
  "assetClass" TEXT NOT NULL,
  "subCategory" TEXT,
  "currency" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "quoteMultiplier" DECIMAL(30,12) NOT NULL DEFAULT 1,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "displayOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- Seed the complete checked-in catalogue in the migration transaction. This is
-- required before the Position foreign key so all existing catalogue positions survive.
INSERT INTO "Asset"
("id","ticker","quoteSymbol","nameZh","nameEn","assetClass","subCategory","currency","unit","quoteMultiplier","enabled","displayOrder")
VALUES
('bitcoin-coin','BTC','BTC-USD','比特币 BTC','Bitcoin BTC','加密货币','加密货币','USD','枚',1,TRUE,0),
('ethereum-coin','ETH','ETH-USD','以太坊 ETH','Ethereum ETH','加密货币','加密货币','USD','枚',1,TRUE,1),
('dogecoin-pack','DOGE','DOGE-USD','狗狗币一百万枚','Dogecoin (1M pack)','加密货币','加密货币','USD','包',1,TRUE,2),
('litecoin-coin','LTC','LTC-USD','莱特币 LTC','Litecoin LTC','加密货币','加密货币','USD','枚',1,TRUE,3),
('solana-coin','SOL','SOL-USD','Solana SOL','Solana SOL','加密货币','加密货币','USD','枚',1,TRUE,4),
('nvidia-basket','NVDA','NVDA','英伟达股票篮','NVIDIA stock basket','美股','芯片股票','USD','篮',1,TRUE,5),
('micron-basket','MU','MU','美光股票篮','Micron stock basket','美股','芯片股票','USD','篮',1,TRUE,6),
('sandisk-basket','SNDK','SNDK','闪迪股票篮','SanDisk stock basket','美股','芯片股票','USD','篮',1,TRUE,7),
('amd-basket','AMD','AMD','AMD 股票篮','AMD stock basket','美股','芯片股票','USD','篮',1,TRUE,8),
('broadcom-basket','AVGO','AVGO','博通股票篮','Broadcom stock basket','美股','芯片股票','USD','篮',1,TRUE,9),
('tsmc-basket','TSM','TSM','台积电股票篮','TSMC stock basket','美股','芯片股票','USD','篮',1,TRUE,10),
('asml-basket','ASML','ASML','ASML 股票篮','ASML stock basket','美股','芯片股票','USD','篮',1,TRUE,11),
('microsoft-basket','MSFT','MSFT','微软股票篮','Microsoft stock basket','美股','科技股票','USD','篮',1,TRUE,12),
('alphabet-basket','GOOGL','GOOGL','谷歌股票篮','Alphabet (Google) stock basket','美股','科技股票','USD','篮',1,TRUE,13),
('amazon-basket','AMZN','AMZN','亚马逊股票篮','Amazon stock basket','美股','科技股票','USD','篮',1,TRUE,14),
('meta-basket','META','META','Meta 股票篮','Meta stock basket','美股','科技股票','USD','篮',1,TRUE,15),
('cloudflare-stock','NET','NET','Cloudflare 正股','Cloudflare common stock','美股','云计算','USD','股',1,TRUE,16),
('coreweave-stock','CRWV','CRWV','CoreWeave 正股','CoreWeave common stock','美股','AI 云','USD','股',1,TRUE,17),
('oracle-stock','ORCL','ORCL','Oracle 正股','Oracle common stock','美股','云计算','USD','股',1,TRUE,18),
('arm-stock','ARM','ARM','Arm 正股','Arm common stock','美股','芯片股票','USD','股',1,TRUE,19),
('marvell-stock','MRVL','MRVL','Marvell 正股','Marvell common stock','美股','芯片股票','USD','股',1,TRUE,20),
('supermicro-stock','SMCI','SMCI','超微电脑正股','Super Micro Computer stock','美股','AI 硬件','USD','股',1,TRUE,21),
('vertiv-stock','VRT','VRT','Vertiv 正股','Vertiv common stock','美股','AI 基建','USD','股',1,TRUE,22),
('dell-stock','DELL','DELL','戴尔正股','Dell common stock','美股','AI 硬件','USD','股',1,TRUE,23),
('arista-stock','ANET','ANET','Arista Networks 正股','Arista Networks common stock','美股','AI 基建','USD','股',1,TRUE,24),
('astera-labs-stock','ALAB','ALAB','Astera Labs 正股','Astera Labs common stock','美股','AI 基建','USD','股',1,TRUE,25),
('coinbase-basket','COIN','COIN','Coinbase 股票篮','Coinbase stock basket','美股','金融平台','USD','篮',1,TRUE,26),
('palantir-basket','PLTR','PLTR','Palantir 股票篮','Palantir stock basket','美股','科技股票','USD','篮',1,TRUE,27),
('mstr-stock','MSTR','MSTR','微策略 MSTR 正股','Strategy MSTR common stock','美股','正股','USD','股',1,TRUE,28),
('xiaomi-hk','1810.HK','1810.HK','小米集团','Xiaomi','港股','科技制造','HKD','股',1,TRUE,29),
('tencent-hk','0700.HK','0700.HK','腾讯控股','Tencent','港股','互联网','HKD','股',1,TRUE,30),
('alibaba-hk','9988.HK','9988.HK','阿里巴巴港股','Alibaba HK','港股','互联网','HKD','股',1,TRUE,31),
('meituan-hk','3690.HK','3690.HK','美团','Meituan','港股','互联网','HKD','股',1,TRUE,32),
('byd-hk','1211.HK','1211.HK','比亚迪港股','BYD HK','港股','新能源车','HKD','股',1,TRUE,33),
('samsung-kr','005930.KS','005930.KS','三星电子','Samsung Electronics','韩股','半导体','KRW','股',1,TRUE,34),
('sk-hynix-kr','000660.KS','000660.KS','SK 海力士','SK Hynix','韩股','半导体','KRW','股',1,TRUE,35),
('hyundai-kr','005380.KS','005380.KS','现代汽车','Hyundai Motor','韩股','汽车','KRW','股',1,TRUE,36),
('tsmc-tw','2330.TW','2330.TW','台积电台股','TSMC Taiwan','台股','半导体','TWD','股',1,TRUE,37),
('honhai-tw','2317.TW','2317.TW','鸿海精密','Hon Hai Precision','台股','电子制造','TWD','股',1,TRUE,38),
('mediatek-tw','2454.TW','2454.TW','联发科','MediaTek','台股','半导体','TWD','股',1,TRUE,39),
('toyota-jp','7203.T','7203.T','丰田汽车','Toyota Motor','日股','汽车','JPY','股',1,TRUE,40),
('sony-jp','6758.T','6758.T','索尼集团','Sony Group','日股','科技娱乐','JPY','股',1,TRUE,41),
('softbank-jp','9984.T','9984.T','软银集团','SoftBank Group','日股','科技投资','JPY','股',1,TRUE,42),
('crypto-xrp','XRP','XRP-USD','瑞波币 XRP','XRP','加密货币','加密货币','USD','枚',1,TRUE,43),
('crypto-bnb','BNB','BNB-USD','币安币 BNB','BNB','加密货币','加密货币','USD','枚',1,TRUE,44),
('crypto-ada','ADA','ADA-USD','Cardano ADA','Cardano','加密货币','加密货币','USD','枚',1,TRUE,45),
('crypto-link','LINK','LINK-USD','Chainlink LINK','Chainlink','加密货币','加密货币','USD','枚',1,TRUE,46),
('crypto-avax','AVAX','AVAX-USD','Avalanche AVAX','Avalanche','加密货币','加密货币','USD','枚',1,TRUE,47),
('crypto-dot','DOT','DOT-USD','Polkadot DOT','Polkadot','加密货币','加密货币','USD','枚',1,TRUE,48),
('crypto-inj','INJ','INJ-USD','Injective INJ','Injective','加密货币','加密货币','USD','枚',1,TRUE,49),
('us-intc','INTC','INTC','INTC 美股','INTC · US Stocks','美股','半导体','USD','股',1,TRUE,50),
('us-qcom','QCOM','QCOM','QCOM 美股','QCOM · US Stocks','美股','半导体','USD','股',1,TRUE,51),
('us-txn','TXN','TXN','TXN 美股','TXN · US Stocks','美股','半导体','USD','股',1,TRUE,52),
('us-amat','AMAT','AMAT','AMAT 美股','AMAT · US Stocks','美股','半导体','USD','股',1,TRUE,53),
('us-lrcx','LRCX','LRCX','LRCX 美股','LRCX · US Stocks','美股','半导体','USD','股',1,TRUE,54),
('us-klac','KLAC','KLAC','KLAC 美股','KLAC · US Stocks','美股','半导体','USD','股',1,TRUE,55),
('us-adi','ADI','ADI','ADI 美股','ADI · US Stocks','美股','半导体','USD','股',1,TRUE,56),
('us-mchp','MCHP','MCHP','MCHP 美股','MCHP · US Stocks','美股','半导体','USD','股',1,TRUE,57),
('us-on','ON','ON','ON 美股','ON · US Stocks','美股','半导体','USD','股',1,TRUE,58),
('us-mpwr','MPWR','MPWR','MPWR 美股','MPWR · US Stocks','美股','半导体','USD','股',1,TRUE,59),
('us-nxpi','NXPI','NXPI','NXPI 美股','NXPI · US Stocks','美股','半导体','USD','股',1,TRUE,60),
('us-ter','TER','TER','TER 美股','TER · US Stocks','美股','半导体','USD','股',1,TRUE,61),
('us-lscc','LSCC','LSCC','LSCC 美股','LSCC · US Stocks','美股','半导体','USD','股',1,TRUE,62),
('us-cohr','COHR','COHR','COHR 美股','COHR · US Stocks','美股','半导体','USD','股',1,TRUE,63),
('hk-9999','9999.HK','9999.HK','网易','NetEase','港股','互联网','HKD','股',1,TRUE,64),
('hk-1024','1024.HK','1024.HK','快手','Kuaishou','港股','互联网','HKD','股',1,TRUE,65),
('hk-9618','9618.HK','9618.HK','京东集团','JD.com','港股','互联网','HKD','股',1,TRUE,66),
('hk-9888','9888.HK','9888.HK','百度集团','Baidu','港股','互联网','HKD','股',1,TRUE,67),
('hk-9626','9626.HK','9626.HK','哔哩哔哩','Bilibili','港股','互联网','HKD','股',1,TRUE,68),
('hk-0772','0772.HK','0772.HK','阅文集团','China Literature','港股','互联网','HKD','股',1,TRUE,69),
('hk-9899','9899.HK','9899.HK','网易云音乐','Cloud Music','港股','互联网','HKD','股',1,TRUE,70),
('hk-0241','0241.HK','0241.HK','阿里健康','Alibaba Health','港股','消费科技','HKD','股',1,TRUE,71),
('hk-6618','6618.HK','6618.HK','京东物流','JD Logistics','港股','消费科技','HKD','股',1,TRUE,72),
('hk-6690','6690.HK','6690.HK','海尔智家','Haier Smart Home','港股','消费科技','HKD','股',1,TRUE,73),
('hk-2013','2013.HK','2013.HK','微盟集团','Weimob','港股','消费科技','HKD','股',1,TRUE,74),
('hk-2015','2015.HK','2015.HK','理想汽车','Li Auto','港股','新能源车','HKD','股',1,TRUE,75),
('hk-9868','9868.HK','9868.HK','小鹏汽车','XPeng','港股','新能源车','HKD','股',1,TRUE,76),
('hk-9866','9866.HK','9866.HK','蔚来','NIO','港股','新能源车','HKD','股',1,TRUE,77),
('hk-0175','0175.HK','0175.HK','吉利汽车','Geely Auto','港股','新能源车','HKD','股',1,TRUE,78),
('kr-006400-ks','006400.KS','006400.KS','三星 SDI','Samsung SDI','韩股','半导体','KRW','股',1,TRUE,79),
('kr-066570-ks','066570.KS','066570.KS','LG 电子','LG Electronics','韩股','半导体','KRW','股',1,TRUE,80),
('kr-035420-ks','035420.KS','035420.KS','NAVER','NAVER','韩股','互联网','KRW','股',1,TRUE,81),
('kr-035720-ks','035720.KS','035720.KS','Kakao','Kakao','韩股','互联网','KRW','股',1,TRUE,82),
('kr-259960-ks','259960.KS','259960.KS','Krafton','Krafton','韩股','互联网','KRW','股',1,TRUE,83),
('kr-036570-ks','036570.KS','036570.KS','NCsoft','NCsoft','韩股','互联网','KRW','股',1,TRUE,84),
('kr-000270-ks','000270.KS','000270.KS','起亚','Kia','韩股','新能源车','KRW','股',1,TRUE,85),
('kr-012330-ks','012330.KS','012330.KS','现代摩比斯','Hyundai Mobis','韩股','新能源车','KRW','股',1,TRUE,86),
('kr-373220-ks','373220.KS','373220.KS','LG 新能源','LG Energy Solution','韩股','新能源车','KRW','股',1,TRUE,87),
('kr-051910-ks','051910.KS','051910.KS','LG 化学','LG Chem','韩股','新能源车','KRW','股',1,TRUE,88),
('kr-105560-ks','105560.KS','105560.KS','KB 金融','KB Financial','韩股','金融','KRW','股',1,TRUE,89),
('kr-055550-ks','055550.KS','055550.KS','新韩金融','Shinhan Financial','韩股','金融','KRW','股',1,TRUE,90),
('kr-086790-ks','086790.KS','086790.KS','韩亚金融','Hana Financial','韩股','金融','KRW','股',1,TRUE,91),
('kr-005490-ks','005490.KS','005490.KS','浦项控股','POSCO Holdings','韩股','工业','KRW','股',1,TRUE,92),
('kr-028260-ks','028260.KS','028260.KS','三星物产','Samsung C&T','韩股','工业','KRW','股',1,TRUE,93),
('kr-015760-ks','015760.KS','015760.KS','韩国电力','KEPCO','韩股','工业','KRW','股',1,TRUE,94),
('kr-096770-ks','096770.KS','096770.KS','SK Innovation','SK Innovation','韩股','工业','KRW','股',1,TRUE,95),
('kr-034020-ks','034020.KS','034020.KS','斗山能源','Doosan Enerbility','韩股','工业','KRW','股',1,TRUE,96),
('kr-068270-ks','068270.KS','068270.KS','Celltrion','Celltrion','韩股','医药','KRW','股',1,TRUE,97),
('kr-207940-ks','207940.KS','207940.KS','三星生物','Samsung Biologics','韩股','医药','KRW','股',1,TRUE,98),
('tw-2303-tw','2303.TW','2303.TW','联电','UMC','台股','半导体','TWD','股',1,TRUE,99),
('tw-3711-tw','3711.TW','3711.TW','日月光投控','ASE Technology','台股','半导体','TWD','股',1,TRUE,100),
('tw-3034-tw','3034.TW','3034.TW','联咏','Novatek','台股','半导体','TWD','股',1,TRUE,101),
('tw-2382-tw','2382.TW','2382.TW','广达','Quanta','台股','电子制造','TWD','股',1,TRUE,102),
('tw-2357-tw','2357.TW','2357.TW','华硕','ASUSTeK','台股','电子制造','TWD','股',1,TRUE,103),
('tw-3231-tw','3231.TW','3231.TW','纬创','Wistron','台股','电子制造','TWD','股',1,TRUE,104),
('tw-6669-tw','6669.TW','6669.TW','纬颖','Wiwynn','台股','电子制造','TWD','股',1,TRUE,105),
('tw-2882-tw','2882.TW','2882.TW','国泰金','Cathay Financial','台股','金融','TWD','股',1,TRUE,106),
('tw-2881-tw','2881.TW','2881.TW','富邦金','Fubon Financial','台股','金融','TWD','股',1,TRUE,107),
('tw-2891-tw','2891.TW','2891.TW','中信金','CTBC Financial','台股','金融','TWD','股',1,TRUE,108),
('tw-5880-tw','5880.TW','5880.TW','合库金','Taiwan Cooperative Financial','台股','金融','TWD','股',1,TRUE,109),
('tw-1216-tw','1216.TW','1216.TW','统一','Uni-President','台股','消费','TWD','股',1,TRUE,110),
('tw-1301-tw','1301.TW','1301.TW','台塑','Formosa Plastics','台股','消费','TWD','股',1,TRUE,111),
('tw-1303-tw','1303.TW','1303.TW','南亚','Nan Ya Plastics','台股','消费','TWD','股',1,TRUE,112),
('tw-1326-tw','1326.TW','1326.TW','台化','Formosa Chemicals','台股','消费','TWD','股',1,TRUE,113),
('tw-2412-tw','2412.TW','2412.TW','中华电信','Chunghwa Telecom','台股','电讯公用','TWD','股',1,TRUE,114),
('tw-3045-tw','3045.TW','3045.TW','台湾大哥大','Taiwan Mobile','台股','电讯公用','TWD','股',1,TRUE,115),
('tw-2308-tw','2308.TW','2308.TW','台达电','Delta Electronics','台股','工业','TWD','股',1,TRUE,116),
('tw-2002-tw','2002.TW','2002.TW','中钢','China Steel','台股','工业','TWD','股',1,TRUE,117),
('tw-5871-tw','5871.TW','5871.TW','中租控股','Chailease','台股','工业','TWD','股',1,TRUE,118),
('jp-7267-t','7267.T','7267.T','本田汽车','Honda','日股','汽车','JPY','股',1,TRUE,119),
('jp-7201-t','7201.T','7201.T','日产汽车','Nissan','日股','汽车','JPY','股',1,TRUE,120),
('jp-8035-t','8035.T','8035.T','东京电子','Tokyo Electron','日股','半导体','JPY','股',1,TRUE,121),
('jp-6857-t','6857.T','6857.T','Advantest','Advantest','日股','半导体','JPY','股',1,TRUE,122),
('jp-4063-t','4063.T','4063.T','信越化学','Shin-Etsu Chemical','日股','半导体','JPY','股',1,TRUE,123),
('jp-7741-t','7741.T','7741.T','HOYA','HOYA','日股','半导体','JPY','股',1,TRUE,124),
('jp-6273-t','6273.T','6273.T','SMC','SMC','日股','半导体','JPY','股',1,TRUE,125),
('jp-6981-t','6981.T','6981.T','村田制作所','Murata','日股','半导体','JPY','股',1,TRUE,126),
('jp-8306-t','8306.T','8306.T','三菱日联金融','Mitsubishi UFJ','日股','金融','JPY','股',1,TRUE,127),
('jp-8316-t','8316.T','8316.T','三井住友金融','Sumitomo Mitsui FG','日股','金融','JPY','股',1,TRUE,128),
('jp-8411-t','8411.T','8411.T','瑞穗金融','Mizuho Financial','日股','金融','JPY','股',1,TRUE,129),
('jp-8766-t','8766.T','8766.T','东京海上','Tokio Marine','日股','金融','JPY','股',1,TRUE,130),
('jp-7974-t','7974.T','7974.T','任天堂','Nintendo','日股','科技娱乐','JPY','股',1,TRUE,131),
('jp-6098-t','6098.T','6098.T','Recruit','Recruit','日股','科技娱乐','JPY','股',1,TRUE,132),
('jp-6861-t','6861.T','6861.T','Keyence','Keyence','日股','工业','JPY','股',1,TRUE,133),
('jp-6954-t','6954.T','6954.T','发那科','Fanuc','日股','工业','JPY','股',1,TRUE,134),
('jp-6501-t','6501.T','6501.T','日立','Hitachi','日股','工业','JPY','股',1,TRUE,135),
('jp-8058-t','8058.T','8058.T','三菱商事','Mitsubishi Corp','日股','工业','JPY','股',1,TRUE,136),
('jp-8001-t','8001.T','8001.T','伊藤忠商事','Itochu','日股','工业','JPY','股',1,TRUE,137),
('jp-8031-t','8031.T','8031.T','三井物产','Mitsui','日股','工业','JPY','股',1,TRUE,138),
('jp-4519-t','4519.T','4519.T','中外制药','Chugai Pharma','日股','医药','JPY','股',1,TRUE,139),
('jp-4568-t','4568.T','4568.T','第一三共','Daiichi Sankyo','日股','医药','JPY','股',1,TRUE,140),
('jp-4502-t','4502.T','4502.T','武田制药','Takeda','日股','医药','JPY','股',1,TRUE,141),
('jp-9983-t','9983.T','9983.T','迅销','Fast Retailing','日股','消费','JPY','股',1,TRUE,142),
('jp-2914-t','2914.T','2914.T','日本烟草','Japan Tobacco','日股','消费','JPY','股',1,TRUE,143),
('jp-9432-t','9432.T','9432.T','日本电信电话','NTT','日股','电讯公用','JPY','股',1,TRUE,144),
('jp-9433-t','9433.T','9433.T','KDDI','KDDI','日股','电讯公用','JPY','股',1,TRUE,145),
('jp-9020-t','9020.T','9020.T','JR 东日本','JR East','日股','运输','JPY','股',1,TRUE,146),
('jp-9022-t','9022.T','9022.T','JR 东海','JR Central','日股','运输','JPY','股',1,TRUE,147),
('metals-gc-f','GC=F','GC=F','黄金期货','Gold futures','贵金属','黄金','USD','份',1,TRUE,148),
('metals-si-f','SI=F','SI=F','白银期货','Silver futures','贵金属','白银','USD','份',1,TRUE,149),
('metals-pl-f','PL=F','PL=F','铂金期货','Platinum futures','贵金属','铂钯','USD','份',1,TRUE,150),
('metals-pa-f','PA=F','PA=F','钯金期货','Palladium futures','贵金属','铂钯','USD','份',1,TRUE,151),
('metals-hg-f','HG=F','HG=F','铜期货','Copper futures','贵金属','铜','USD','份',1,TRUE,152),
('commodities-cl-f','CL=F','CL=F','WTI 原油期货','WTI crude futures','大宗商品','原油','USD','份',1,TRUE,153),
('commodities-bz-f','BZ=F','BZ=F','布伦特原油期货','Brent crude futures','大宗商品','原油','USD','份',1,TRUE,154),
('commodities-ng-f','NG=F','NG=F','天然气期货','Natural gas futures','大宗商品','天然气','USD','份',1,TRUE,155),
('commodities-rb-f','RB=F','RB=F','汽油期货','Gasoline futures','大宗商品','原油','USD','份',1,TRUE,156),
('commodities-ho-f','HO=F','HO=F','取暖油期货','Heating oil futures','大宗商品','原油','USD','份',1,TRUE,157),
('commodities-btu','BTU','BTU','Peabody Energy','Peabody Energy','大宗商品','煤炭','USD','份',1,TRUE,158),
('commodities-dbc','DBC','DBC','综合商品 ETF','Commodity Index ETF','大宗商品','综合商品','USD','份',1,TRUE,159);

CREATE TABLE "Transaction" (
  "id" BIGSERIAL NOT NULL,
  "walletAddress" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "commandSnapshot" JSONB NOT NULL,
  "resultSnapshot" JSONB NOT NULL,
  "type" "TransactionType" NOT NULL,
  "assetId" TEXT,
  "quantity" DECIMAL(30,12),
  "nativePrice" DECIMAL(30,12),
  "currency" TEXT,
  "fxRateToUsd" DECIMAL(30,12),
  "usdUnitPrice" DECIMAL(30,12),
  "usdAmount" DECIMAL(30,8) NOT NULL,
  "cashBefore" DECIMAL(30,8) NOT NULL,
  "cashAfter" DECIMAL(30,8) NOT NULL,
  "quantityBefore" DECIMAL(30,12),
  "quantityAfter" DECIMAL(30,12),
  "costBasisBefore" DECIMAL(30,8),
  "costBasisAfter" DECIMAL(30,8),
  "marketDate" DATE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssetQuote" (
  "assetId" TEXT NOT NULL,
  "nativePrice" DECIMAL(30,12) NOT NULL,
  "currency" TEXT NOT NULL,
  "fxRateToUsd" DECIMAL(30,12) NOT NULL,
  "usdPrice" DECIMAL(30,12) NOT NULL,
  "marketDate" DATE NOT NULL,
  "source" TEXT NOT NULL,
  "status" "QuoteStatus" NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssetQuote_pkey" PRIMARY KEY ("assetId")
);

CREATE TABLE "AssetDailyPrice" (
  "id" BIGSERIAL NOT NULL,
  "assetId" TEXT NOT NULL,
  "marketDate" DATE NOT NULL,
  "open" DECIMAL(30,12),
  "high" DECIMAL(30,12),
  "low" DECIMAL(30,12),
  "close" DECIMAL(30,12) NOT NULL,
  "currency" TEXT NOT NULL,
  "fxRateToUsd" DECIMAL(30,12) NOT NULL,
  "usdClose" DECIMAL(30,12) NOT NULL,
  "source" TEXT NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssetDailyPrice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Asset_quoteSymbol_key" ON "Asset"("quoteSymbol");
CREATE INDEX "Asset_enabled_displayOrder_idx" ON "Asset"("enabled", "displayOrder");
CREATE INDEX "Position_assetId_walletAddress_idx" ON "Position"("assetId", "walletAddress");
CREATE UNIQUE INDEX "Transaction_walletAddress_idempotencyKey_key"
  ON "Transaction"("walletAddress", "idempotencyKey");
CREATE INDEX "Transaction_walletAddress_createdAt_idx"
  ON "Transaction"("walletAddress", "createdAt");
CREATE INDEX "Transaction_assetId_idx" ON "Transaction"("assetId");
CREATE INDEX "AssetQuote_status_marketDate_idx" ON "AssetQuote"("status", "marketDate");
CREATE UNIQUE INDEX "AssetDailyPrice_assetId_marketDate_key"
  ON "AssetDailyPrice"("assetId", "marketDate");
CREATE INDEX "AssetDailyPrice_marketDate_idx" ON "AssetDailyPrice"("marketDate");

ALTER TABLE "Position"
  ADD CONSTRAINT "Position_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_walletAddress_fkey"
  FOREIGN KEY ("walletAddress") REFERENCES "Player"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssetQuote"
  ADD CONSTRAINT "AssetQuote_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetDailyPrice"
  ADD CONSTRAINT "AssetDailyPrice_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TradeLog is deliberately untouched; it remains legacy historical information.
