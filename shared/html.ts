import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** The MCP server the daemon gives new agents (server/html.ts) and its one tool, which shows an HTML page in the chat (client/html.ts). */
export const HTML_SERVER = "chat_polish";
export const HTML_TOOL = "html_render";

/** The tool as each provider names it: "mcp__server__tool" (Claude) or "server.tool" (Codex). */
export const isHtmlTool = (name: string) => name === `mcp__${HTML_SERVER}__${HTML_TOOL}` || name === `${HTML_SERVER}.${HTML_TOOL}`;

/** Saves a page (already themed by the client) where the plugin's local server (the one serving the tool) serves it on the daemon's localhost, for the system browser. */
export const openHtml = defineRpc({ name: "html.open", input: z.object({ html: z.string().min(1).max(5_000_000) }), output: z.object({ url: z.string() }) });

// An image on the daemon machine, by absolute path (or file:// URL) in quotes or a CSS url(): the server checks it exists when the page is
// published, and the client swaps in its data when it shows the page, since a sandboxed frame can't load files. The image.read RPC's types.
const LOCAL_IMAGE = /(["'`])((?:file:\/\/)?(?:\/(?!\/)|[a-z]:[\\/])(?:(?!\1)[^\r\n]){0,2048}?\.(?:png|jpe?g|gif|webp))\1|url\(\s*((?:file:\/\/)?(?:\/(?!\/)|[a-z]:[\\/])[^\s"'`()]{0,2048}?\.(?:png|jpe?g|gif|webp))\s*\)/gi;

/** Where a page names local images, in order. */
export function localImages(html: string) {
  return Array.from(html.matchAll(LOCAL_IMAGE), (m) => {
    const path = (m[2] ?? m[3])!;
    const start = m.index! + m[0].indexOf(path);
    return { start, end: start + path.length, path };
  });
}

/** The page with each local image it names replaced by the data in `uris`; images missing from `uris` keep their path. */
export function inlineImages(html: string, uris: ReadonlyMap<string, string>) {
  let out = "";
  let at = 0;
  for (const { start, end, path } of localImages(html)) {
    const uri = uris.get(path);
    if (uri === undefined) continue;
    out += html.slice(at, start) + uri;
    at = end;
  }
  return out + html.slice(at);
}
