#!/usr/bin/env node
/**
 * claude-proxy.mjs – Kompatibilitäts-Starter.
 *
 * Der Server heißt jetzt server/server.mjs, weil er nicht mehr nur die
 * Claude API weiterreicht, sondern auch die Live-Flugdaten holt.
 *
 * Dieser Starter existiert, damit der alte Befehl
 *   node server/claude-proxy.mjs
 * weiterhin funktioniert. Neu bitte verwenden:
 *   node server/server.mjs
 */

import { createServer } from "./server.mjs";

const PORT = Number(process.env.PORT ?? 8000);

console.log("\n  ℹ️  Hinweis: Der Server heißt jetzt server/server.mjs.");

createServer().listen(PORT, () => {
    console.log(`  🌍 World Viewer läuft auf http://localhost:${PORT}\n`);
});
