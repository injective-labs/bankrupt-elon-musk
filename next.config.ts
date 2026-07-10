import type { NextConfig } from "next";

// Allow the INJ Pass wallet iframe (the @injpass/cli connector points it at
// NEXT_PUBLIC_INJPASS_EMBED_URL). We derive the embed origin so the CSP only
// frames that one host plus self.
const embedUrl =
  process.env.NEXT_PUBLIC_INJPASS_EMBED_URL || "http://localhost:3000/embed";
let embedOrigin = "http://localhost:3000";
try {
  embedOrigin = new URL(embedUrl).origin;
} catch {
  // keep default
}

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-src ${embedOrigin} 'self';`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
