import { checkDatabase } from "@/lib/db/health";
import { checkStorage } from "@/lib/storage/artifacts";

export const runtime = "nodejs";

export async function GET() {
  const database = await checkDatabase();
  const storage = await checkStorage();
  const ready = database.status === "ok" && storage.status === "ok";
  return Response.json(
    {
      status: ready ? "ok" : "not_ready",
      service: "knowledge-source-service",
      checks: {
        database,
        storage,
      },
    },
    { status: ready ? 200 : 503 },
  );
}
