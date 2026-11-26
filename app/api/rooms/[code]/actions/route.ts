import { bucket, database, errorResponse, requireHost, requirePlayer, roomByCode } from "@/lib/game-server";

const TEAM_NAMES = ["Flash", "Pixel", "Pose", "Zoom", "Néon", "Clic", "Pop", "Focus"];
const TEAM_COLORS = ["#ff3d81", "#62e7d2", "#ffc857", "#8d75ff", "#ff7b54", "#55a9ff", "#d6ff63", "#ef77ff"];

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    const room = await roomByCode(code);
    if (!room) return Response.json({ error: "Partie introuvable." }, { status: 404 });
    const body = await request.json() as { action?: string; hostSecret?: string; playerToken?: string; teamId?: string | null; playerId?: string; promptId?: string; teamCount?: number; name?: string; candidateIndex?: number };
    const db = database();

    if (body.action === "set_team_count") {
      requireHost(room, body.hostSecret ?? null);
      if (room.status !== "lobby") return Response.json({ error: "La partie a déjà commencé." }, { status: 409 });
      const teamCount = Math.max(2, Math.min(10, Math.round(Number(body.teamCount) || 2)));
      const currentResult = await db.prepare("SELECT id, sort_order FROM teams WHERE room_id = ? ORDER BY sort_order").bind(room.id).all();
      const current = currentResult.results as Array<{ id: string; sort_order: number }>;
      const statements = [];
      if (current.length < teamCount) {
        for (let index = current.length; index < teamCount; index += 1) {
          statements.push(db.prepare("INSERT INTO teams (id, room_id, name, color, sort_order) VALUES (?, ?, ?, ?, ?)")
            .bind(crypto.randomUUID(), room.id, `Équipe ${TEAM_NAMES[index] ?? index + 1}`, TEAM_COLORS[index % TEAM_COLORS.length], index));
        }
      } else if (current.length > teamCount) {
        for (const team of current.slice(teamCount)) {
          statements.push(db.prepare("UPDATE players SET team_id = NULL WHERE room_id = ? AND team_id = ?").bind(room.id, team.id));
          statements.push(db.prepare("DELETE FROM teams WHERE id = ? AND room_id = ?").bind(team.id, room.id));
        }
      }
      if (statements.length) await db.batch(statements);
      return Response.json({ ok: true, teamCount });
    }

    if (body.action === "assign_player") {
      requireHost(room, body.hostSecret ?? null);
      if (room.status !== "lobby") return Response.json({ error: "La partie a déjà commencé." }, { status: 409 });
      const player = await db.prepare("SELECT id FROM players WHERE id = ? AND room_id = ?").bind(body.playerId, room.id).first<{ id: string }>();
      if (!player) return Response.json({ error: "Joueur introuvable." }, { status: 404 });
      if (body.teamId) {
        const team = await db.prepare("SELECT id FROM teams WHERE id = ? AND room_id = ?").bind(body.teamId, room.id).first<{ id: string }>();
        if (!team) return Response.json({ error: "Équipe introuvable." }, { status: 404 });
      }
      await db.prepare("UPDATE players SET team_id = ? WHERE id = ? AND room_id = ?").bind(body.teamId || null, player.id, room.id).run();
      return Response.json({ ok: true });
    }

    if (body.action === "rename_team") {
      requireHost(room, body.hostSecret ?? null);
      if (room.status !== "lobby") return Response.json({ error: "La partie a déjà commencé." }, { status: 409 });
      const name = (body.name ?? "").trim().slice(0, 24);
      if (!name) return Response.json({ error: "Le nom de l’équipe est obligatoire." }, { status: 400 });
      const result = await db.prepare("UPDATE teams SET name = ? WHERE id = ? AND room_id = ?").bind(name, body.teamId, room.id).run();
      if (!result.meta.changes) return Response.json({ error: "Équipe introuvable." }, { status: 404 });
      return Response.json({ ok: true });
    }

    if (body.action === "start") {
      requireHost(room, body.hostSecret ?? null);
      if (room.status !== "lobby") return Response.json({ error: "La partie a déjà commencé." }, { status: 409 });
      const playersResult = await db.prepare("SELECT id, team_id FROM players WHERE room_id = ? ORDER BY joined_at").bind(room.id).all();
      const players = playersResult.results as Array<{ id: string; team_id: string | null }>;
      const teamsResult = await db.prepare("SELECT id FROM teams WHERE room_id = ? ORDER BY sort_order").bind(room.id).all();
      const teams = teamsResult.results as Array<{ id: string }>;
      const promptCount = await db.prepare("SELECT COUNT(*) AS count FROM prompts WHERE room_id = ?").bind(room.id).first<{ count: number }>();
      if (players.length < 2) return Response.json({ error: "Il faut au moins deux joueurs." }, { status: 400 });
      if (teams.length < 2) return Response.json({ error: "Crée au moins deux équipes." }, { status: 400 });
      if (players.some((player) => !player.team_id)) return Response.json({ error: "Affecte chaque joueur à une équipe." }, { status: 400 });
      if (teams.some((team) => !players.some((player) => player.team_id === team.id))) return Response.json({ error: "Chaque équipe doit avoir au moins un joueur." }, { status: 400 });
      if (Number(promptCount?.count ?? 0) < 1) return Response.json({ error: "Ajoute au moins une photo modèle." }, { status: 400 });

      const statements = [
        db.prepare("DELETE FROM votes WHERE room_id = ?").bind(room.id),
        db.prepare("DELETE FROM submissions WHERE room_id = ?").bind(room.id),
      ];
      statements.push(db.prepare("UPDATE rooms SET status = 'challenge', round_index = 0, vote_round = 0, vote_candidate_index = 0, round_ends_at = ? WHERE id = ?")
        .bind(Date.now() + room.round_duration * 1000, room.id));
      await db.batch(statements);
      return Response.json({ ok: true });
    }

    if (body.action === "next_vote") {
      requireHost(room, body.hostSecret ?? null);
      if (room.status !== "voting") return Response.json({ error: "Le vote n’est pas ouvert." }, { status: 409 });
      const promptCount = await db.prepare("SELECT COUNT(*) AS count FROM prompts WHERE room_id = ?").bind(room.id).first<{ count: number }>();
      if (room.vote_round + 1 < Number(promptCount?.count ?? 0)) {
        await db.prepare("UPDATE rooms SET vote_round = vote_round + 1, vote_candidate_index = 0 WHERE id = ?").bind(room.id).run();
      } else {
        await db.prepare("UPDATE rooms SET status = 'results' WHERE id = ?").bind(room.id).run();
      }
      return Response.json({ ok: true });
    }

    if (body.action === "set_vote_candidate") {
      requireHost(room, body.hostSecret ?? null);
      if (room.status !== "voting") return Response.json({ error: "Le vote n’est pas ouvert." }, { status: 409 });
      const count = await db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE room_id = ? AND round_number = ?").bind(room.id, room.vote_round).first<{ count: number }>();
      const total = Number(count?.count ?? 0);
      if (total < 1) return Response.json({ error: "Aucune photo à afficher." }, { status: 400 });
      const candidateIndex = Math.max(0, Math.min(total - 1, Math.round(Number(body.candidateIndex) || 0)));
      await db.prepare("UPDATE rooms SET vote_candidate_index = ? WHERE id = ?").bind(candidateIndex, room.id).run();
      return Response.json({ ok: true, candidateIndex });
    }

    if (body.action === "vote") {
      if (room.status !== "voting") return Response.json({ error: "Le vote n’est pas ouvert." }, { status: 409 });
      const player = await requirePlayer(room.id, body.playerToken ?? null);
      const target = await db.prepare("SELECT id FROM teams WHERE id = ? AND room_id = ?").bind(body.teamId, room.id).first<{ id: string }>();
      if (!target) return Response.json({ error: "Équipe inconnue." }, { status: 404 });
      if (player.team_id === target.id) return Response.json({ error: "Tu ne peux pas voter pour ton équipe." }, { status: 400 });
      await db.prepare("INSERT INTO votes (id, room_id, round_number, player_id, team_id, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(room_id, round_number, player_id) DO UPDATE SET team_id = excluded.team_id, created_at = excluded.created_at")
        .bind(crypto.randomUUID(), room.id, room.vote_round, player.id, target.id, Date.now()).run();
      return Response.json({ ok: true });
    }

    if (body.action === "remove_prompt") {
      requireHost(room, body.hostSecret ?? null);
      if (room.status !== "lobby") return Response.json({ error: "La partie a déjà commencé." }, { status: 409 });
      const prompt = await db.prepare("SELECT id, round_number, object_key FROM prompts WHERE id = ? AND room_id = ?").bind(body.promptId, room.id)
        .first<{ id: string; round_number: number; object_key: string }>();
      if (!prompt) return Response.json({ error: "Photo introuvable." }, { status: 404 });
      await db.batch([
        db.prepare("DELETE FROM prompts WHERE id = ?").bind(prompt.id),
        db.prepare("UPDATE prompts SET round_number = round_number - 1 WHERE room_id = ? AND round_number > ?").bind(room.id, prompt.round_number),
      ]);
      await bucket().delete(prompt.object_key);
      return Response.json({ ok: true });
    }

    if (body.action === "restart") {
      requireHost(room, body.hostSecret ?? null);
      const old = await db.prepare("SELECT object_key FROM submissions WHERE room_id = ?").bind(room.id).all();
      const keys = (old.results as Array<{ object_key: string }>).map((row) => row.object_key);
      await db.batch([
        db.prepare("DELETE FROM votes WHERE room_id = ?").bind(room.id),
        db.prepare("DELETE FROM submissions WHERE room_id = ?").bind(room.id),
        db.prepare("UPDATE rooms SET status = 'lobby', round_index = 0, vote_round = 0, vote_candidate_index = 0, round_ends_at = NULL WHERE id = ?").bind(room.id),
      ]);
      if (keys.length) await bucket().delete(keys);
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Action inconnue." }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
