import { describe, expect, it } from "vitest";
import { APP_DIR } from "./config";
import { isProtectedPath, resolveProjectPath, toRelative } from "./paths";

describe("resolveProjectPath", () => {
  it("resolves relative paths under the app dir", () => {
    expect(resolveProjectPath("src/App.tsx")).toBe(`${APP_DIR}/src/App.tsx`);
    expect(resolveProjectPath("./src/./lib/utils.ts")).toBe(`${APP_DIR}/src/lib/utils.ts`);
    expect(resolveProjectPath(".")).toBe(APP_DIR);
  });

  it.each([
    ["../etc/passwd", /'\.\.'/],
    ["src/../../x", /'\.\.'/],
    ["src\\..\\..\\x", /'\.\.'/],
    ["/etc/passwd", /absolute/],
    ["~/x", /absolute/],
    ["C:\\x", /absolute/],
    ["a\0b", /NUL/],
    ["", /empty/],
  ])("rejects %j", (input, msg) => {
    expect(() => resolveProjectPath(input)).toThrow(msg);
  });
});

describe("isProtectedPath", () => {
  it("guards .git and node_modules", () => {
    expect(isProtectedPath(`${APP_DIR}/.git/config`)).toBe(true);
    expect(isProtectedPath(`${APP_DIR}/node_modules/react/index.js`)).toBe(true);
    expect(isProtectedPath(`${APP_DIR}/src/.gitkeep`)).toBe(false);
    expect(isProtectedPath(`${APP_DIR}/.gitignore`)).toBe(false);
  });
});

it("toRelative", () => {
  expect(toRelative(`${APP_DIR}/src/a.ts`)).toBe("src/a.ts");
  expect(toRelative(APP_DIR)).toBe(".");
});
