import { readFile } from "node:fs/promises";
import path from "node:path";

type JsonObject = Record<string, unknown>;

type SnapshotLeague = JsonObject & {
  league_id?: string;
  name?: string;
  season?: string;
  status?: string;
  total_rosters?: number;
  sport?: string;
  roster_positions?: string[] | null;
};

type SnapshotUser = JsonObject & {
  user_id?: string;
  display_name?: string;
  metadata?: JsonObject | null;
};

type SnapshotRoster = JsonObject & {
  roster_id?: number;
  owner_id?: string | null;
  players?: string[] | null;
  starters?: string[] | null;
  taxi?: string[] | null;
  reserve?: string[] | null;
  metadata?: JsonObject | null;
};

type SnapshotPlayer = JsonObject & {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  fantasy_positions?: string[] | null;
  team?: string | null;
  search_rank?: number | string | null;
  injury_status?: string | null;
};

type SnapshotTradedPick = JsonObject & {
  round?: number | string | null;
  season?: string | null;
  roster_id?: number | string | null;
  owner_id?: number | string | null;
  previous_owner_id?: number | string | null;
};

type SnapshotDraft = JsonObject & {
  season?: string | null;
  status?: string | null;
  settings?: JsonObject | null;
  slot_to_roster_id?: JsonObject | null;
  draft_order?: JsonObject | null;
};

type SnapshotDraftDetail = {
  draft?: SnapshotDraft;
  picks?: JsonObject[];
  traded_picks?: SnapshotTradedPick[];
};

type RankingOverride = {
  rank?: number;
  value?: number;
  label?: string;
};

type RankingOverridesFile = {
  source?: string;
  players?: Record<string, RankingOverride>;
};

type KtcRanking = {
  rowId: string;
  playerName: string;
  rank: number;
  value: number | null;
  team: string | null;
  position: string | null;
};

type LeagueSnapshot = {
  snapshot_meta: {
    fetched_at: string;
    league_id: string;
    season: string;
    status: string;
  };
  league: SnapshotLeague;
  users: SnapshotUser[];
  rosters: SnapshotRoster[];
  traded_picks: SnapshotTradedPick[];
  draft_details: SnapshotDraftDetail[];
  players: Record<string, SnapshotPlayer | null>;
};

export type PlannerPlayer = {
  playerId: string;
  fullName: string;
  position: string;
  nflTeam: string | null;
  nickname: string | null;
  rank: number;
  rankDisplay: string;
  rankSource: string;
  value: number | null;
  isStarter: boolean;
  isTaxi: boolean;
  isReserve: boolean;
  injuryStatus: string | null;
  assetType: "player" | "pick";
  pickSeason: string | null;
  pickRound: number | null;
  pickSlot: number | null;
  pickTier: string | null;
  pickOriginalRosterId: number | null;
};

export type PlannerRoster = {
  rosterId: number;
  ownerId: string | null;
  ownerName: string;
  teamName: string;
  players: PlannerPlayer[];
  draftPicks: PlannerPlayer[];
};

export type PlannerData = {
  league: {
    id: string;
    name: string;
    season: string;
    status: string;
    totalRosters: number;
    snapshotTime: string;
    sport: string | null;
    rosterPositions: string[];
  };
  rosters: PlannerRoster[];
  freeAgents: PlannerPlayer[];
  maxRosterSize: number;
  defaultKeepers: number;
  defaultSelectionsPerExpansionTeam: number;
  rankingSourceLabel: string;
  rankingNote: string;
  links: {
    sleeperLeague: string;
    sleeperDocs: string;
    keepTradeCutLeague: string;
  };
};

const SNAPSHOT_FILE = "league-1312262964929110016.snapshot.json";
const RANKINGS_FILE = "player-rankings.overrides.json";
const KTC_RANKINGS_FILE = "ktc_16032026.csv";

function asRecord(value: unknown): JsonObject {
  return value != null && typeof value === "object"
    ? (value as JsonObject)
    : {};
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getPlayerIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function readJsonFile<T>(filePath: string): Promise<T> {
  return readFile(filePath, "utf8").then((contents) => JSON.parse(contents) as T);
}

function normalizePlayerName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/gi, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
}

