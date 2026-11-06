import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@overwatch/shared"],
  serverExternalPackages: ["firebase-admin", "jsdom"],
  // Allow cross-origin dev access between localhost and 127.0.0.1 and Chrome extension
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "127.0.0.1:3000",
    "localhost:3000",
    "127.0.0.1:3001",
    "localhost:3001",
  ],
};

export default nextConfig;
