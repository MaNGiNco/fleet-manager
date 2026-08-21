import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable for Vercel image optimization if needed later
  images: {
    remotePatterns: [],
  },
  // Avoid build failures on missing env during build
  env: {
    // These are read at runtime from Vercel env vars
  },
};

export default nextConfig;
