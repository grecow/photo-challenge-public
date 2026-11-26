"use client";

import {
  Camera, Check, ChevronLeft, ChevronRight, CircleX, Copy, Images, KeyRound, LoaderCircle,
  LogOut, Maximize2, Minus, Monitor, PartyPopper, Play, Plus, RotateCcw, ShieldCheck, Sparkles, SwitchCamera, Trash2, Trophy, Users,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Session = { role: "host" | "player" | "screen"; code: string; secret: string; name?: string; adminKey?: string };
type Team = { id: string; name: string; color: string; members: Array<{ id: string; name: string }>; submitted: boolean };
type PromptUpload = { id: string; name: string; preview: string | null; status: "preparing" | "uploading" | "done" | "error"; progress: number; error?: string };
type GameState = {
  serverNow: number;
  isHost: boolean;
  self: { id: string; name: string; teamId: string | null } | null;
  room: { code: string; status: "lobby" | "challenge" | "voting" | "results"; roundIndex: number; voteRound: number; voteCandidateIndex: number; roundDuration: number; endsAt: number | null; totalRounds: number };
  players: Array<{ id: string; name: string; teamId: string | null }>;
  teams: Team[];
  prompts: Array<{ id: string; roundNumber: number; imageUrl: string }>;
  reference: { roundNumber: number; imageUrl: string } | null;
  gallery: Array<{ id: string; teamId: string; teamName: string; color: string; imageUrl: string }>;
  myVote: string | null;
  ranking: Array<{ teamId: string; name: string; color: string; score: number }>;
};

const SESSION_KEY = "defi-photo-session";

async function readJson<T = { ok: boolean }>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "La demande a échoué.");
  return data;
}

function Bi({ fr, ru, className = "" }: { fr: string; ru: string; className?: string }) {
  return <span className={`bi-copy ${className}`}><span>{fr}</span><span lang="ru">{ru}</span></span>;
}

async function optimizePhoto(file: File) {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Cette photo ne peut pas être lue. Essaie une version JPEG ou PNG."));
      image.src = sourceUrl;
    });
    const maxDimension = 1600;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("La photo n’a pas pu être préparée.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let quality = .82;
    let blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("La photo n’a pas pu être compressée.")), "image/jpeg", quality));
    while (blob.size > 5 * 1024 * 1024 && quality > .46) {
      quality -= .12;
      blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("La photo n’a pas pu être compressée.")), "image/jpeg", quality));
    }
    return blob;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function useCountdown(endsAt: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [endsAt]);
  return endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : 0;
}

function Brand({ onLeave, role }: { onLeave?: () => void; role?: "Admin" | "Joueur" | "Écran" }) {
  const roleLabel = role === "Admin" ? "Admin · Ведущий" : role === "Joueur" ? "Joueur · Игрок" : role === "Écran" ? "Écran · Экран" : "";
  async function toggleFullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { /* Le navigateur peut refuser le plein écran. */ }
  }
  return (
    <header className="relative z-10 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 font-black tracking-tight">
        <span className="grid size-10 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25"><Camera className="size-5" /></span>
        <span className="text-lg">Défi Photo</span>
        {role && <span className="role-badge">{roleLabel}</span>}
      </div>
      <div className="flex items-center gap-1">
        {role === "Admin" && <Button type="button" variant="ghost" size="sm" onClick={() => void toggleFullscreen()} className="fullscreen-button rounded-full text-muted-foreground"><Maximize2 /><span>Plein écran · Полный экран</span></Button>}
        {onLeave && <Button variant="ghost" size="sm" onClick={onLeave} className="leave-button rounded-full text-muted-foreground"><LogOut /><span>Sortir · Выйти</span></Button>}
      </div>
    </header>
  );
}

