import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = process.env.NODE_ENV === "development";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  distDir: isDev ? ".next-dev" : ".next",
  outputFileTracingRoot: path.resolve(__dirname, ".."),
  experimental: {
    devtoolSegmentExplorer: false,
    optimizePackageImports: ["@react-three/drei", "three"]
  }
};

export default nextConfig;
