import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Reads an image the agent produced on the daemon machine, so any client can show it. */
export const readImage = defineRpc({
  name: "image.read",
  input: z.object({ path: z.string().min(1), variant: z.enum(["thumbnail", "original"]).optional() }),
  output: z.object({ dataUrl: z.string() }),
});
