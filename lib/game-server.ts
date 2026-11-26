import { env } from "cloudflare:workers";

export type RoomRow = {
  id: string;
  code: string;
  host_secret: string;
  admin_key_hash: string | null;
  status: "lobby" | "challenge" | "voting" | "results";
  round_index: number;
  vote_round: number;
  vote_candidate_index: number;
  round_duration: number;
  round_ends_at: number | null;
  created_at: number;
};

export function database() {
  if (!env.DB) throw new Error("La base de données est indisponible.");
  return env.DB;
}

export function bucket() {
  if (!env.BUCKET) throw new Error("Le stockage des photos est indisponible.");
  return env.BUCKET;
}

export function cleanCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

export function newCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function newAdminKey() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export async function hashAdminKey(value: string) {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function mediaUrl(key: string) {
  return `/api/media/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export async function roomByCode(code: string) {
  return database().prepare("SELECT * FROM rooms WHERE code = ? LIMIT 1").bind(cleanCode(code)).first<RoomRow>();
}

export function requireHost(room: RoomRow, secret: string | null) {
  if (!secret || secret !== room.host_secret) throw new Response("Accès organisateur refusé.", { status: 403 });
}

export async function playerByToken(roomId: string, token: string | null) {
  if (!token) return null;
  return database().prepare("SELECT id, room_id, team_id, name, token FROM players WHERE room_id = ? AND token = ? LIMIT 1")
    .bind(roomId, token).first<{ id: string; room_id: string; team_id: string | null; name: string; token: string }>();
}

export async function requirePlayer(roomId: string, token: string | null) {
  const player = await playerByToken(roomId, token);
  if (!player) throw new Response("Session joueur introuvable.", { status: 403 });
  return player;
}

export async function advanceExpiredRound(room: RoomRow) {
  if (room.status !== "challenge" || !room.round_ends_at || Date.now() < room.round_ends_at) return room;
  const count = await database().prepare("SELECT COUNT(*) AS count FROM prompts WHERE room_id = ?").bind(room.id).first<{ count: number }>();
  const total = Number(count?.count ?? 0);
  if (room.round_index + 1 < total) {
    await database().prepare("UPDATE rooms SET round_index = ?, round_ends_at = ? WHERE id = ? AND status = 'challenge' AND round_index = ?")
      .bind(room.round_index + 1, Date.now() + room.round_duration * 1000, room.id, room.round_index).run();
  } else {
    await database().prepare("UPDATE rooms SET status = 'voting', vote_round = 0, vote_candidate_index = 0, round_ends_at = NULL WHERE id = ? AND status = 'challenge'")
      .bind(room.id).run();
  }
  return (await roomByCode(room.code)) ?? room;
}

export function errorResponse(error: unknown) {
  if (error instanceof Response) return error;
  console.error(error);
  return Response.json({ error: error instanceof Error ? error.message : "Une erreur est survenue." }, { status: 500 });
}