function HomeScreen({ onSession }: { onSession: (session: Session) => void }) {
  const [roomCode, setRoomCode] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "");
  const [name, setName] = useState("");
  const [adminCode, setAdminCode] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const join = useCallback(async (code = roomCode, playerName = name) => {
    const cleanName = playerName.trim();
    const cleanCode = code.trim().toUpperCase();
    if (!cleanName || !cleanCode) throw new Error("Indique le code et ton prénom.");
    setBusy(true); setError("");
    try {
      const data = await readJson<{ code: string; playerToken: string; name: string }>(await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "join", code: cleanCode, name: cleanName }) }));
      onSession({ role: "player", code: data.code, secret: data.playerToken, name: data.name });
      return { joined: true, code: data.code, name: data.name };
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de rejoindre la partie.");
      throw reason;
    } finally { setBusy(false); }
  }, [name, onSession, roomCode]);

  async function create() {
    setBusy(true); setError("");
    try {
      const data = await readJson<{ code: string; hostSecret: string; adminKey: string }>(await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", roundDuration: 40 }) }));
      onSession({ role: "host", code: data.code, secret: data.hostSecret, adminKey: data.adminKey });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible de créer la partie."); }
    finally { setBusy(false); }
  }

  async function resumeAdmin() {
    const code = adminCode.trim().toUpperCase();
    const key = adminKey.trim().toUpperCase();
    if (!code || !key) return;
    setBusy(true); setError("");
    try {
      const data = await readJson<{ code: string; hostSecret: string }>(await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "admin_login", code, adminKey: key }) }));
      onSession({ role: "host", code: data.code, secret: data.hostSecret, adminKey: key });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible de reprendre la partie."); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool?: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: "join_photo_game",
      title: "Rejoindre un Défi Photo",
      description: "Rejoint une partie Défi Photo avec un code et un prénom, puis ouvre la salle d’attente.",
      inputSchema: { type: "object", properties: { code: { type: "string" }, name: { type: "string" } }, required: ["code", "name"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input: { code?: string; name?: string }) => join(input.code ?? "", input.name ?? ""),
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [join]);

  return (
    <main className="min-h-svh overflow-hidden bg-background text-foreground">
      <div className="party-orb party-orb-one" /><div className="party-orb party-orb-two" />
      <section className="relative mx-auto flex min-h-svh w-full max-w-6xl flex-col justify-between px-5 py-6 sm:px-10 sm:py-10">
        <Brand />
        <div className="grid items-center gap-10 py-10 lg:grid-cols-[1.08fr_.92fr]">
          <div className="max-w-2xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-secondary/30 bg-secondary/10 px-3 py-1.5 text-sm font-semibold text-secondary"><Sparkles className="size-4" /> Duo photo · Фото вдвоём</div>
            <h1 className="display-title text-balance text-5xl font-black leading-[.95] tracking-[-.055em] sm:text-7xl">Même photo.<br /><span className="text-primary">Votre version.</span><span className="hero-ru" lang="ru">То же фото. Ваша версия.</span></h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground sm:text-xl"><Bi fr="Reproduisez. Photographiez. Votez." ru="Повторяйте. Снимайте. Голосуйте." /></p>
          </div>
          <div className="glass-card rounded-[2rem] p-5 sm:p-7">
            <Tabs defaultValue="player" onValueChange={() => setError("")}>
              <TabsList className="mb-6 grid h-12 w-full grid-cols-2 rounded-2xl bg-white/5 p-1">
                <TabsTrigger value="player" className="rounded-xl font-black"><Users /> Joueur · Игрок</TabsTrigger>
                <TabsTrigger value="admin" className="rounded-xl font-black"><ShieldCheck /> Admin · Ведущий</TabsTrigger>
              </TabsList>
              <TabsContent value="player">
                <div className="mb-6 flex items-start justify-between gap-4">
                  <div><p className="eyebrow">Joueur · Игрок</p><h2 className="mt-1 text-2xl font-black"><Bi fr="Rejoins la partie" ru="Войди в игру" /></h2></div>
                  <span className="icon-tile"><Users className="size-5" /></span>
                </div>
                <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void join().catch(() => undefined); }}>
                  <Input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="Code · Код" className="party-input uppercase tracking-[.22em]" maxLength={6} autoComplete="off" />
                  <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Prénom · Имя" className="party-input" maxLength={24} autoComplete="name" />
                  {error && <p role="alert" className="error-box"><CircleX className="size-4 shrink-0" />{error}</p>}
                  <Button className="h-14 w-full rounded-2xl text-base font-black shadow-lg shadow-primary/20" disabled={busy || !roomCode.trim() || !name.trim()}>
                    {busy ? <LoaderCircle className="animate-spin" /> : <ChevronRight />} <Bi fr="Rejoindre" ru="Войти" />
                  </Button>
                </form>
              </TabsContent>
              <TabsContent value="admin">
                <div className="mb-6 flex items-start justify-between gap-4">
                  <div><p className="eyebrow">Admin · Ведущий</p><h2 className="mt-1 text-2xl font-black"><Bi fr="Pilote le jeu" ru="Управляй игрой" /></h2></div>
                  <span className="icon-tile"><ShieldCheck className="size-5" /></span>
                </div>
                <Button onClick={create} disabled={busy} className="h-14 w-full rounded-2xl text-base font-black shadow-lg shadow-primary/20">{busy ? <LoaderCircle className="animate-spin" /> : <Plus />} <Bi fr="Nouvelle partie" ru="Новая игра" /></Button>
                <div className="divider"><span /> Reprendre · Продолжить <span /></div>
                <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void resumeAdmin(); }}>
                  <Input value={adminCode} onChange={(event) => setAdminCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="Code · Код" className="party-input uppercase tracking-[.22em]" maxLength={6} autoComplete="off" />
                  <Input value={adminKey} onChange={(event) => setAdminKey(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="Clé admin · Ключ" className="party-input uppercase tracking-[.18em]" maxLength={8} autoComplete="off" />
                  {error && <p role="alert" className="error-box"><CircleX className="size-4 shrink-0" />{error}</p>}
                  <Button variant="outline" disabled={busy || !adminCode.trim() || !adminKey.trim()} className="h-12 w-full rounded-2xl border-white/10 bg-white/5 font-bold hover:bg-white/10"><KeyRound /> Reprendre · Продолжить</Button>
                </form>
              </TabsContent>
            </Tabs>
          </div>
        </div>
        <footer className="text-sm text-muted-foreground">Sans compte · Без аккаунта</footer>
      </section>
    </main>
  );
}

function Timer({ endsAt, duration }: { endsAt: number | null; duration: number }) {
  const seconds = useCountdown(endsAt);
  const percent = Math.min(100, Math.max(0, (seconds / duration) * 100));
  return (
    <div className={`timer-pill ${seconds <= 10 ? "timer-urgent" : ""}`}>
      <span className="tabular-nums">{seconds}s</span>
      <Progress value={percent} className="h-1.5 flex-1 bg-white/10" />
    </div>
  );
}

function TeamList({ teams }: { teams: Team[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {teams.map((team) => <div key={team.id} className="team-card" style={{ "--team-color": team.color } as React.CSSProperties}>
        <span className="team-dot" /><div className="min-w-0 flex-1"><p className="font-black">{team.name}</p><p className="truncate text-sm text-muted-foreground">{team.members.map((member) => member.name).join(" + ") || "En attente · Ожидание"}</p></div>
        {team.submitted && <span className="grid size-7 place-items-center rounded-full bg-secondary text-secondary-foreground" title="Photo reçue · Фото получено"><Check className="size-4" /></span>}
      </div>)}
    </div>
  );
}

function CameraCapture({ state, token, refresh }: { state: GameState; token: string; refresh: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [preview, setPreview] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);
  useEffect(() => { setPreview(null); setMessage(""); }, [state.room.roundIndex]);

  async function enableCamera(nextMode: "user" | "environment" = facingMode) {
    setError("");
    setSwitching(true);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: nextMode }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setFacingMode(nextMode);
      setReady(true);
    } catch { setError(nextMode === "environment" ? "La caméra arrière n’est pas disponible. Réactive la caméra avant." : "Autorise la caméra dans ton navigateur pour jouer."); }
    finally { setSwitching(false); }
  }

  async function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setBusy(true); setError(""); setMessage("Envoi en cours…");
    try {
      const maxWidth = 1280;
      const scale = Math.min(1, maxWidth / video.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("La photo n’a pas pu être préparée.");
      if (facingMode === "user") { context.translate(canvas.width, 0); context.scale(-1, 1); }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Photo vide")), "image/jpeg", .84));
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(blob));
      const form = new FormData(); form.set("kind", "submission"); form.set("playerToken", token); form.set("image", blob, "photo.jpg");
      await readJson(await fetch(`/api/rooms/${state.room.code}/upload`, { method: "POST", body: form }));
      setMessage("Photo envoyée · Фото отправлено"); refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Envoi impossible."); setMessage(""); }
    finally { setBusy(false); }
  }

  return (
    <div className="camera-shell">
      <div className="camera-viewport">
        <video ref={videoRef} playsInline muted className={`h-full w-full object-cover ${facingMode === "user" ? "camera-mirrored" : ""} ${ready ? "block" : "hidden"}`} />
        {!ready && <div className="grid h-full place-items-center p-8 text-center"><div>{switching ? <LoaderCircle className="mx-auto size-12 animate-spin text-primary" /> : <Camera className="mx-auto size-12 text-primary" />}<p className="mt-3 font-black">{switching ? "Caméra… · Камера…" : "Active la caméra · Включи камеру"}</p><p className="mt-1 text-sm text-muted-foreground"><Bi fr="Avant : selfie · Arrière : scène" ru="Передняя: селфи · Задняя: сцена" /></p></div></div>}
        {preview && <img src={preview} alt="Dernière photo envoyée" className="absolute bottom-3 right-3 aspect-[3/4] w-20 rounded-xl border-2 border-white object-cover shadow-xl" />}
      </div>
      {error && <p role="alert" className="error-box mt-3"><CircleX className="size-4 shrink-0" />{error}</p>}
      {message && <p className="mt-3 flex items-center gap-2 text-sm font-bold text-secondary"><Check className="size-4" />{message}</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {!ready ? <Button onClick={() => enableCamera()} disabled={switching} className="h-14 rounded-2xl text-base font-black sm:col-span-2">{switching ? <LoaderCircle className="animate-spin" /> : <Camera />} Activer · Включить</Button> : <>
          <Button onClick={capture} disabled={busy || switching} className="h-14 rounded-2xl text-base font-black">{busy ? <LoaderCircle className="animate-spin" /> : <Camera />} Envoyer · Отправить</Button>
          <Button variant="outline" onClick={() => enableCamera(facingMode === "user" ? "environment" : "user")} disabled={busy || switching} className="h-14 rounded-2xl border-white/10 bg-white/5 text-base font-black"><SwitchCamera /> Tourner · Перевернуть</Button>
        </>}
      </div>
      <p className="mt-3 text-center text-xs leading-relaxed text-muted-foreground">Dernière photo gardée · Сохраняется последнее фото</p>
    </div>
  );
}

function CelebrationConfetti() {
  const colors = ["#ff3d81", "#62e7d2", "#ffc857", "#8d75ff", "#55a9ff", "#ff7b54"];
  return <div className="confetti-layer" aria-hidden="true">{Array.from({ length: 54 }, (_, index) => <span key={index} style={{ left: `${(index * 37) % 100}%`, backgroundColor: colors[index % colors.length], animationDelay: `${-(index % 11) * .28}s`, animationDuration: `${3.2 + (index % 7) * .24}s`, width: `${6 + index % 4}px`, height: `${10 + index % 5}px` }} />)}</div>;
}

function VoteShowcase({ state, controls = false, onNavigate }: { state: GameState; controls?: boolean; onNavigate?: (index: number) => void }) {
  const total = state.gallery.length;
  const index = total ? Math.min(Math.max(state.room.voteCandidateIndex, 0), total - 1) : 0;
  const candidate = state.gallery[index];
  if (!candidate) return <div className="vote-empty"><Images className="size-10" /><p className="mt-3 font-black"><Bi fr="Aucune photo" ru="Нет фото" /></p></div>;
  const candidateContent = <><img src={candidate.imageUrl} alt={`Création de ${candidate.teamName}`} /><span className="vote-team-label"><span className="team-dot" style={{ background: candidate.color }} />{candidate.teamName}</span></>;
  const navigate = (next: number) => onNavigate?.((next + total) % total);
  return (
    <section className="vote-showcase">
      <div className="vote-comparison">
        <figure className="vote-comparison-card"><div className="vote-photo-label">Modèle · Оригинал</div>{state.reference ? <img src={state.reference.imageUrl} alt="Photo originale à reproduire" /> : <div className="vote-photo-missing">Indisponible · Нет фото</div>}</figure>
        <figure key={candidate.id} className="vote-comparison-card vote-candidate vote-reveal">{candidateContent}</figure>
      </div>
      <div className="vote-navigation">
        {controls && <Button type="button" size="icon" variant="outline" disabled={total < 2} onClick={() => navigate(index - 1)} aria-label="Photo précédente"><ChevronLeft /></Button>}
        <div><p className="font-black">Photo {index + 1} / {total}</p><div className="vote-dots">{state.gallery.map((item, dotIndex) => <button type="button" key={item.id} aria-label={`Voir la création ${dotIndex + 1}`} disabled={!controls} onClick={() => onNavigate?.(dotIndex)} className={dotIndex === index ? "active" : ""} />)}</div></div>
        {controls && <Button type="button" size="icon" variant="outline" disabled={total < 2} onClick={() => navigate(index + 1)} aria-label="Photo suivante"><ChevronRight /></Button>}
      </div>
    </section>
  );
}

function PhoneVotePanel({ state, busyVote, onVote }: { state: GameState; busyVote: string; onVote: (teamId: string) => void }) {
  const total = state.gallery.length;
  const index = total ? Math.min(Math.max(state.room.voteCandidateIndex, 0), total - 1) : 0;
  const candidate = state.gallery[index];
  if (!candidate) return <div className="vote-empty"><Images className="size-10" /><p className="mt-3 font-black"><Bi fr="Aucune photo" ru="Нет фото" /></p></div>;
  const own = candidate.teamId === state.self?.teamId;
  const selected = state.myVote === candidate.teamId;
  return (
    <section className="phone-vote-panel">
      <div className="phone-tv-cue"><Monitor /><div><p><Bi fr="Regarde la télévision" ru="Смотрите на экран" /></p><span>Photo {index + 1} / {total}</span></div></div>
      <div className="phone-vote-team" style={{ "--team-color": candidate.color } as React.CSSProperties}><span className="team-dot" /><p>{candidate.teamName}</p></div>
      <Button type="button" disabled={own || !!busyVote} onClick={() => onVote(candidate.teamId)} className={`phone-vote-button ${selected ? "phone-vote-selected" : ""}`}>
        {busyVote === candidate.teamId ? <LoaderCircle className="animate-spin" /> : selected ? <Check /> : own ? <Users /> : <Trophy />}
        {own ? <Bi fr="Votre équipe" ru="Ваша команда" /> : selected ? <Bi fr="Vote enregistré" ru="Голос принят" /> : <Bi fr="Voter pour cette photo" ru="Голосовать за это фото" />}
      </Button>
      <p className="phone-vote-hint"><Bi fr="Le bouton suit la photo affichée sur la télé" ru="Кнопка соответствует фото на экране" /></p>
    </section>
  );
}

function Podium({ ranking }: { ranking: GameState["ranking"] }) {
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <section className="mx-auto w-full max-w-3xl py-8 text-center">
      <CelebrationConfetti />
      <PartyPopper className="mx-auto size-12 text-primary" />
      <p className="eyebrow mt-4">Résultats · Результаты</p><h1 className="display-title mt-2 text-5xl font-black tracking-tight sm:text-7xl"><Bi fr="Le podium" ru="Победители" /></h1>
      <div className="mt-10 space-y-3 text-left">
        {ranking.map((team, index) => <div key={team.teamId} className={`ranking-row ${index === 0 ? "ranking-winner" : ""}`}>
          <span className="w-12 text-center text-3xl">{medals[index] ?? `${index + 1}.`}</span><span className="team-dot" style={{ background: team.color }} />
          <span className="flex-1 text-lg font-black">{team.name}</span><span className="text-xl font-black tabular-nums">{team.score} <small className="text-sm text-muted-foreground">pts</small></span>
        </div>)}
      </div>
    </section>
  );
}

