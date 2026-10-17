import type { RpcInput } from "@getpaseo/plugin";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type sharpType from "sharp";
import type { readImage } from "../shared/image";
import { sharpPath } from "./sharp-path.ts";

const sharp = createRequire(sharpPath)(sharpPath) as typeof sharpType;

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const MAX_BYTES = 12 * 1024 * 1024;

// Only image files are served: this RPC must not become a general file reader for the client.
export async function readImageFile({ path, variant = "original" }: RpcInput<typeof readImage>) {
  const file = path.startsWith("file://") ? fileURLToPath(path) : path;
  const mime = MIME[extname(file).toLowerCase()];
  if (!mime) throw new Error(`Not an image: ${file}`);
  if ((await stat(file)).size > MAX_BYTES) throw new Error(`Image larger than ${MAX_BYTES / 1024 / 1024} MB: ${file}`);
  if (variant === "thumbnail") {
    // Twice the largest tile size, without decoding unbounded pixel counts or sending the original for a thumbnail.
    const preview = await sharp(file, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 640, height: 400, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();
    return { dataUrl: `data:image/webp;base64,${preview.toString("base64")}` };
  }
  return { dataUrl: `data:${mime};base64,${(await readFile(file)).toString("base64")}` };
}
