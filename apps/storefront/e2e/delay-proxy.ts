// SCRATCH (spike L1, ADR 0048): delays every answer of the API to the storefront SERVER by 500 ms, so a page's data is slow
// when the shell flushes. Not part of the suite; removed before the PR is finished.
import { createServer, request } from "node:http";

const listenPort = 3110;
const apiPort = Number(process.env["E2E_API_PORT"] ?? 3100);
const DELAY_MS = 500;

createServer((incoming, outgoing) => {
  const upstream = request(
    {
      host: "127.0.0.1",
      port: apiPort,
      method: incoming.method,
      path: incoming.url,
      headers: incoming.headers,
    },
    (answer) => {
      setTimeout(() => {
        outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(outgoing);
      }, DELAY_MS);
    },
  );
  upstream.on("error", (error) => {
    console.error(`delay proxy: ${error.message}`);
    if (!outgoing.headersSent) outgoing.writeHead(502);
    outgoing.end();
  });
  incoming.pipe(upstream);
}).listen(listenPort, "127.0.0.1", () => console.log(`delay proxy ${listenPort} -> ${apiPort}`));
