import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_LEAGUE_ID = "1312262964929110016";
const MAX_NFL_WEEKS = 18;
const API_ROOT = "https://api.sleeper.app/v1";

type JsonObject = Record<string, unknown>;

type Snapshot = {
  snapshot_meta: {
    fetched_at: string;
    league_id: string;
    season: string;
    status: string;
    app_context: string;
  };
  sources: {
    docs: string;
    api_root: string;
    league_url: string;
  };
  state: JsonObject;
  league: JsonObject;
  users: JsonObject[];
  rosters: JsonObject[];
  traded_picks: JsonObject[];
  winners_bracket: JsonObject[] | null;
  losers_bracket: JsonObject[] | null;
  drafts: JsonObject[];
  draft_details: {
    draft: JsonObject;
    picks: JsonObject[];
    traded_picks: JsonObject[];
  }[];
  matchups_by_week: Record<string, JsonObject[]>;
  transactions_by_week: Record<string, JsonObject[]>;
  players: Record<string, JsonObject | null>;
  derived: {
    total_users: number;
    total_rosters: number;
    total_unique_players: number;
    total_traded_picks: number;
    total_drafts: number;
    total_draft_picks: number;
    matchup_counts_by_week: Record<string, number>;
    transaction_counts_by_week: Record<string, number>;
    roster_team_lookup: {
      roster_id: number;
      owner_id: string | null;
      display_name: string | null;
      team_name: string | null;
      player_count: number;
    }[];
  };
};

