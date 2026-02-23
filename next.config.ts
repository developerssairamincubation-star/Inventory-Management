import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
