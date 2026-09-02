import { NextResponse } from "next/server";

import { readSettings } from "@/lib/server/settings";
import { isPipelineAction, runPipelineCommand, PIPELINE_ACTIONS } from "@/lib/server/pipeline-command";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    actions: Object.entries(PIPELINE_ACTIONS).map(([id, spec]) => ({ id, label: spec.label })),
  });
}

export async function POST(request: Request) {
  let body: { action?: unknown; payload?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Send a JSON body naming an action." }, { status: 400 });
  }
  if (!isPipelineAction(body.action))
    return NextResponse.json({ error: "That is not an action this dashboard can run." }, { status: 400 });

  const settings = await readSettings();
  try {
    return NextResponse.json(await runPipelineCommand(settings, body.action, body.payload));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The command could not be started." },
      { status: 500 },
    );
  }
}
