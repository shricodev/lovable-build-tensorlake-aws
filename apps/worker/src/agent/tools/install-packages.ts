import { z } from "zod";
import { defineTool } from "./types.js";

// npm package name with an optional semver-ish version: no URLs, git refs, tarballs or local paths.
const SPEC = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[\w.^~<>=*|-]+)?$/;

/** Packages that make no sense in a browser SPA or are heavy/dangerous to install here. */
const DENY = new Set(["puppeteer", "playwright", "electron", "node-pty", "child_process", "sharp", "canvas"]);

export function checkPackageSpec(spec: string): string | null {
  if (!SPEC.test(spec))
    return `"${spec}" is not a plain npm package name (URLs, git and file specs are not allowed)`;
  const name = spec.startsWith("@") ? `@${spec.slice(1).split("@")[0]}` : spec.split("@")[0]!;
  if (DENY.has(name)) return `"${name}" is not allowed in generated apps`;
  return null;
}

export const installPackages = defineTool({
  name: "install_packages",
  description:
    "Install npm packages into the project (adds them to package.json). Many common libraries are already installed: react, react-router, lucide-react, recharts, date-fns, zustand, clsx, tailwind-merge, class-variance-authority. Check package.json first.",
  schema: z.object({
    packages: z.array(z.string()).min(1).max(10),
    dev: z.boolean().default(false).describe("Install as devDependencies"),
  }),
  async run({ packages, dev }, { sandbox, log }) {
    const problems = packages.map(checkPackageSpec).filter(Boolean);
    if (problems.length) return { isError: true, content: problems.join("\n") };
    // Every install is logged: install scripts run arbitrary code (see SECURITY.md).
    log.info({ packages, dev }, "agent install_packages");
    const r = await sandbox.exec(
      `npm install --no-audit --no-fund --loglevel=error ${dev ? "--save-dev " : ""}${packages.join(" ")}`,
      { timeoutSecs: 180 },
    );
    if (r.exitCode !== 0) {
      return {
        isError: true,
        content: `npm install failed (exit ${r.exitCode}${r.timedOut ? ", timed out" : ""}):\n${r.stderr || r.stdout}`,
      };
    }
    return {
      content: `Installed ${packages.join(", ")}`,
      changedFiles: ["package.json", "package-lock.json"],
    };
  },
});