function normalizeTeamCode(value: string | null): string | null {
  const team = value?.trim().toUpperCase();

  if (!team) {
    return null;
  }

  const aliases: Record<string, string> = {
    ARI: "ARI",
    ATL: "ATL",
    BAL: "BAL",
    BUF: "BUF",
    CAR: "CAR",
    CHI: "CHI",
    CIN: "CIN",
    CLE: "CLE",
    DAL: "DAL",
    DEN: "DEN",
    DET: "DET",
    GB: "GB",
    HOU: "HOU",
    IND: "IND",
    JAC: "JAX",
    JAX: "JAX",
    KC: "KC",
    LA: "LAR",
    LAC: "LAC",
    LAR: "LAR",
    LV: "LV",
    LVR: "LV",
    MIA: "MIA",
    MIN: "MIN",
    NE: "NE",
    NEP: "NE",
    NO: "NO",
    NYG: "NYG",
    NYJ: "NYJ",
    PHI: "PHI",
    PIT: "PIT",
    SEA: "SEA",
    SF: "SF",
    TB: "TB",
    TEN: "TEN",
    WAS: "WAS",
  };

  return aliases[team] ?? team;
}

function normalizePosition(value: string | null): string | null {
  const position = value?.trim().toUpperCase();

  if (!position) {
    return null;
  }

  return position.replace(/\d+$/, "");
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }

      continue;
    }

    if (character === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  cells.push(current);
  return cells;
}

function buildKtcRankingRowId(
  rank: number,
  playerName: string,
  team: string | null,
  position: string | null,
) {
  return [
    rank,
    normalizePlayerName(playerName),
    normalizeTeamCode(team),
    normalizePosition(position),
  ].join(":");
}

async function readKtcRankings(filePath: string): Promise<Map<string, KtcRanking[]>> {
  const contents = await readFile(filePath, "utf8");
  const lines = contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const [headerLine, ...dataLines] = lines;

  if (!headerLine) {
    return new Map();
  }

  const headers = parseCsvLine(headerLine);
  const headerIndexes = new Map(headers.map((header, index) => [header, index]));
  const rankings = new Map<string, KtcRanking[]>();

  dataLines.forEach((line) => {
    const cells = parseCsvLine(line);
    const playerName = cells[headerIndexes.get("player_name") ?? -1]?.trim();
    const rank = asNumber(cells[headerIndexes.get("rank") ?? -1]);

    if (!playerName || rank == null) {
      return;
    }

    const key = normalizePlayerName(playerName);
    const ranking: KtcRanking = {
      rowId: buildKtcRankingRowId(
        rank,
        playerName,
        cells[headerIndexes.get("team") ?? -1] ?? null,
        cells[headerIndexes.get("pos") ?? -1] ?? null,
      ),
      playerName,
      rank,
      value: asNumber(cells[headerIndexes.get("value") ?? -1]),
      team: normalizeTeamCode(cells[headerIndexes.get("team") ?? -1] ?? null),
      position: normalizePosition(cells[headerIndexes.get("pos") ?? -1] ?? null),
    };
    const existing = rankings.get(key) ?? [];

    existing.push(ranking);
    rankings.set(key, existing);
  });

  return rankings;
}

function resolveKtcRanking(
  playerName: string,
  player: SnapshotPlayer | null | undefined,
  ktcRankings: Map<string, KtcRanking[]>,
): KtcRanking | null {
  const candidates = ktcRankings.get(normalizePlayerName(playerName)) ?? [];

  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  const team = normalizeTeamCode(asString(player?.team));
  const position = normalizePosition(getPlayerPosition(player));
  const exactMatch = candidates.filter(
    (candidate) =>
      (candidate.team == null || team == null || candidate.team === team) &&
      (candidate.position == null ||
        position == null ||
        candidate.position === position),
  );

  if (exactMatch.length === 1) {
    return exactMatch[0];
  }

  const positionMatch = candidates.filter(
    (candidate) =>
      candidate.position == null ||
      position == null ||
      candidate.position === position,
  );

  return positionMatch.length === 1 ? positionMatch[0] : null;
}

function getTeamName(user: SnapshotUser | undefined): string {
  const metadata = asRecord(user?.metadata);
  return (
    asString(metadata.team_name) ??
    asString(user?.display_name) ??
    "Unassigned team"
  );
}

function getOwnerName(user: SnapshotUser | undefined): string {
  return asString(user?.display_name) ?? "Unknown owner";
}

function getPlayerName(playerId: string, player: SnapshotPlayer | null | undefined) {
  const fullName = asString(player?.full_name);
  const joinedName = [asString(player?.first_name), asString(player?.last_name)]
    .filter(Boolean)
    .join(" ");

  return (
    fullName ??
    (joinedName.length > 0 ? joinedName : null) ??
    `Player ${playerId}`
  );
}

function getPlayerPosition(player: SnapshotPlayer | null | undefined) {
  if (Array.isArray(player?.fantasy_positions)) {
    const [firstPosition] = player.fantasy_positions;

    if (typeof firstPosition === "string" && firstPosition.length > 0) {
      return firstPosition;
    }
  }

  return asString(player?.position) ?? "UNK";
}

