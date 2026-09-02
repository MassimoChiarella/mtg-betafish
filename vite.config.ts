import { sites } from "@openai/sites-vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(({ isPreview }) => {
  // Preview only the exported files, without an SSR fallback masking missing HTML.
  if (isPreview) return { appType: "mpa", build: { outDir: "dist/client" } };

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext({ nextConfig: { output: "export" } }),
      sites(),
    ],
  };
});
