import { connect } from 'node:net';

// Connecting, not binding: a server on localhost may hold only ::1 or only 127.0.0.1,
// and a wildcard bind does not collide with either on every system.
function isPortBusy(port) {
  return new Promise((resolve) => {
    const socket = connect({ port, host: 'localhost' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

/** The ports from the list that something on localhost is already listening on. */
export async function findBusyPorts(ports) {
  const busy = await Promise.all(ports.map(isPortBusy));
  return ports.filter((_, index) => busy[index]);
}
