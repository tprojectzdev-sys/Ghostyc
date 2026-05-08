// `open_website` — opens a URL in the default browser. PROTOCOL.md §13.1.
//
// We restrict to http/https URLs to avoid being a generic "launch any URI handler"
// surface (file://, javascript:, custom schemes, etc.). This is a small,
// deliberate safety check — not a whitelist of domains.

import { z } from "zod";
import { spawn } from "node:child_process";

const ArgsSchema = z.object({
  url: z
    .string()
    .min(1)
    .url()
    .refine((u) => /^https?:\/\//i.test(u), {
      message: "only http:// and https:// URLs are accepted",
    }),
});

export async function runOpenWebsite(rawArgs: Record<string, unknown>): Promise<{ opened: true; url: string }> {
  const parsed = ArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new Error(
      `invalid args: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    );
  }
  const url = parsed.data.url;
  // cmd.exe /c start "" <url> uses the default browser via Windows shell association.
  // The first "" is an empty title (required because URLs can be quoted).
  const child = spawn("cmd.exe", ["/c", "start", "", url], {
    windowsHide: true,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return { opened: true, url };
}
