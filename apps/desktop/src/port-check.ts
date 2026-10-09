import { createServer } from 'node:net';

/** Whether nothing listens on `host:port`, found by listening on it and closing at once. */
export function isPortFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolve(false);
      else reject(error);
    });
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

/** Fails the start with a message naming the port and the file where it is set. */
export async function assertPortFree(
  host: string,
  port: number,
  serverEnvPath: string,
): Promise<void> {
  if (await isPortFree(host, port)) return;
  throw new Error(
    `Port ${port} is in use by another program. Free it, or change the port in ${serverEnvPath} as the desktop app guide describes.`,
  );
}
