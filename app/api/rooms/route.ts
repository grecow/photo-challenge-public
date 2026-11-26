import { cleanCode, database, errorResponse, hashAdminKey, newAdminKey, newCode, roomByCode } from "@/lib/game-server";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; code?: string; name?: string; adminKey?: string; roundDuration?: number };

    if (body.action === "create") {
      const db = database();
      const id = crypto.randomUUID();
      const hostSecret = crypto.randomUUID();
      const adminKey = newAdminKey();
      const adminKeyHash = await hashAdminKey(adminKey);
      const duration = Math.max(15, Math.min(120, Number(body.roundDuration) || 40));
      let code = newCode();
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const existing = await roomByCode(code);
        if (!existing) break;
        code = newCode();
      }
      await db.prepare("INSERT INTO rooms (id, code, host_secret, admin_key_hash, status, round_index, vote_round, round_duration, created_at) VALUES (?, ?, ?, ?, 'lobby', 0, 0, ?, ?)")
        .bind(id, code, hostSecret, adminKeyHash, duration, Date.now()).run();
      return Response.json({ code, hostSecret, adminKey }, { status: 201 });
    }

    if (body.action === "admin_login") {
      const code = cleanCode(body.code ?? "");
      const adminKey = (body.adminKey ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!code || !adminKey) return Response.json({ error: "Le code de partie et la clé admin sont obligatoires." }, { status: 400 });
      const room = await roomByCode(code);
      const matches = room?.admin_key_hash && await hashAdminKey(adminKey) === room.admin_key_hash;
      if (!room || !matches) return Response.json({ error: "Code de partie ou clé admin incorrecte." }, { status: 403 });
      return Response.json({ code, hostSecret: room.host_secret });
    }

    if (body.action === "join") {
      const code = cleanCode(body.code ?? "");
      const name = (body.name ?? "").trim().slice(0, 24);
      if (!code || !name) return Response.json({ error: "Le code et le prénom sont obligatoires." }, { status: 400 });
      const room = await roomByCode(code);
      if (!room) return Response.json({ error: "Cette partie n’existe pas." }, { status: 404 });
      if (room.status !== "lobby") return Response.json({ error: "La partie a déjà commencé." }, { status: 409 });
      const playerId = crypto.randomUUID();
      const playerToken = crypto.randomUUID();
      await database().prepare("INSERT INTO players (id, room_id, name, token, joined_at) VALUES (?, ?, ?, ?, ?)")
        .bind(playerId, room.id, name, playerToken, Date.now()).run();
      return Response.json({ code, playerId, playerToken, name }, { status: 201 });
    }

    return Response.json({ error: "Action inconnue." }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