function TeamSetup({ state, act }: { state: GameState; act: (action: string, extra?: object) => Promise<void> }) {
  const [teamCount, setTeamCount] = useState(Math.max(2, state.teams.length || 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (state.teams.length) setTeamCount(state.teams.length); }, [state.teams.length]);

  async function run(action: string, extra: object) {
    setBusy(true); setError("");
    try { await act(action, extra); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Modification impossible."); }
    finally { setBusy(false); }
  }

  return (
    <section className="team-setup">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow">Équipes · Команды</p><h2 className="mt-1 text-3xl font-black"><Bi fr="Composition manuelle" ru="Ручной состав" /></h2></div>
        <div className="team-count-control"><Button type="button" size="icon" variant="ghost" disabled={busy || teamCount <= 2} onClick={() => setTeamCount((value) => Math.max(2, value - 1))}><Minus /></Button><span>{teamCount}</span><Button type="button" size="icon" variant="ghost" disabled={busy || teamCount >= 10} onClick={() => setTeamCount((value) => Math.min(10, value + 1))}><Plus /></Button><Button type="button" disabled={busy || teamCount === state.teams.length} onClick={() => run("set_team_count", { teamCount })} className="ml-1 rounded-xl font-black">{state.teams.length ? "OK" : "Créer · Создать"}</Button></div>
      </div>
      {error && <p role="alert" className="error-box mt-4"><CircleX className="size-4" />{error}</p>}
      {state.teams.length > 0 && <>
        <div className="team-editor-grid mt-5">{state.teams.map((team) => <div key={team.id} className="team-editor-card" style={{ "--team-color": team.color } as React.CSSProperties}>
          <span className="team-dot" /><input key={team.name} defaultValue={team.name} maxLength={24} aria-label={`Nom de ${team.name}`} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={(event) => { const name = event.currentTarget.value.trim(); if (name && name !== team.name) void run("rename_team", { teamId: team.id, name }); }} />
          <p>{team.members.length} joueur{team.members.length > 1 ? "s" : ""}</p><div className="team-member-list">{team.members.map((member) => <span key={member.id}>{member.name}</span>)}{team.members.length === 0 && <em>Vide · Пусто</em>}</div>
        </div>)}</div>
        <div className="mt-6"><p className="mb-3 text-sm font-black uppercase tracking-[.14em] text-muted-foreground">Joueurs · Игроки</p><div className="player-assignment-list">{state.players.map((player) => <label key={player.id}><span>{player.name}</span><select value={player.teamId ?? ""} disabled={busy} onChange={(event) => void run("assign_player", { playerId: player.id, teamId: event.target.value || null })}><option value="">Sans équipe · Без команды</option>{state.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>)}</div></div>
      </>}
      {state.teams.length === 0 && <div className="empty-teams mt-5"><Users className="size-8" /><p className="mt-2 font-black"><Bi fr="Choisis le nombre puis crée" ru="Выбери число и создай" /></p></div>}
    </section>
  );
}

function AdminSteps({ state, teamsReady }: { state: GameState; teamsReady: boolean }) {
  const playersReady = state.players.length >= 2;
  const photosReady = state.prompts.length >= 1;
  const current = !playersReady ? 0 : !teamsReady ? 1 : !photosReady ? 2 : 3;
  const steps = [
    { icon: Users, fr: "Inviter", ru: "Игроки", detail: `${state.players.length} connecté${state.players.length > 1 ? "s" : ""}` },
    { icon: Users, fr: "Équipes", ru: "Команды", detail: `${state.teams.length} équipe${state.teams.length > 1 ? "s" : ""}` },
    { icon: Images, fr: "Modèles", ru: "Фото", detail: `${state.prompts.length} manche${state.prompts.length > 1 ? "s" : ""}` },
    { icon: Play, fr: "Lancer", ru: "Старт", detail: current === 3 ? "Prêt · Готово" : "À venir · Далее" },
  ];
  const guidance = current === 0
    ? { fr: "Faites scanner le QR code. Deux joueurs minimum.", ru: "Отсканируйте QR-код. Минимум два игрока." }
    : current === 1
      ? { fr: "Créez les équipes et placez chaque joueur.", ru: "Создайте команды и распределите игроков." }
      : current === 2
        ? { fr: "Ajoutez les photos à reproduire.", ru: "Добавьте фотографии для повторения." }
        : { fr: "Tout est prêt. Lancez la partie.", ru: "Всё готово. Начинайте игру." };

  return (
    <section className="admin-guide" aria-label="Étapes de préparation">
      <div className="admin-guide-heading"><div><p className="eyebrow">Préparation · Подготовка</p><h1><Bi fr="Suivez les étapes" ru="Следуйте этапам" /></h1></div><div className="admin-progress"><span style={{ width: `${(current / 3) * 100}%` }} /></div></div>
      <div className="admin-step-grid">{steps.map((step, index) => { const Icon = step.icon; const status = index < current ? "done" : index === current ? "current" : "next"; return <div key={step.fr} className={`admin-step admin-step-${status}`}><span className="admin-step-number">{status === "done" ? <Check /> : index + 1}</span><Icon className="admin-step-icon" /><div><p>{step.fr}</p><small lang="ru">{step.ru}</small><span>{step.detail}</span></div></div>; })}</div>
      <div className="admin-guidance"><Sparkles /><Bi fr={guidance.fr} ru={guidance.ru} /></div>
      <div className="tv-guidance"><Monitor /><Bi fr="Télé : mode écran · Commandes : téléphone" ru="ТВ: режим экрана · Управление: телефон" /></div>
    </section>
  );
}

function HostView({ state, session, refresh, act, leave }: { state: GameState; session: Session; refresh: () => Promise<void>; act: (action: string, extra?: object) => Promise<void>; leave: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [uploads, setUploads] = useState<PromptUpload[]>([]);
  const [error, setError] = useState("");
  const [joinUrl, setJoinUrl] = useState("");
  const [screenUrl, setScreenUrl] = useState("");
  useEffect(() => {
    setJoinUrl(`${window.location.origin}/?room=${state.room.code}`);
    setScreenUrl(`${window.location.origin}/?screen=${state.room.code}`);
  }, [state.room.code]);

  async function uploadPrompts(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files).slice(0, Math.max(0, 10 - state.prompts.length));
    if (!selected.length) return;
    const batch = selected.map((file) => ({ id: crypto.randomUUID(), file, name: file.name || "Photo", preview: null, status: "preparing" as const, progress: 8 }));
    setUploads(batch.map(({ file: _file, ...item }) => item));
    setUploading(true); setError("");
    let failed = 0;
    for (const item of batch) {
      try {
        setUploads((current) => current.map((upload) => upload.id === item.id ? { ...upload, status: "preparing", progress: 20 } : upload));
        const optimized = await optimizePhoto(item.file);
        const preview = URL.createObjectURL(optimized);
        setUploads((current) => current.map((upload) => upload.id === item.id ? { ...upload, preview, status: "uploading", progress: 62 } : upload));
        const form = new FormData(); form.set("kind", "prompt"); form.set("hostSecret", session.secret); form.set("image", optimized, "photo.jpg");
        await readJson(await fetch(`/api/rooms/${state.room.code}/upload`, { method: "POST", body: form }));
        setUploads((current) => current.map((upload) => upload.id === item.id ? { ...upload, status: "done", progress: 100 } : upload));
      } catch (reason) {
        failed += 1;
        const message = reason instanceof TypeError ? "Connexion interrompue. Réessaie avec une connexion stable." : reason instanceof Error ? reason.message : "Envoi impossible.";
        setUploads((current) => current.map((upload) => upload.id === item.id ? { ...upload, status: "error", progress: 100, error: message } : upload));
      }
    }
    await refresh();
    if (failed === 0) {
      setUploads((current) => { current.forEach((upload) => { if (upload.preview) URL.revokeObjectURL(upload.preview); }); return []; });
    } else {
      setError(`${failed} photo${failed > 1 ? "s n’ont" : " n’a"} pas pu être envoyée${failed > 1 ? "s" : ""}. Tu peux les sélectionner à nouveau.`);
    }
    setUploading(false);
  }

  const unassignedPlayers = state.players.filter((player) => !player.teamId).length;
  const emptyTeams = state.teams.filter((team) => team.members.length === 0).length;
  const teamsReady = state.teams.length >= 2 && unassignedPlayers === 0 && emptyTeams === 0;

  if (state.room.status === "results") return <GameShell leave={leave} role="Admin"><Podium ranking={state.ranking} /><Button onClick={() => act("restart")} className="mx-auto h-12 rounded-2xl px-7 font-black"><RotateCcw /> Rejouer · Ещё раз</Button></GameShell>;

  if (state.room.status === "challenge") return (
    <GameShell leave={leave} role="Admin">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">Manche · Раунд {state.room.roundIndex + 1} / {state.room.totalRounds}</p><h1 className="text-3xl font-black sm:text-5xl"><Bi fr="Reproduisez la photo" ru="Повторите фото" /></h1><p className="mt-2 text-muted-foreground"><Bi fr="La manche avance automatiquement à zéro" ru="Раунд сменится автоматически" /></p></div><Timer endsAt={state.room.endsAt} duration={state.room.roundDuration} /></div>
      <div className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]"><div className="photo-stage">{state.reference && <img src={state.reference.imageUrl} alt={`Modèle de la manche ${state.room.roundIndex + 1}`} />}</div><div><p className="mb-3 text-sm font-bold uppercase tracking-[.14em] text-muted-foreground">Reçues · Получено</p><TeamList teams={state.teams} /></div></div>
    </GameShell>
  );

  if (state.room.status === "voting") return (
    <GameShell leave={leave} role="Admin">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">Vote · Голос {state.room.voteRound + 1} / {state.room.totalRounds}</p><h1 className="text-3xl font-black sm:text-5xl"><Bi fr="Choisissez la photo à afficher" ru="Выберите фото для показа" /></h1><p className="mt-2 text-muted-foreground"><Bi fr="Les téléphones suivent la télévision" ru="Телефоны следуют за экраном" /></p></div><Button onClick={() => act("next_vote")} className="h-12 rounded-2xl px-6 font-black">{state.room.voteRound + 1 === state.room.totalRounds ? <Trophy /> : <ChevronRight />}{state.room.voteRound + 1 === state.room.totalRounds ? "Résultats · Итоги" : "Suivant · Далее"}</Button></div>
      <VoteShowcase state={state} controls onNavigate={(candidateIndex) => void act("set_vote_candidate", { candidateIndex })} />
    </GameShell>
  );

  return (
    <GameShell leave={leave} role="Admin">
      <AdminSteps state={state} teamsReady={teamsReady} />
      <div className="admin-lobby-grid mt-6">
        <aside className="admin-control-card glass-card h-fit rounded-[2rem] p-5 sm:p-6">
          <p className="eyebrow">Code · Код</p><p className="mt-2 text-4xl font-black tracking-[.16em] text-primary sm:text-5xl">{state.room.code}</p>
          {joinUrl && <div className="admin-qr mt-5 inline-flex rounded-3xl bg-white p-3"><QRCodeSVG value={joinUrl} size={200} bgColor="#ffffff" fgColor="#090b14" /></div>}
          <p className="mt-4 text-sm text-muted-foreground">QR joueur · QR для игроков</p>
          {session.adminKey && <div className="admin-key-card mt-5"><div><p className="text-xs font-black uppercase tracking-[.15em] text-muted-foreground">Clé de reprise admin</p><p className="mt-1 font-black tracking-[.16em]">{session.adminKey}</p></div><Button type="button" size="icon" variant="ghost" aria-label="Copier la clé admin" onClick={() => void navigator.clipboard.writeText(session.adminKey ?? "")}><Copy /></Button></div>}
          <Button type="button" variant="outline" className="mt-3 h-12 w-full rounded-2xl border-white/10 bg-white/5 font-bold" onClick={() => window.open(screenUrl, "_blank", "noopener,noreferrer")}><Monitor /> Mode télé · Режим экрана</Button>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Clé privée · Секретный ключ</p>
          <div className="mt-6 border-t border-white/10 pt-5"><p className="mb-3 text-sm font-bold uppercase tracking-[.14em] text-muted-foreground">{state.players.length} joueur{state.players.length > 1 ? "s" : ""}</p><div className="flex flex-wrap gap-2">{state.players.map((player) => <span key={player.id} className="player-chip">{player.name}</span>)}{state.players.length === 0 && <span className="text-sm text-muted-foreground">En attente des premiers joueurs…</span>}</div></div>
        </aside>
        <section className="admin-workspace">
          <TeamSetup state={state} act={act} />
          <div className="mt-10 flex flex-wrap items-end justify-between gap-4 border-t border-white/10 pt-10"><div><p className="eyebrow">Modèles · Оригиналы</p><h1 className="mt-1 text-3xl font-black sm:text-5xl"><Bi fr="Photos à reproduire" ru="Фото для повторения" /></h1></div>
            <label className={`upload-button ${uploading || state.prompts.length >= 10 ? "pointer-events-none opacity-50" : ""}`}><input type="file" accept="image/*" multiple hidden onChange={(event) => uploadPrompts(event.target.files)} /><Images /> {uploading ? "Envoi… · Загрузка…" : "Ajouter · Добавить"}</label></div>
          {error && <p role="alert" className="error-box mt-4"><CircleX className="size-4" />{error}</p>}
          {uploads.length > 0 && <div className="upload-queue mt-6">{uploads.map((upload) => <div key={upload.id} className={`upload-preview upload-preview-${upload.status}`}>
            <div className="upload-preview-image">{upload.preview ? <img src={upload.preview} alt="" /> : <Images className="size-8 text-muted-foreground" />}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-black">{upload.name}</p><p className="mt-1 text-xs text-muted-foreground">{upload.status === "preparing" ? "Préparation de la photo…" : upload.status === "uploading" ? "Envoi en cours…" : upload.status === "done" ? "Photo chargée" : upload.error}</p><div className="upload-progress mt-2"><span style={{ width: `${upload.progress}%` }} /></div></div>
            {upload.status === "done" ? <Check className="size-5 text-secondary" /> : upload.status === "error" ? <CircleX className="size-5 text-destructive" /> : <LoaderCircle className="size-5 animate-spin text-primary" />}
          </div>)}</div>}
          <div className="prompt-grid mt-6">{state.prompts.map((prompt, index) => <figure key={prompt.id} className="prompt-card"><img src={prompt.imageUrl} alt={`Modèle ${index + 1}`} /><span>{index + 1}</span><button type="button" aria-label={`Supprimer le modèle ${index + 1}`} onClick={() => act("remove_prompt", { promptId: prompt.id })}><Trash2 /></button></figure>)}
            {state.prompts.length === 0 && <div className="empty-prompts"><Images className="size-9" /><p className="mt-3 font-black">Aucune photo · Нет фото</p></div>}</div>
          <div className="sticky bottom-4 mt-8 rounded-3xl border border-white/10 bg-[#111424]/95 p-4 shadow-2xl backdrop-blur"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="font-black">{state.prompts.length} manche{state.prompts.length > 1 ? "s" : ""} · {state.teams.length} équipe{state.teams.length > 1 ? "s" : ""}</p><p className="text-sm text-muted-foreground">{teamsReady ? "Prêt · Готово" : unassignedPlayers > 0 ? `${unassignedPlayers} sans équipe · без команды` : emptyTeams > 0 ? `${emptyTeams} vide · пусто` : "2 équipes minimum · минимум 2 команды"}</p></div><Button disabled={state.players.length < 2 || state.prompts.length < 1 || !teamsReady} onClick={() => act("start")} className="h-12 rounded-2xl px-7 text-base font-black"><Play /> Lancer · Старт</Button></div></div>
        </section>
      </div>
    </GameShell>
  );
}

function ScreenView({ state, leave }: { state: GameState; leave: () => void }) {
  const [joinUrl, setJoinUrl] = useState("");
  useEffect(() => setJoinUrl(`${window.location.origin}/?room=${state.room.code}`), [state.room.code]);

  if (state.room.status === "results") return <GameShell leave={leave} role="Écran"><Podium ranking={state.ranking} /></GameShell>;

  if (state.room.status === "challenge") return (
    <GameShell leave={leave} role="Écran">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">Manche · Раунд {state.room.roundIndex + 1} / {state.room.totalRounds}</p><h1 className="text-3xl font-black sm:text-5xl"><Bi fr="Reproduisez la photo" ru="Повторите фото" /></h1></div><Timer endsAt={state.room.endsAt} duration={state.room.roundDuration} /></div>
      <div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]"><div className="photo-stage">{state.reference && <img src={state.reference.imageUrl} alt={`Modèle de la manche ${state.room.roundIndex + 1}`} />}</div><div><p className="mb-3 text-sm font-bold uppercase tracking-[.14em] text-muted-foreground">Équipes · Команды</p><TeamList teams={state.teams} /></div></div>
    </GameShell>
  );

  if (state.room.status === "voting") return (
    <GameShell leave={leave} role="Écran">
      <div className="mb-5"><p className="eyebrow">Vote · Голос {state.room.voteRound + 1} / {state.room.totalRounds}</p><h1 className="text-3xl font-black sm:text-5xl"><Bi fr="Regardez puis votez" ru="Смотрите и голосуйте" /></h1></div>
      <VoteShowcase state={state} />
    </GameShell>
  );

  return (
    <GameShell leave={leave} role="Écran">
      <section className="mx-auto grid max-w-5xl items-center gap-8 py-8 text-center lg:grid-cols-[.8fr_1.2fr] lg:text-left">
        <div>{joinUrl && <div className="inline-flex rounded-[2rem] bg-white p-4"><QRCodeSVG value={joinUrl} size={230} bgColor="#ffffff" fgColor="#090b14" /></div>}</div>
        <div><p className="eyebrow">Rejoignez · Подключайтесь</p><h1 className="display-title mt-3 text-6xl font-black tracking-[.12em] text-primary sm:text-8xl">{state.room.code}</h1><p className="mt-5 text-xl text-muted-foreground"><Bi fr="Scannez. Entrez votre prénom." ru="Сканируйте. Введите имя." /></p><p className="mt-8 text-2xl font-black">{state.players.length} joueur{state.players.length > 1 ? "s" : ""} · игрок{state.players.length > 1 ? "ов" : ""}</p><div className="mt-4 flex flex-wrap justify-center gap-2 lg:justify-start">{state.players.map((player) => <span key={player.id} className="player-chip">{player.name}</span>)}</div></div>
      </section>
    </GameShell>
  );
}

