import { NextResponse } from "next/server";

import { readSettings } from "@/lib/server/settings";
import { readNewsroom } from "@/lib/server/newsroom";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const settings = await readSettings();
    const day = new URL(request.url).searchParams.get("day") || undefined;
    return NextResponse.json(readNewsroom(settings, day ?? undefined));
  } catch (error) {
    return NextResponse.json(
      {
        configured: true,
        rootReadable: false,
        day: "",
        available: false,
        complete: false,
        counts: { considered: 0, selected: 0, quarantined: 0, alsoNoted: 0, published: 0 },
        tallies: [],
        candidates: [],
        days: [],
        error: error instanceof Error ? error.message : "Could not read the newsroom.",
      },
      { status: 200 },
    );
  }
}