async function fetchJson<T>(
  endpoint: string,
  options?: { allow404?: boolean },
): Promise<T | null> {
  const response = await fetch(`${API_ROOT}${endpoint}`, {
    headers: {
      accept: "application/json",
    },
  });

  if (response.status === 404 && options?.allow404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `Sleeper request failed for ${endpoint}: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as T;
}

function asArray<T>(value: T[] | T | null | undefined): T[] {
  if (value == null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function asRecord(value: unknown): JsonObject {
  return value != null && typeof value === "object"
    ? (value as JsonObject)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getCollectionIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .filter((item) => item !== "0");
}

function collectLeaguePlayerIds(
  rosters: JsonObject[],
  draftDetails: Snapshot["draft_details"],
): string[] {
  const ids = new Set<string>();

  for (const roster of rosters) {
    getCollectionIds(roster.players).forEach((playerId) => ids.add(playerId));
    getCollectionIds(roster.starters).forEach((playerId) => ids.add(playerId));
    getCollectionIds(roster.taxi).forEach((playerId) => ids.add(playerId));
    getCollectionIds(roster.reserve).forEach((playerId) => ids.add(playerId));
  }

  for (const detail of draftDetails) {
    for (const pick of detail.picks) {
      const directPlayerId = readString(pick.player_id);
      if (directPlayerId) {
        ids.add(directPlayerId);
      }

      const metadata = asRecord(pick.metadata);
      const metadataPlayerId =
        readString(metadata.player_id) ?? readString(metadata.picked_by);

      if (metadataPlayerId) {
        ids.add(metadataPlayerId);
      }
    }
  }

  return [...ids].sort((left, right) => Number(left) - Number(right));
}

function buildSnapshotSchema(leagueId: string) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: `Sleeper league snapshot ${leagueId}`,
    type: "object",
    required: [
      "snapshot_meta",
      "sources",
      "state",
      "league",
      "users",
      "rosters",
      "traded_picks",
      "winners_bracket",
      "losers_bracket",
      "drafts",
      "draft_details",
      "matchups_by_week",
      "transactions_by_week",
      "players",
      "derived",
    ],
    properties: {
      snapshot_meta: {
        type: "object",
        required: ["fetched_at", "league_id", "season", "status", "app_context"],
        properties: {
          fetched_at: { type: "string", format: "date-time" },
          league_id: { type: "string" },
          season: { type: "string" },
          status: { type: "string" },
          app_context: { type: "string" },
        },
        additionalProperties: false,
      },
      sources: {
        type: "object",
        required: ["docs", "api_root", "league_url"],
        properties: {
          docs: { type: "string", format: "uri" },
          api_root: { type: "string", format: "uri" },
          league_url: { type: "string", format: "uri" },
        },
        additionalProperties: false,
      },
      state: {
        type: "object",
        additionalProperties: true,
      },
      league: {
        type: "object",
        additionalProperties: true,
      },
      users: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
        },
      },
      rosters: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
        },
      },
      traded_picks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
        },
      },
      winners_bracket: {
        type: ["array", "null"],
        items: {
          type: "object",
          additionalProperties: true,
        },
      },
      losers_bracket: {
        type: ["array", "null"],
        items: {
          type: "object",
          additionalProperties: true,
        },
      },
      drafts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
        },
      },
      draft_details: {
        type: "array",
        items: {
          type: "object",
          required: ["draft", "picks", "traded_picks"],
          properties: {
            draft: {
              type: "object",
              additionalProperties: true,
            },
            picks: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
              },
            },
            traded_picks: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
              },
            },
          },
          additionalProperties: false,
        },
      },
      matchups_by_week: {
        type: "object",
        additionalProperties: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: true,
          },
        },
      },
      transactions_by_week: {
        type: "object",
        additionalProperties: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: true,
          },
        },
      },
      players: {
        type: "object",
        additionalProperties: {
          anyOf: [
            {
              type: "object",
              additionalProperties: true,
            },
            {
              type: "null",
            },
          ],
        },
      },
      derived: {
        type: "object",
        required: [
          "total_users",
          "total_rosters",
          "total_unique_players",
          "total_traded_picks",
          "total_drafts",
          "total_draft_picks",
          "matchup_counts_by_week",
          "transaction_counts_by_week",
          "roster_team_lookup",
        ],
        properties: {
          total_users: { type: "integer" },
          total_rosters: { type: "integer" },
          total_unique_players: { type: "integer" },
          total_traded_picks: { type: "integer" },
          total_drafts: { type: "integer" },
          total_draft_picks: { type: "integer" },
          matchup_counts_by_week: {
            type: "object",
            additionalProperties: { type: "integer" },
          },
          transaction_counts_by_week: {
            type: "object",
            additionalProperties: { type: "integer" },
          },
          roster_team_lookup: {
            type: "array",
            items: {
              type: "object",
              required: [
                "roster_id",
                "owner_id",
                "display_name",
                "team_name",
                "player_count",
              ],
              properties: {
                roster_id: { type: "integer" },
                owner_id: { type: ["string", "null"] },
                display_name: { type: ["string", "null"] },
                team_name: { type: ["string", "null"] },
                player_count: { type: "integer" },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  };
}

function buildSummary(snapshot: Snapshot): string {
  const lines = [
    `# Sleeper Snapshot Summary`,
    ``,
    `- League: ${readString(snapshot.league.name) ?? snapshot.snapshot_meta.league_id}`,
    `- League ID: ${snapshot.snapshot_meta.league_id}`,
    `- Season: ${snapshot.snapshot_meta.season}`,
    `- Status: ${snapshot.snapshot_meta.status}`,
    `- Snapshot time: ${snapshot.snapshot_meta.fetched_at}`,
    `- Users: ${snapshot.derived.total_users}`,
    `- Rosters: ${snapshot.derived.total_rosters}`,
    `- Unique league player ids enriched from /players/nfl: ${snapshot.derived.total_unique_players}`,
    `- Traded picks: ${snapshot.derived.total_traded_picks}`,
    `- Drafts linked to league: ${snapshot.derived.total_drafts}`,
    `- Draft picks returned: ${snapshot.derived.total_draft_picks}`,
    ``,
    `## Endpoint coverage`,
    ``,
    `- League metadata: /league/${snapshot.snapshot_meta.league_id}`,
    `- League users: /league/${snapshot.snapshot_meta.league_id}/users`,
    `- League rosters: /league/${snapshot.snapshot_meta.league_id}/rosters`,
    `- League traded picks: /league/${snapshot.snapshot_meta.league_id}/traded_picks`,
    `- League winners bracket: /league/${snapshot.snapshot_meta.league_id}/winners_bracket`,
    `- League losers bracket: /league/${snapshot.snapshot_meta.league_id}/losers_bracket`,
    `- League drafts: /league/${snapshot.snapshot_meta.league_id}/drafts`,
    `- Draft details: /draft/{draft_id}, /draft/{draft_id}/picks, /draft/{draft_id}/traded_picks`,
    `- NFL state: /state/nfl`,
    `- Matchups: /league/${snapshot.snapshot_meta.league_id}/matchups/{week} for weeks 1-${MAX_NFL_WEEKS}`,
    `- Transactions: /league/${snapshot.snapshot_meta.league_id}/transactions/{week} for weeks 1-${MAX_NFL_WEEKS}`,
    `- Player metadata subset: /players/nfl filtered to rostered or drafted player ids`,
    ``,
    `## Matchups by week`,
    ``,
    ...Object.entries(snapshot.derived.matchup_counts_by_week).map(
      ([week, count]) => `- Week ${week}: ${count}`,
    ),
    ``,
    `## Transactions by week`,
    ``,
    ...Object.entries(snapshot.derived.transaction_counts_by_week).map(
      ([week, count]) => `- Week ${week}: ${count}`,
    ),
    ``,
    `## Roster lookup`,
    ``,
    ...snapshot.derived.roster_team_lookup.map(
      (item) =>
        `- Roster ${item.roster_id}: ${item.team_name ?? item.display_name ?? "Unassigned"} (${item.player_count} players)`,
    ),
    ``,
    `## Notes`,
    ``,
    `- This league is currently in pre-draft state, so several historical endpoints return empty collections or null bracket data.`,
    `- The snapshot stores raw Sleeper payloads for league-scoped endpoints and raw player objects for player ids referenced by league rosters or draft picks.`,
  ];

  return `${lines.join("\n")}\n`;
}

