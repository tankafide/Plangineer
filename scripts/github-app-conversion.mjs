import { z } from 'zod';

const ConvertedApp = z.object({
  id: z.number().int(),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  pem: z.string().startsWith('-----BEGIN'),
  html_url: z.url(),
});

/** Reads GitHub's manifest conversion response, failing with GitHub's status and body when it is not a valid app. */
export async function readConversion(response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} ${response.statusText}: ${text}`);
  }
  const result = ConvertedApp.safeParse(JSON.parse(text));
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`GitHub's conversion response is missing or has invalid fields: ${fields}`);
  }
  return result.data;
}
