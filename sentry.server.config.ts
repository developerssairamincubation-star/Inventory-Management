// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://3d8bd1b17d2552d1417d0d69ec435c78@o4511939419308032.ingest.de.sentry.io/4511939455615056",
  // Only report from deployed builds. `next dev` runs with
  // NODE_ENV=development, so local errors stay in the terminal instead of
  // polluting the production issue stream and burning event quota. The SDK
  // still initialises when disabled — it just drops every event — so nothing
  // else in the app needs to branch on this.
  enabled: process.env.NODE_ENV === "production",

  // Traces are performance records of every request, sampled independently of
  // errors — errors are always sent at 100% regardless of this value. Sampling
  // 10% is plenty to spot slow endpoints while leaving quota headroom, so a
  // burst of routine traffic can't exhaust the plan and start dropping the
  // error events that actually matter.
  tracesSampleRate: 0.1,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Student names, email addresses and phone numbers pass through this
  // app, and both of these default to ON. userInfo attaches identifying
  // request data to every event; httpBodies ships request payloads —
  // including anything POSTed to /api/students — along with captured
  // exceptions. Neither is worth sending to a third-party processor here.
  dataCollection: {
    userInfo: false,
    httpBodies: [],
  },
});
