import { z } from 'zod';

const RpcForm = z.object({ json: z.unknown(), maps: z.array(z.array(z.string().or(z.number()))) });

function setAt(target: unknown, path: ReadonlyArray<string | number>, value: unknown): void {
  const [key, ...rest] = path;
  if (key === undefined || typeof target !== 'object' || target === null) {
    throw new Error('A file path in the RPC form does not match its JSON');
  }
  if (rest.length === 0) Reflect.set(target, key, value);
  else setAt(Reflect.get(target, key), rest, value);
}

/**
 * The input of an RPC request. A request that carries files is a form: its JSON names the path
 * of each file, and the files sit beside it, so each is put back at its path.
 */
export async function rpcInput(request: Request): Promise<unknown> {
  if (!(request.headers.get('Content-Type') ?? '').startsWith('multipart/form-data')) {
    const body: unknown = await request.json();
    return typeof body === 'object' && body !== null && 'json' in body ? body.json : null;
  }
  const form = await request.formData();
  const data = form.get('data');
  if (typeof data !== 'string') throw new Error('The RPC form has no data field');
  const { json, maps } = RpcForm.parse(JSON.parse(data));
  maps.forEach((path, index) => setAt(json, path, form.get(String(index))));
  return json;
}
