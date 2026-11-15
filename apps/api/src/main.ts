import { loadConfig } from "./config";
import { buildDeps } from "./deps";
import { buildServer } from "./server";
import { checkStorage } from "./storage-check";

const config = loadConfig();
const deps = buildDeps(config);
await checkStorage(deps.storage);
const { app, live } = await buildServer(deps);
const recovered = await live.recoverOrphans();
if (recovered) app.log.warn({ recovered }, "paused sessions left active by a previous process (platform failure)");
await app.listen({ port: config.API_PORT, host: config.API_HOST });
app.log.info(
  { llm: deps.llm?.name ?? "none (deterministic examiner policy; assessment unavailable unless dev baseline is enabled in the worker)", asr: deps.speech.asr, tts: deps.speech.tts },
  "API ready",
);
const shutdown = async () => {
  await live.shutdown();
  await app.close();
  await deps.db.$client.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
