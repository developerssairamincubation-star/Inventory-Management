import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent Next.js from bundling pdf-parse (and its native deps like @napi-rs/canvas).
  // When bundled, the CJS module structure breaks and require() returns a non-callable object.
  // Marking it external forces Node.js to require() it directly at runtime.
  serverExternalPackages: ["pdf-parse"],
  images: {
    remotePatterns: [
      {
        // Standard AWS S3 bucket URLs: https://<bucket>.s3.<region>.amazonaws.com/...
        protocol: "https",
        hostname: "**.amazonaws.com",
        pathname: "/**",
      },
      {
        // Regional path-style S3 URLs: https://s3.<region>.amazonaws.com/<bucket>/...
        protocol: "https",
        hostname: "s3.**.amazonaws.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
