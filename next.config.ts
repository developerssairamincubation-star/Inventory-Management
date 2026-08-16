import type { NextConfig } from "next";

// Cloudinary always delivers from this fixed host regardless of account or
// environment (local dev and every hosted environment alike use the same
// Cloudinary account, scoped by CLOUDINARY_UPLOAD_FOLDER — see
// src/lib/cloudinary.ts), so unlike the old MinIO/S3 setup this doesn't need
// to be derived per-environment.
const remotePatterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [
  {
    protocol: "https",
    hostname: "res.cloudinary.com",
    pathname: "/**",
  },
];

const nextConfig: NextConfig = {
  // Traces and bundles only the actually-used dependency subset into
  // .next/standalone, instead of shipping the full node_modules — smaller
  // production image, faster container cold start. See the Dockerfile's
  // runner stage, which copies .next/standalone instead of node_modules.
  // Vercel ignores this and does its own build tracing, so it's harmless
  // there too — kept for the self-hosted Docker deploy path.
  output: "standalone",
  // Prevent Next.js from bundling pdf-parse (and its native deps like @napi-rs/canvas).
  // When bundled, the CJS module structure breaks and require() returns a non-callable object.
  // Marking it external forces Node.js to require() it directly at runtime.
  serverExternalPackages: ["pdf-parse"],
  images: { remotePatterns },
};

export default nextConfig;
