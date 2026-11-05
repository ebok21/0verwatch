import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@overwatch/shared"],
  serverExternalPackages: ["firebase-admin", "jsdom"],
};

export default nextConfig;

