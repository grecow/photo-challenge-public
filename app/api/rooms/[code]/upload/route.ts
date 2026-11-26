import { bucket, database, errorResponse, requireHost, requirePlayer, roomByCode } from "@/lib/game-server";

function extension(type: string) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    const room = await roomByCode(code);
    if (!room) return Response.json({ error: "Partie introuvable." }, { status: 404 });
    const form = await request.formData();
    const kind = String(form.get("kind") ?? "");
    const image = form.get("image");
    if (!(image instanceof File) || !image.type.startsWith("image/")) return Response.json({ error: "Choisis une image valide." }, { status: 400 });
    if (image.size > 6 * 1024 * 1024) return Response.json({ error: "L’image dépasse 6 Mo." }, { status: 413 });
    const db = database();

    if (kind === "prompt") {
      requireHost(room, String(form.get("hostSecret") ?? ""));
      if (room.status !== "lobby") return Response.json({ error: "La partie a déjà commencé." }, { status: 409 });
      const count = await db.prepare("SELECT COUNT(*) AS count FROM prompts WHERE room_id = ?").bind(room.id).first<{ count: number }>();
      const roundNumber = Number(count?.count ?? 0);
      if (roundNumber >= 10) return Response.json({ error: "Le maximum est de dix manches." }, { status: 400 });
      const key = `rooms/${room.id}/prompts/${crypto.randomUUID()}.${extension(image.type)}`;
      await bucket().put(key, image.stream(), { httpMetadata: { contentType: image.type } });
      await db.prepare("INSERT INTO prompts (id, room_id, round_number, object_key, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), room.id, roundNumber, key, image.type, Date.now()).run();
      return Response.json({ ok: true, roundNumber }, { status: 201 });
    }

    if (kind === "submission") {
      const player = await requirePlayer(room.id, String(form.get("playerToken") ?? ""));
      if (room.status !== "challenge" || !player.team_id) return Response.json({ error: "Aucune manche photo n’est ouverte." }, { status: 409 });
      if (room.round_ends_at && Date.now() > room.round_ends_at + 1500) return Response.json({ error: "Le chrono est terminé." }, { status: 409 });
      const key = `rooms/${room.id}/submissions/${room.round_index}/${player.team_id}-${crypto.randomUUID()}.${extension(image.type)}`;
      const previous = await db.prepare("SELECT object_key FROM submissions WHERE room_id = ? AND round_number = ? AND team_id = ?")
        .bind(room.id, room.round_index, player.team_id).first<{ object_key: string }>();
      await bucket().put(key, image.stream(), { httpMetadata: { contentType: image.type } });
      await db.prepare("INSERT INTO submissions (id, room_id, round_number, team_id, player_id, object_key, mime_type, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(room_id, round_number, team_id) DO UPDATE SET player_id = excluded.player_id, object_key = excluded.object_key, mime_type = excluded.mime_type, submitted_at = excluded.submitted_at")
        .bind(crypto.randomUUID(), room.id, room.round_index, player.team_id, player.id, key, image.type, Date.now()).run();
      if (previous?.object_key) await bucket().delete(previous.object_key);
      return Response.json({ ok: true, submittedAt: Date.now() }, { status: 201 });
    }

    return Response.json({ error: "Type d’envoi inconnu." }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