function PlayerView({ state, session, refresh, act, leave }: { state: GameState; session: Session; refresh: () => void; act: (action: string, extra?: object) => Promise<void>; leave: () => void }) {
  const [error, setError] = useState("");
  const [busyVote, setBusyVote] = useState("");
  const myTeam = state.teams.find((team) => team.id === state.self?.teamId);

  async function vote(teamId: string) {
    setBusyVote(teamId); setError("");
    try { await act("vote", { teamId }); } catch (reason) { setError(reason instanceof Error ? reason.message : "Vote impossible."); }
    finally { setBusyVote(""); }
  }

  if (state.room.status === "results") return <GameShell leave={leave} role="Joueur"><Podium ranking={state.ranking} /><p className="text-center text-muted-foreground">Bravo {session.name} ! · Молодец!</p></GameShell>;

  if (state.room.status === "challenge") return (
    <GameShell leave={leave} role="Joueur">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">Manche · Раунд {state.room.roundIndex + 1} / {state.room.totalRounds}</p><h1 className="text-3xl font-black"><Bi fr={`À vous, ${myTeam?.name ?? "équipe"}`} ru="Ваша очередь" /></h1><p className="mt-2 flex items-center gap-2 text-muted-foreground"><Monitor className="size-4" /><Bi fr="Modèle sur la télévision" ru="Оригинал на экране" /></p></div><Timer endsAt={state.room.endsAt} duration={state.room.roundDuration} /></div>
      <div className="mx-auto max-w-2xl"><p className="mb-2 text-sm font-bold uppercase tracking-[.14em] text-muted-foreground">Votre photo · Ваше фото</p><CameraCapture state={state} token={session.secret} refresh={refresh} /></div>
    </GameShell>
  );

  if (state.room.status === "voting") return (
    <GameShell leave={leave} role="Joueur">
      <div className="mb-5"><p className="eyebrow">Vote · Голос {state.room.voteRound + 1} / {state.room.totalRounds}</p><h1 className="text-3xl font-black sm:text-5xl"><Bi fr="Vote sur ton téléphone" ru="Голосуйте на телефоне" /></h1></div>
      {error && <p role="alert" className="error-box mb-4"><CircleX className="size-4" />{error}</p>}
      <PhoneVotePanel state={state} busyVote={busyVote} onVote={(teamId) => void vote(teamId)} />
      {state.gallery.filter((item) => item.teamId !== state.self?.teamId).length === 0 && <p className="rounded-2xl border border-white/10 bg-white/5 p-5 text-muted-foreground">Aucun autre choix · Нет других фото</p>}
    </GameShell>
  );

  return (
    <GameShell leave={leave} role="Joueur">
      <section className="mx-auto max-w-3xl py-10 text-center"><div className="mx-auto grid size-20 place-items-center rounded-[1.8rem] bg-secondary/15 text-secondary"><Users className="size-9" /></div><p className="eyebrow mt-6">Attente · Ожидание · {state.room.code}</p><h1 className="display-title mt-2 text-4xl font-black sm:text-6xl">{session.name}</h1><p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">{myTeam ? `${myTeam.name} · Команда готова` : "Équipes en préparation · Команды готовятся"}</p><div className="mt-8 flex flex-wrap justify-center gap-2">{state.players.map((player) => <span key={player.id} className={`player-chip ${player.id === state.self?.id ? "player-me" : ""}`}>{player.name}</span>)}</div><div className="mt-10 inline-flex items-center gap-2 text-sm font-bold text-secondary"><LoaderCircle className="size-4 animate-spin" /> Départ bientôt · Скоро старт</div></section>
    </GameShell>
  );
}