async function ensureManualRankingsFile(dataDir: string) {
  const filePath = path.join(dataDir, "player-rankings.overrides.json");

  try {
    await access(filePath);
  } catch {
    const template = {
      source: "manual-overrides",
      description:
        "Optional rank/value overrides used by the web app. Lower rank is better.",
      players: {},
    };

    await writeFile(filePath, `${JSON.stringify(template, null, 2)}\n`, "utf8");
  }
}

async function main() {
  const leagueId = process.argv[2] ?? DEFAULT_LEAGUE_ID;
  const dataDir = path.join(process.cwd(), "data");

  await mkdir(dataDir, { recursive: true });

  const [state, league, users, rosters, tradedPicks, winnersBracket, losersBracket] =
    await Promise.all([
      fetchJson<JsonObject>("/state/nfl"),
      fetchJson<JsonObject>(`/league/${leagueId}`),
      fetchJson<JsonObject[]>(`/league/${leagueId}/users`),
      fetchJson<JsonObject[]>(`/league/${leagueId}/rosters`),
      fetchJson<JsonObject[]>(`/league/${leagueId}/traded_picks`),
      fetchJson<JsonObject[]>(`/league/${leagueId}/winners_bracket`, { allow404: true }),
      fetchJson<JsonObject[]>(`/league/${leagueId}/losers_bracket`, { allow404: true }),
    ]);

  if (!state || !league || !users || !rosters || !tradedPicks) {
    throw new Error("Missing required Sleeper responses while building snapshot.");
  }

  const drafts = asArray(
    await fetchJson<JsonObject[] | JsonObject>(`/league/${leagueId}/drafts`),
  );

  const draftDetails = await Promise.all(
    drafts.map(async (draft) => {
      const draftId = readString(draft.draft_id);

      if (!draftId) {
        return {
          draft,
          picks: [],
          traded_picks: [],
        };
      }

      const [draftDetail, picks, tradedDraftPicks] = await Promise.all([
        fetchJson<JsonObject>(`/draft/${draftId}`),
        fetchJson<JsonObject[] | JsonObject>(`/draft/${draftId}/picks`),
        fetchJson<JsonObject[] | JsonObject>(`/draft/${draftId}/traded_picks`),
      ]);

      return {
        draft: draftDetail ?? draft,
        picks: asArray(picks),
        traded_picks: asArray(tradedDraftPicks),
      };
    }),
  );

  const matchupResponses = await Promise.all(
    Array.from({ length: MAX_NFL_WEEKS }, (_, index) => {
      const week = index + 1;

      return fetchJson<JsonObject[] | JsonObject>(
        `/league/${leagueId}/matchups/${week}`,
      ).then((response) => [String(week), asArray(response)] as const);
    }),
  );

  const transactionResponses = await Promise.all(
    Array.from({ length: MAX_NFL_WEEKS }, (_, index) => {
      const week = index + 1;

      return fetchJson<JsonObject[] | JsonObject>(
        `/league/${leagueId}/transactions/${week}`,
      ).then((response) => [String(week), asArray(response)] as const);
    }),
  );

  const playerIds = collectLeaguePlayerIds(rosters, draftDetails);
  const allPlayers =
    (await fetchJson<Record<string, JsonObject | null>>("/players/nfl")) ?? {};
  const players = Object.fromEntries(
    playerIds.map((playerId) => [playerId, allPlayers[playerId] ?? null]),
  );

  const userLookup = new Map(
    users.map((user) => [readString(user.user_id) ?? "", user]),
  );

  const matchupsByWeek = Object.fromEntries(matchupResponses);
  const transactionsByWeek = Object.fromEntries(transactionResponses);
  const matchupCountsByWeek = Object.fromEntries(
    matchupResponses.map(([week, items]) => [week, items.length]),
  );
  const transactionCountsByWeek = Object.fromEntries(
    transactionResponses.map(([week, items]) => [week, items.length]),
  );

  const snapshot: Snapshot = {
    snapshot_meta: {
      fetched_at: new Date().toISOString(),
      league_id: leagueId,
      season: readString(league.season) ?? "unknown",
      status: readString(league.status) ?? "unknown",
      app_context: "Expansion draft planning snapshot",
    },
    sources: {
      docs: "https://docs.sleeper.com/",
      api_root: API_ROOT,
      league_url: `https://sleeper.com/leagues/${leagueId}`,
    },
    state,
    league,
    users,
    rosters,
    traded_picks: tradedPicks,
    winners_bracket: winnersBracket,
    losers_bracket: losersBracket,
    drafts,
    draft_details: draftDetails,
    matchups_by_week: matchupsByWeek,
    transactions_by_week: transactionsByWeek,
    players,
    derived: {
      total_users: users.length,
      total_rosters: rosters.length,
      total_unique_players: playerIds.length,
      total_traded_picks: tradedPicks.length,
      total_drafts: drafts.length,
      total_draft_picks: draftDetails.reduce(
        (total, draft) => total + draft.picks.length,
        0,
      ),
      matchup_counts_by_week: matchupCountsByWeek,
      transaction_counts_by_week: transactionCountsByWeek,
      roster_team_lookup: rosters.map((roster) => {
        const ownerId = readString(roster.owner_id);
        const owner = ownerId ? userLookup.get(ownerId) : undefined;
        const ownerMetadata = asRecord(owner?.metadata);
        const teamName = readString(ownerMetadata.team_name);

        return {
          roster_id:
            typeof roster.roster_id === "number" ? roster.roster_id : Number.NaN,
          owner_id: ownerId,
          display_name: owner ? readString(owner.display_name) : null,
          team_name: teamName,
          player_count: getCollectionIds(roster.players).length,
        };
      }),
    },
  };

  const snapshotBaseName = `league-${leagueId}`;
  const snapshotPath = path.join(dataDir, `${snapshotBaseName}.snapshot.json`);
  const schemaPath = path.join(dataDir, `${snapshotBaseName}.schema.json`);
  const summaryPath = path.join(dataDir, `${snapshotBaseName}.db-summary.md`);

  await Promise.all([
    writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8"),
    writeFile(
      schemaPath,
      `${JSON.stringify(buildSnapshotSchema(leagueId), null, 2)}\n`,
      "utf8",
    ),
    writeFile(summaryPath, buildSummary(snapshot), "utf8"),
    ensureManualRankingsFile(dataDir),
  ]);

  console.log(`Snapshot written to ${snapshotPath}`);
  console.log(`Schema written to ${schemaPath}`);
  console.log(`Summary written to ${summaryPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
