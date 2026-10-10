import { Blob, File } from 'node:buffer';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach } from 'vitest';
import { server } from './msw-server.ts';

// Listen before any app module loads: Better Auth's client keeps the fetch it sees at import.
// So this file imports nothing that imports the app.
server.listen({ onUnhandledFrame: 'error' });

// jsdom brings its own Blob, File and FormData, and a file in them reaches Node's fetch without
// its name or bytes. So the tests use Node's three, as a browser has one set. Node's FormData is
// reached through a Response, since jsdom hides the global, and it still reads a form element as
// a browser's does. Vitest wraps Request to convert jsdom bodies, which there are no longer, so
// Node's own Request, the class it extends, returns.
const JsdomFormData = FormData;
const NodeFormData = (await new Response(new URLSearchParams()).formData()).constructor;
if (!isFormDataClass(NodeFormData)) throw new Error("Node's FormData could not be reached");
class BrowserFormData extends NodeFormData {
  constructor(form?: HTMLFormElement) {
    super();
    if (form === undefined) return;
    for (const [name, value] of new JsdomFormData(form)) this.append(name, value);
  }
}
const NodeRequest: unknown = Object.getPrototypeOf(Request);
Object.assign(globalThis, { Blob, File, FormData: BrowserFormData, Request: NodeRequest });

// jsdom lays nothing out, and CodeMirror measures text ranges while it edits. Empty ranges let
// the editor run, as it does in a hidden tab.
const EMPTY_RECT = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 };
Object.assign(Range.prototype, {
  getClientRects: () => Object.assign([], { item: () => null }),
  getBoundingClientRect: () => ({ ...EMPTY_RECT, toJSON: () => EMPTY_RECT }),
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

function isFormDataClass(value: unknown): value is typeof FormData {
  return typeof value === 'function';
}
