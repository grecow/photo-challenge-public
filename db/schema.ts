import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  hostSecret: text("host_secret").notNull(),
  adminKeyHash: text("admin_key_hash"),
  status: text("status").notNull().default("lobby"),
  roundIndex: integer("round_index").notNull().default(0),
  voteRound: integer("vote_round").notNull().default(0),
  voteCandidateIndex: integer("vote_candidate_index").notNull().default(0),
  roundDuration: integer("round_duration").notNull().default(40),
  roundEndsAt: integer("round_ends_at"),
  createdAt: integer("created_at").notNull(),
});

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull(),
  sortOrder: integer("sort_order").notNull(),
}, (table) => [index("idx_teams_room_id").on(table.roomId)]);

export const players = sqliteTable("players", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  token: text("token").notNull().unique(),
  joinedAt: integer("joined_at").notNull(),
}, (table) => [index("idx_players_room_id").on(table.roomId)]);

export const prompts = sqliteTable("prompts", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  roundNumber: integer("round_number").notNull(),
  objectKey: text("object_key").notNull(),
  mimeType: text("mime_type").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [uniqueIndex("idx_prompts_room_round").on(table.roomId, table.roundNumber)]);

export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  roundNumber: integer("round_number").notNull(),
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  objectKey: text("object_key").notNull(),
  mimeType: text("mime_type").notNull(),
  submittedAt: integer("submitted_at").notNull(),
}, (table) => [uniqueIndex("idx_submissions_room_round_team").on(table.roomId, table.roundNumber, table.teamId)]);

export const votes = sqliteTable("votes", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  roundNumber: integer("round_number").notNull(),
  playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_votes_room_round_player").on(table.roomId, table.roundNumber, table.playerId),
  index("idx_votes_room_team").on(table.roomId, table.teamId),
]);
