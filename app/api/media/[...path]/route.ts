import { bucket, errorResponse } from "@/lib/game-server";

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await context.params;
    const key = path.map(decodeURIComponent).join("/");
    if (!key.startsWith("rooms/")) return new Response("Introuvable", { status: 404 });
    const object = await bucket().get(key);
    if (!object) return new Response("Introuvable", { status: 404 });
    const headers = new Headers({ "cache-control": "private, max-age=3600", etag: object.httpEtag });
    object.writeHttpMetadata(headers);
    return new Response(object.body, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
