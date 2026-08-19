import { withSentryConfig } from "@sentry/nextjs";
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

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "stif-software-team",

  project: "nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  // tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
