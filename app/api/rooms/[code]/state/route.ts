import { advanceExpiredRound, database, errorResponse, mediaUrl, playerByToken, roomByCode } from "@/lib/game-server";

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    let room = await roomByCode(code);
    if (!room) return Response.json({ error: "Partie introuvable." }, { status: 404 });
    room = await advanceExpiredRound(room);

    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const self = await playerByToken(room.id, token);
    const isHost = request.headers.get("x-host-secret") === room.host_secret;
    const db = database();

    const [playersResult, teamsResult, promptsResult] = await Promise.all([
      db.prepare("SELECT id, name, team_id, joined_at FROM players WHERE room_id = ? ORDER BY joined_at").bind(room.id).all(),
      db.prepare("SELECT id, name, color, sort_order FROM teams WHERE room_id = ? ORDER BY sort_order").bind(room.id).all(),
      db.prepare("SELECT id, round_number, object_key FROM prompts WHERE room_id = ? ORDER BY round_number").bind(room.id).all(),
    ]);

    const players = playersResult.results as Array<{ id: string; name: string; team_id: string | null; joined_at: number }>;
    const rawTeams = teamsResult.results as Array<{ id: string; name: string; color: string; sort_order: number }>;
    const prompts = promptsResult.results as Array<{ id: string; round_number: number; object_key: string }>;
    const roundNumber = room.status === "voting" ? room.vote_round : room.round_index;
    const currentPrompt = prompts.find((prompt) => prompt.round_number === roundNumber) ?? null;

    const submissionResult = await db.prepare("SELECT s.id, s.team_id, s.object_key, s.submitted_at, t.name AS team_name, t.color FROM submissions s JOIN teams t ON t.id = s.team_id WHERE s.room_id = ? AND s.round_number = ? ORDER BY t.sort_order")
      .bind(room.id, roundNumber).all();
    const submissions = submissionResult.results as Array<{ id: string; team_id: string; object_key: string; submitted_at: number; team_name: string; color: string }>;

    let myVote: string | null = null;
    if (self && room.status === "voting") {
      const vote = await db.prepare("SELECT team_id FROM votes WHERE room_id = ? AND round_number = ? AND player_id = ? LIMIT 1")
        .bind(room.id, room.vote_round, self.id).first<{ team_id: string }>();
      myVote = vote?.team_id ?? null;
    }

    let ranking: Array<{ teamId: string; name: string; color: string; score: number }> = [];
    if (room.status === "results") {
      const result = await db.prepare("SELECT t.id AS team_id, t.name, t.color, COUNT(v.id) AS score FROM teams t LEFT JOIN votes v ON v.team_id = t.id AND v.room_id = t.room_id WHERE t.room_id = ? GROUP BY t.id, t.name, t.color, t.sort_order ORDER BY score DESC, t.sort_order ASC")
        .bind(room.id).all();
      ranking = (result.results as Array<{ team_id: string; name: string; color: string; score: number }>).map((row) => ({ teamId: row.team_id, name: row.name, color: row.color, score: Number(row.score) }));
    }

    const teams = rawTeams.map((team) => ({
      id: team.id,
      name: team.name,
      color: team.color,
      members: players.filter((player) => player.team_id === team.id).map((player) => ({ id: player.id, name: player.name })),
      submitted: submissions.some((submission) => submission.team_id === team.id),
    }));

    return Response.json({
      serverNow: Date.now(),
      isHost,
      self: self ? { id: self.id, name: self.name, teamId: self.team_id } : null,
      room: {
        code: room.code,
        status: room.status,
        roundIndex: room.round_index,
        voteRound: room.vote_round,
        voteCandidateIndex: room.vote_candidate_index,
        roundDuration: room.round_duration,
        endsAt: room.round_ends_at,
        totalRounds: prompts.length,
      },
      players: players.map((player) => ({ id: player.id, name: player.name, teamId: player.team_id })),
      teams,
      prompts: isHost && room.status === "lobby" ? prompts.map((prompt) => ({ id: prompt.id, roundNumber: prompt.round_number, imageUrl: mediaUrl(prompt.object_key) })) : [],
      reference: currentPrompt ? { roundNumber: currentPrompt.round_number, imageUrl: mediaUrl(currentPrompt.object_key) } : null,
      gallery: room.status === "voting" ? submissions.map((submission) => ({ id: submission.id, teamId: submission.team_id, teamName: submission.team_name, color: submission.color, imageUrl: mediaUrl(submission.object_key) })) : [],
      myVote,
      ranking,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
