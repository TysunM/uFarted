import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { runMaintenance } from './maintenance.js';

const cfg = loadConfig();
const app = await buildApp(cfg);

const DAY = 86_400_000;
const maintain = () => runMaintenance(app).catch((err) => app.log.error({ err }, 'maintenance failed'));
const timer = setInterval(maintain, DAY);
setTimeout(maintain, 60_000).unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    clearInterval(timer);
    await app.close();
    process.exit(0);
  });
}

await app.listen({ port: cfg.port, host: cfg.host });
