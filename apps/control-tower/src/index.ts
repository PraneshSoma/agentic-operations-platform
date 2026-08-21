import { buildServer } from "./server.js";

const app = buildServer({
  slackBotToken: process.env.SLACK_BOT_TOKEN,
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
  slackChannel: process.env.SLACK_CHANNEL,
  slackUserMap: process.env.SLACK_USER_MAP,
  slackCallbackUrl: process.env.SLACK_CALLBACK_URL ?? process.env.NGROK_URL,
  logger: true,
});

const port = Number(process.env.PORT ?? 4000);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    app.log.info(`@aop/control-tower listening on :${port}`);
    app.log.info(process.env.SLACK_BOT_TOKEN ? "Slack: enabled" : "Slack: disabled (UI-only) — set SLACK_BOT_TOKEN + SLACK_SIGNING_SECRET to enable");
  })
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
