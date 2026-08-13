import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent Next.js from bundling pdf-parse (and its native deps like @napi-rs/canvas).
  // When bundled, the CJS module structure breaks and require() returns a non-callable object.
  // Marking it external forces Node.js to require() it directly at runtime.
  serverExternalPackages: ["pdf-parse"],
  images: {
    remotePatterns: [
      {
        // Local MinIO (npm run dev, host-side).
        protocol: "http",
        hostname: "localhost",
        port: "9000",
        pathname: "/**",
      },
      {
        // Local MinIO (container-to-container, e.g. SSR image checks from
        // inside the app container).
        protocol: "http",
        hostname: "minio",
        port: "9000",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