function GameShell({ children, leave, role }: { children: React.ReactNode; leave: () => void; role: "Admin" | "Joueur" | "Écran" }) {
  return <main className="min-h-svh bg-background text-foreground"><div className="party-orb party-orb-one" /><div className="relative mx-auto min-h-svh w-full max-w-7xl px-4 py-5 sm:px-8 sm:py-7"><Brand onLeave={leave} role={role} /><div className="pt-8">{children}</div></div></main>;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const screenCode = new URLSearchParams(window.location.search).get("screen")?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (screenCode) {
      setSession({ role: "screen", code: screenCode, secret: "" });
      setLoading(false);
      return;
    }
    try { const saved = localStorage.getItem(SESSION_KEY); if (saved) setSession(JSON.parse(saved)); } catch { localStorage.removeItem(SESSION_KEY); }
    setLoading(false);
  }, []);

  const acceptSession = useCallback((next: Session) => { localStorage.setItem(SESSION_KEY, JSON.stringify(next)); setSession(next); setState(null); }, []);
  const leave = useCallback(() => {
    if (session?.role !== "screen") localStorage.removeItem(SESSION_KEY);
    if (session?.role === "screen") window.history.replaceState({}, "", window.location.pathname);
    setSession(null); setState(null); setError("");
  }, [session?.role]);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const headers: Record<string, string> = {};
      const suffix = session.role === "player" ? `?token=${encodeURIComponent(session.secret)}` : "";
      if (session.role === "host") headers["x-host-secret"] = session.secret;
      const next = await readJson<GameState>(await fetch(`/api/rooms/${session.code}/state${suffix}`, { headers, cache: "no-store" }));
      setState(next); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Connexion perdue."); }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    void refresh();
    const timer = window.setInterval(refresh, 1200);
    return () => window.clearInterval(timer);
  }, [refresh, session]);

  const act = useCallback(async (action: string, extra: object = {}) => {
    if (!session) return;
    const body = { action, ...(session.role === "host" ? { hostSecret: session.secret } : { playerToken: session.secret }), ...extra };
    await readJson(await fetch(`/api/rooms/${session.code}/actions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    await refresh();
  }, [refresh, session]);

  if (loading) return <main className="grid min-h-svh place-items-center bg-background"><LoaderCircle className="size-8 animate-spin text-primary" /></main>;
  if (!session) return <HomeScreen onSession={acceptSession} />;
  if (!state) return <main className="grid min-h-svh place-items-center bg-background p-6 text-center"><div><LoaderCircle className="mx-auto size-8 animate-spin text-primary" /><p className="mt-4 font-bold text-foreground">Connexion à la partie…</p>{error && <><p className="mt-2 text-sm text-destructive">{error}</p><Button variant="ghost" onClick={leave} className="mt-3">Retour</Button></>}</div></main>;
  if (session.role === "host") return <HostView state={state} session={session} refresh={refresh} act={act} leave={leave} />;
  if (session.role === "screen") return <ScreenView state={state} leave={leave} />;
  return <PlayerView state={state} session={session} refresh={refresh} act={act} leave={leave} />;
}
