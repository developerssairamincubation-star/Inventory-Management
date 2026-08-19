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

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  dataCollection: {
    // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
    // userInfo: false,
    // httpBodies: [],
  },
});