function formatOrdinal(value: number) {
  if (value % 100 >= 11 && value % 100 <= 13) {
    return `${value}th`;
  }

  const remainder = value % 10;

  if (remainder === 1) {
    return `${value}st`;
  }

  if (remainder === 2) {
    return `${value}nd`;
  }

  if (remainder === 3) {
    return `${value}rd`;
  }

  return `${value}th`;
}

function formatDraftPickLabel(season: string, round: number, slot: number) {
  return `${season} ${round}.${String(slot).padStart(2, "0")}`;
}

function classifyDraftPickTier(slot: number, totalRosters: number) {
  const percentile = slot / Math.max(totalRosters, 1);

  if (percentile <= 0.3) {
    return "Early";
  }

  if (percentile <= 0.7) {
    return "Mid";
  }

  return "Late";
}

function getCurrentDraft(snapshot: LeagueSnapshot): SnapshotDraft | null {
  const currentSeason = snapshot.snapshot_meta.season;
  const matchingDraft =
    snapshot.draft_details.find(
      (detail) => asString(detail.draft?.season) === currentSeason,
    ) ?? snapshot.draft_details[0];

  return matchingDraft?.draft ?? null;
}

function getDraftSlotsByRosterId(
  snapshot: LeagueSnapshot,
  draft: SnapshotDraft | null,
): Map<number, number> {
  const slotByRosterId = new Map<number, number>();
  const slotToRosterId = asRecord(draft?.slot_to_roster_id);

  Object.entries(slotToRosterId).forEach(([slotValue, rosterValue]) => {
    const slot = asNumber(slotValue);
    const rosterId = asNumber(rosterValue);

    if (slot != null && rosterId != null) {
      slotByRosterId.set(rosterId, slot);
    }
  });

  if (slotByRosterId.size > 0) {
    return slotByRosterId;
  }

  const draftOrder = asRecord(draft?.draft_order);

  snapshot.rosters.forEach((roster) => {
    const rosterId = asNumber(roster.roster_id);
    const ownerId = asString(roster.owner_id);

    if (rosterId == null || ownerId == null) {
      return;
    }

    const slot = asNumber(draftOrder[ownerId]);

    if (slot != null) {
      slotByRosterId.set(rosterId, slot);
    }
  });

  return slotByRosterId;
}

function comparePlayers(left: PlannerPlayer, right: PlannerPlayer) {
  return (
    left.rank - right.rank ||
    Number(right.isStarter) - Number(left.isStarter) ||
    left.fullName.localeCompare(right.fullName)
  );
}

