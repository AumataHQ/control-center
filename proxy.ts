import { NextResponse, type NextRequest } from "next/server";
import { configuredHosts, isAllowedHost } from "./lib/allowed-hosts";

function isSameOrigin(value: string, request: NextRequest) {
  try {
    const requestUrl = new URL(request.url);
    requestUrl.host = request.headers.get("host") || requestUrl.host;
    return new URL(value).origin === requestUrl.origin;
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const allowed = configuredHosts();
  if (!isAllowedHost(host, allowed)) {
    return NextResponse.json(
      {
        error: allowed.size
          ? "Control Center does not answer on that hostname."
          : "Control Center only accepts requests from this computer.",
      },
      { status: 403 },
    );
  }
  const origin = request.headers.get("origin");
  if (origin && !isSameOrigin(origin, request)) {
    return NextResponse.json(
      { error: "Cross-site requests are blocked." },
      { status: 403 },
    );
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
