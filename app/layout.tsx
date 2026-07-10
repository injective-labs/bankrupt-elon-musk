import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "让马斯克倾家荡产",
  description:
    "INJ Pass 夏季特别活动，500 亿美元看看能不能把马斯克玩到倾家荡产。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