export async function loadPlannerData(): Promise<PlannerData> {
  const dataDir = path.join(process.cwd(), "data");
  const snapshotPath = path.join(dataDir, SNAPSHOT_FILE);
  const rankingPath = path.join(dataDir, RANKINGS_FILE);
  const ktcRankingPath = path.join(dataDir, KTC_RANKINGS_FILE);

  const snapshot = await readJsonFile<LeagueSnapshot>(snapshotPath);
  let rankingOverrides: RankingOverridesFile = {};
  let ktcRankings = new Map<string, KtcRanking[]>();

  try {
    rankingOverrides = await readJsonFile<RankingOverridesFile>(rankingPath);
  } catch {
    rankingOverrides = {};
  }

  try {
    ktcRankings = await readKtcRankings(ktcRankingPath);
  } catch {
    ktcRankings = new Map();
  }

  const overrides = rankingOverrides.players ?? {};
  const usersById = new Map(
    snapshot.users.map((user) => [asString(user.user_id) ?? "", user]),
  );
  const currentDraft = getCurrentDraft(snapshot);
  const currentDraftSeason =
    asString(currentDraft?.season) ?? snapshot.snapshot_meta.season;
  const currentDraftRounds =
    asNumber(asRecord(currentDraft?.settings).rounds) ??
    asNumber(asRecord(snapshot.league.settings).draft_rounds) ??
    0;
  const draftSlotsByRosterId = getDraftSlotsByRosterId(snapshot, currentDraft);
  const tradedPicks = snapshot.traded_picks ?? [];
  const ownerByDraftPickKey = new Map<string, number>();
  const draftPicksByRosterId = new Map<number, PlannerPlayer[]>();
  const usedKtcRowIds = new Set<string>();

  snapshot.rosters.forEach((roster) => {
    const rosterId = asNumber(roster.roster_id);

    if (rosterId == null) {
      return;
    }

    for (let round = 1; round <= currentDraftRounds; round += 1) {
      ownerByDraftPickKey.set(`${currentDraftSeason}-${round}-${rosterId}`, rosterId);
    }
  });

  tradedPicks.forEach((pick) => {
    const season = asString(pick.season);
    const round = asNumber(pick.round);
    const sourceRosterId = asNumber(pick.roster_id);
    const ownerRosterId = asNumber(pick.owner_id);

    if (
      season !== currentDraftSeason ||
      round == null ||
      sourceRosterId == null ||
      ownerRosterId == null
    ) {
      return;
    }

    ownerByDraftPickKey.set(`${season}-${round}-${sourceRosterId}`, ownerRosterId);
  });

  if (currentDraftRounds > 0) {
    const totalRosters =
      typeof snapshot.league.total_rosters === "number"
        ? snapshot.league.total_rosters
        : snapshot.rosters.length;

    snapshot.rosters.forEach((roster) => {
      const sourceRosterId = asNumber(roster.roster_id);
      const slot = sourceRosterId != null ? draftSlotsByRosterId.get(sourceRosterId) : null;

      if (sourceRosterId == null || slot == null) {
        return;
      }

      const tier = classifyDraftPickTier(slot, totalRosters);

      for (let round = 1; round <= currentDraftRounds; round += 1) {
        const ownerRosterId =
          ownerByDraftPickKey.get(`${currentDraftSeason}-${round}-${sourceRosterId}`) ??
          sourceRosterId;
        const lookupName = `${currentDraftSeason} ${tier} ${formatOrdinal(round)}`;
        const ktcRanking = resolveKtcRanking(
          lookupName,
          {
            position: "PICK",
          } satisfies SnapshotPlayer,
          ktcRankings,
        );

        if (ktcRanking) {
          usedKtcRowIds.add(ktcRanking.rowId);
        }

        const rank = ktcRanking?.rank ?? Number.MAX_SAFE_INTEGER;
        const draftPick = {
          playerId: `pick-${currentDraftSeason}-${round}-${sourceRosterId}`,
          fullName: formatDraftPickLabel(currentDraftSeason, round, slot),
          position: "PICK",
          nflTeam: null,
          nickname: null,
          rank,
          rankDisplay:
            rank === Number.MAX_SAFE_INTEGER ? "NR" : `#${rank.toLocaleString()}`,
          rankSource: ktcRanking
            ? `KeepTradeCut CSV: ${KTC_RANKINGS_FILE}`
            : "Unranked draft pick",
          value: ktcRanking?.value ?? null,
          isStarter: false,
          isTaxi: false,
          isReserve: false,
          injuryStatus: null,
          assetType: "pick",
          pickSeason: currentDraftSeason,
          pickRound: round,
          pickSlot: slot,
          pickTier: tier,
          pickOriginalRosterId: sourceRosterId,
        } satisfies PlannerPlayer;
        const existing = draftPicksByRosterId.get(ownerRosterId) ?? [];

        existing.push(draftPick);
        draftPicksByRosterId.set(ownerRosterId, existing);
      }
    });
  }

  const rosters = snapshot.rosters
    .map((roster) => {
      const rosterId = typeof roster.roster_id === "number" ? roster.roster_id : 0;
      const ownerId = asString(roster.owner_id);
      const owner = ownerId ? usersById.get(ownerId) : undefined;
      const rosterMetadata = asRecord(roster.metadata);
      const starters = new Set(getPlayerIds(roster.starters));
      const taxi = new Set(getPlayerIds(roster.taxi));
      const reserve = new Set(getPlayerIds(roster.reserve));

      const players = getPlayerIds(roster.players)
        .map((playerId) => {
          const player = snapshot.players[playerId];
          const override = overrides[playerId];
          const playerName = getPlayerName(playerId, player);
          const ktcRanking = resolveKtcRanking(playerName, player, ktcRankings);

          if (ktcRanking) {
            usedKtcRowIds.add(ktcRanking.rowId);
          }

          const fallbackRank = asNumber(player?.search_rank);
          const rank =
            override?.rank ??
            ktcRanking?.rank ??
            fallbackRank ??
            Number.MAX_SAFE_INTEGER;
          const nickname = asString(rosterMetadata[`p_nick_${playerId}`]);

          return {
            playerId,
            fullName: playerName,
            position: getPlayerPosition(player),
            nflTeam: asString(player?.team),
            nickname,
            rank,
            rankDisplay:
              rank === Number.MAX_SAFE_INTEGER ? "NR" : `#${rank.toLocaleString()}`,
            rankSource: override
              ? override.label
                ? `Manual: ${override.label}`
                : "Manual override"
              : ktcRanking
                ? `KeepTradeCut CSV: ${KTC_RANKINGS_FILE}`
              : fallbackRank != null
                ? "Sleeper search_rank"
                : "Unranked fallback",
            value: override?.value ?? ktcRanking?.value ?? null,
            isStarter: starters.has(playerId),
            isTaxi: taxi.has(playerId),
            isReserve: reserve.has(playerId),
            injuryStatus: asString(player?.injury_status),
            assetType: "player",
            pickSeason: null,
            pickRound: null,
            pickSlot: null,
            pickTier: null,
            pickOriginalRosterId: null,
          } satisfies PlannerPlayer;
        })
        .sort(comparePlayers);
      const draftPicks = (draftPicksByRosterId.get(rosterId) ?? []).sort(comparePlayers);

      return {
        rosterId,
        ownerId,
        ownerName: getOwnerName(owner),
        teamName: getTeamName(owner),
        players,
        draftPicks,
      } satisfies PlannerRoster;
    })
    .sort((left, right) => left.rosterId - right.rosterId);
  const freeAgents = [...ktcRankings.values()]
    .flat()
    .filter(
      (ranking) =>
        ranking.position !== "PICK" && !usedKtcRowIds.has(ranking.rowId),
    )
    .map(
      (ranking) =>
        ({
          playerId: `fa-${ranking.rowId}`,
          fullName: ranking.playerName,
          position: ranking.position ?? "UNK",
          nflTeam: ranking.team,
          nickname: null,
          rank: ranking.rank,
          rankDisplay: `#${ranking.rank.toLocaleString()}`,
          rankSource: `KeepTradeCut CSV: ${KTC_RANKINGS_FILE}`,
          value: ranking.value,
          isStarter: false,
          isTaxi: false,
          isReserve: false,
          injuryStatus: null,
          assetType: "player",
          pickSeason: null,
          pickRound: null,
          pickSlot: null,
          pickTier: null,
          pickOriginalRosterId: null,
        }) satisfies PlannerPlayer,
    )
    .sort(comparePlayers);

  const maxRosterSize = rosters.reduce(
    (max, roster) => Math.max(max, roster.players.length),
    0,
  );
  const totalPlayerCount = rosters.reduce(
    (total, roster) => total + roster.players.length,
    0,
  );
  const defaultKeepers = Math.min(10, maxRosterSize);
  const defaultSelectionsPerExpansionTeam = Math.min(
    12,
    Math.max(1, Math.floor(totalPlayerCount / 8)),
  );
  const hasOverrides = Object.keys(overrides).length > 0;
  const hasKtcRankings = ktcRankings.size > 0;

  return {
    league: {
      id: snapshot.snapshot_meta.league_id,
      name: asString(snapshot.league.name) ?? "Sleeper league",
      season: snapshot.snapshot_meta.season,
      status: snapshot.snapshot_meta.status,
      totalRosters:
        typeof snapshot.league.total_rosters === "number"
          ? snapshot.league.total_rosters
          : rosters.length,
      snapshotTime: snapshot.snapshot_meta.fetched_at,
      sport: asString(snapshot.league.sport),
      rosterPositions: Array.isArray(snapshot.league.roster_positions)
        ? snapshot.league.roster_positions.filter(
            (position): position is string => typeof position === "string",
          )
        : [],
    },
    rosters,
    freeAgents,
    maxRosterSize,
    defaultKeepers,
    defaultSelectionsPerExpansionTeam,
    rankingSourceLabel: hasOverrides
      ? hasKtcRankings
        ? "Manual overrides, KTC CSV, then Sleeper search rank fallback"
        : "Manual overrides plus Sleeper search rank fallback"
      : hasKtcRankings
        ? "KeepTradeCut CSV plus Sleeper search rank fallback"
        : "Sleeper search rank fallback",
    rankingNote: hasKtcRankings
      ? `Local KeepTradeCut rankings are loaded from ${KTC_RANKINGS_FILE} by normalized player name. Players not found in the CSV fall back to Sleeper search_rank.`
      : "No local KTC CSV was loaded, so the planner falls back to Sleeper search_rank.",
    links: {
      sleeperLeague: `https://sleeper.com/leagues/${snapshot.snapshot_meta.league_id}`,
      sleeperDocs: "https://docs.sleeper.com/",
      keepTradeCutLeague: `https://keeptradecut.com/dynasty-rankings/power-rankings?leagueId=${snapshot.snapshot_meta.league_id}&platform=Sleeper&format=2`,
    },
  };
}
