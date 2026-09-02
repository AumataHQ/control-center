import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

function apiRequest(origin?: string, host = "127.0.0.1:3000") {
  return new NextRequest(`http://${host}/api/brief`, {
    headers: {
      host,
      ...(origin ? { origin } : {}),
    },
  });
}

function withAllowedHosts<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.CONTROL_CENTER_ALLOWED_HOSTS;
  if (value === undefined) delete process.env.CONTROL_CENTER_ALLOWED_HOSTS;
  else process.env.CONTROL_CENTER_ALLOWED_HOSTS = value;
  try {
    return run();
  } finally {
    if (previous === undefined)
      delete process.env.CONTROL_CENTER_ALLOWED_HOSTS;
    else process.env.CONTROL_CENTER_ALLOWED_HOSTS = previous;
  }
}

test("proxy allows browser requests only from the exact API origin", () => {
  assert.equal(proxy(apiRequest("http://127.0.0.1:3000")).status, 200);
  assert.equal(proxy(apiRequest("http://127.0.0.1:3001")).status, 403);
  assert.equal(proxy(apiRequest("http://localhost:3000")).status, 403);
  assert.equal(proxy(apiRequest("https://127.0.0.1:3000")).status, 403);
});

test("proxy allows local CLI requests without an Origin header", () => {
  assert.equal(proxy(apiRequest()).status, 200);
});

test("proxy refuses hostnames that are not on the allowlist", () => {
  withAllowedHosts(undefined, () => {
    assert.equal(proxy(apiRequest(undefined, "control.example:3000")).status, 403);
    assert.equal(proxy(apiRequest(undefined, "100.121.13.81:3000")).status, 403);
  });
});

test("proxy answers on an allowlisted hostname, on any port", () => {
  withAllowedHosts("100.121.13.81, truenas.tail0000.ts.net", () => {
    assert.equal(proxy(apiRequest(undefined, "100.121.13.81:3000")).status, 200);
    assert.equal(proxy(apiRequest(undefined, "100.121.13.81:8080")).status, 200);
    assert.equal(
      proxy(apiRequest(undefined, "TrueNAS.Tail0000.ts.net:3000")).status,
      200,
    );
    assert.equal(proxy(apiRequest(undefined, "evil.example:3000")).status, 403);
  });
});

test("an allowlisted host still requires a same-origin browser request", () => {
  withAllowedHosts("100.121.13.81", () => {
    assert.equal(
      proxy(apiRequest("http://100.121.13.81:3000", "100.121.13.81:3000")).status,
      200,
    );
    assert.equal(
      proxy(apiRequest("http://evil.example", "100.121.13.81:3000")).status,
      403,
    );
  });
});

test("loopback keeps working once an allowlist is configured", () => {
  withAllowedHosts("100.121.13.81", () => {
    assert.equal(proxy(apiRequest()).status, 200);
  });
});
