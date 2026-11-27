import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https://media.licdn.com",
  "font-src 'self'",
  "connect-src 'self' https://api.openai.com",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

function contentSecurityPolicy(): Plugin {
  return {
    name: "content-security-policy",
    apply: "build",
    transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" }],
  };
}

export default defineConfig({
  base: "./",
  plugins: [contentSecurityPolicy()],
  worker: { format: "es" },
  optimizeDeps: { entries: ["index.html"] },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
