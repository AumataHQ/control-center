import { NextResponse } from "next/server";

import { readSettings } from "@/lib/server/settings";
import { readPipelineSnapshot } from "@/lib/server/pipeline";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const settings = await readSettings();
    const day = new URL(request.url).searchParams.get("day") || undefined;
    return NextResponse.json(readPipelineSnapshot(settings, day ?? undefined));
  } catch (error) {
    return NextResponse.json(
      {
        configured: true,
        rootReadable: false,
        day: "",
        editions: [],
        sources: [],
        error: error instanceof Error ? error.message : "Could not read the pipeline directory.",
      },
      { status: 200 },
    );
  }
}
