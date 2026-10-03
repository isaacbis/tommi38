import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { createApp } from "./server.js";

const sessionSecret = defineSecret("CAMPOPRONTO_SESSION_SECRET");
let app;
export const campoprontoApi = onRequest({
  region: "europe-west1", secrets: [sessionSecret], timeoutSeconds: 60,
  minInstances: 0, maxInstances: 2, concurrency: 20, memory: "512MiB",
  invoker: "public"
}, (req, res) => {
  app ||= createApp({
    secret: sessionSecret.value(), cookieName: "__session", secureCookies: true,
    allowedOrigins: ["https://ombrelloni-ddb55.web.app", "https://ombrelloni-ddb55.firebaseapp.com"]
  });
  return app(req, res);
});
