import { describe, it, expect, vi } from "vitest";
import { compareSemver, checkForUpdate, __resetUpdateCache } from "../../src/tools/meta.js";

describe("compareSemver", () => {
  it("orders versions", () => {
    expect(compareSemver("1.12.0", "1.6.0")).toBe(1);
    expect(compareSemver("1.6.0", "1.12.0")).toBe(-1);
    expect(compareSemver("1.6.0", "1.6.0")).toBe(0);
  });
});

describe("checkForUpdate", () => {
  it("flags an available update", async () => {
    __resetUpdateCache();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(
      { tag_name: "v1.12.0", html_url: "https://gh/rel", published_at: "2026-08-11T03:34:08Z" }
    ), { status: 200 }));
    const r = await checkForUpdate({ current: "1.6.0", fetchImpl, now: () => 1000 });
    expect(r).toMatchObject({ current: "1.6.0", latest: "1.12.0", updateAvailable: true });
  });

  it("uses cache within TTL (no second fetch)", async () => {
    __resetUpdateCache();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ tag_name: "v1.12.0" }), { status: 200 }));
    await checkForUpdate({ current: "1.6.0", fetchImpl, now: () => 1000 });
    await checkForUpdate({ current: "1.6.0", fetchImpl, now: () => 1000 + 60_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("degrades to null on network error", async () => {
    __resetUpdateCache();
    const fetchImpl = vi.fn(async () => { throw new Error("offline"); });
    const r = await checkForUpdate({ current: "1.6.0", fetchImpl, now: () => 1000 });
    expect(r.updateAvailable).toBeNull();
    expect(r.error).toBeDefined();
  });
});
