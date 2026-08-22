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

// Security headers are declared here rather than set in middleware.
//
// Middleware sets them on the NextResponse it returns, but Next does not
// propagate those response headers to page responses — verified against a
// running dev server, where every header set that way was simply absent.
// next.config's headers() is the supported mechanism for static headers, and
// it's the better fit anyway: declarative, applied by the server, and no
// per-request work in the Edge runtime.
//
// The app previously set none of these at all: no CSP, no HSTS, no
// nosniff, no framing protection, no referrer policy.
const SENTRY_INGEST = "https://*.ingest.de.sentry.io https://*.ingest.sentry.io";
// @vercel/speed-insights loads its script from va.vercel-scripts.com and
// reports to vitals.vercel-insights.com. Both have to be allowed explicitly
// or the CSP silently kills the feature — which is exactly what happened the
// first time these headers went in.
const CLOUDINARY_DELIVERY = "https://res.cloudinary.com";
const VERCEL_INSIGHTS_SCRIPT = "https://va.vercel-scripts.com";
const VERCEL_INSIGHTS_REPORT = "https://vitals.vercel-insights.com";
const isDev = process.env.NODE_ENV !== "production";

const CSP = [
  "default-src 'self'",
  // 'unsafe-inline' is required by Next's inline hydration bootstrap;
  // 'unsafe-eval' is dev-only (React Refresh) and dropped in production.
  isDev
    ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${VERCEL_INSIGHTS_SCRIPT}`
    : `script-src 'self' 'unsafe-inline' ${VERCEL_INSIGHTS_SCRIPT}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  `img-src 'self' data: blob: ${CLOUDINARY_DELIVERY}`,
  // ws: is the dev-server HMR socket, dropped in production.
  `connect-src 'self' https://api.cloudinary.com ${SENTRY_INGEST} ${VERCEL_INSIGHTS_REPORT}${isDev ? " ws: http://localhost:*" : ""}`,
  // Nothing in this app is meant to be embedded, and the CSRF scheme rests on
  // SameSite=Lax plus a double-submit token — neither of which covers
  // clickjacking.
  "frame-ancestors 'none'",
  // What *we* may frame, as opposed to who may frame us. The invoice PDF
  // previews need two sources: blob: for the local preview of a file the user
  // just picked, and Cloudinary for the stored original of a saved invoice.
  `frame-src 'self' blob: ${CLOUDINARY_DELIVERY}`,
  // Kept at 'none'. The PDF previews used <object>, which this blocks — they
  // are <iframe> now precisely so this directive can stay closed. object-src
  // exists to block legacy plugin content and is one of the directives a
  // strict CSP is expected to lock down, so it is not worth reopening to
  // display a PDF.
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Only meaningful over HTTPS; omitted in dev so a plain-HTTP localhost
  // isn't pinned to HTTPS in the browser's HSTS store.
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Standalone output is for the self-hosted Docker deploy only.
  //
  // It traces just the dependency subset the app actually uses into
  // .next/standalone, along with a minimal server.js — a much smaller image
  // than shipping all of node_modules. The Dockerfile's runner stage copies
  // that directory.
  //
  // It must NOT be set when building on Vercel. Vercel runs its own file
  // tracing and its onBuildComplete step reads .next/next-server.js.nft.json;
  // with standalone enabled that build fails on Vercel with
  // "ENOENT: no such file or directory, open '.next/next-server.js.nft.json'".
  // The previous comment here assumed "Vercel ignores this, so it's harmless
  // there too" — that assumption was wrong, and the build broke as soon as
  // Next was upgraded.
  //
  // VERCEL=1 is set automatically in every Vercel build environment.
  output: process.env.VERCEL ? undefined : "standalone",
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
