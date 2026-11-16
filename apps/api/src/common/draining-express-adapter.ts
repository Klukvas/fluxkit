import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { ExpressAdapter } from "@nestjs/platform-express";

/** Nest calls beforeClose before every lifecycle hook, for both SIGTERM and app.close(). */
export class DrainingExpressAdapter extends ExpressAdapter {
  override async beforeClose(): Promise<void> {
    const server: Server = this.getHttpServer();
    if (!server.listening) return;
    // A proxy that keeps sending on a busy keep-alive connection would hold close() open until Docker's SIGKILL: from
    // now on every answer ends its connection, so the proxy opens a new one, is refused and tries another replica.
    // Prepended so the header is set before Express can send a synchronous answer.
    server.prependListener("request", (_request: IncomingMessage, response: ServerResponse) => {
      response.setHeader("Connection", "close");
    });
    // Stops accepting and closes idle keep-alive sockets; active requests keep their database/Redis until done.
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
      server.closeIdleConnections();
    });
  }
}
