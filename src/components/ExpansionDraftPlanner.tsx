"use client";

import {
  startTransition,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import type { PlannerData, PlannerPlayer, PlannerRoster } from "@/lib/planner-data";

import styles from "./ExpansionDraftPlanner.module.css";

type DraftMode = "snake" | "linear";

type PoolAsset = PlannerPlayer & {
  sourceRosterId: number | null;
  sourceTeamName: string;
  sourceOwnerName: string;
  sourceType: "roster" | "freeAgent";
};

type ExpansionPick = PoolAsset & {
  overallPick: number;
  teamPick: number;
};

type ProtectedRoster = PlannerRoster & {
  assets: PlannerPlayer[];
  keepers: PlannerPlayer[];
  exposed: PlannerPlayer[];
  draftableExposed: PlannerPlayer[];
};

type ExpansionTeam = {
  name: string;
  picks: ExpansionPick[];
};

type RosterValueSnapshot = {
  rosterKey: string;
  teamName: string;
  ownerName: string;
  starterValue: number;
  totalValue: number;
};

type CombinedRosterValueSnapshot = {
  rosterKey: string;
  teamName: string;
  ownerName: string;
  isExpansion: boolean;
  preStarterValue: number | null;
  preTotalValue: number | null;
  postStarterValue: number;
  postTotalValue: number;
};

type DraftSimulation = {
  expansionTeams: ExpansionTeam[];
  selectedAssetIds: Set<string>;
};

type SimulationSettings = {
  requestedSelectionsPerExpansionTeam: number;
  draftMode: DraftMode;
  sourceTeamSelectionCap: number;
  includeFreeAgents: boolean;
};

type PlannerSettings = {
  requestedKeepers: number;
  sourceTeamSelectionCap: number;
};

type PlannerSettingsAction =
  | {
      type: "setRequestedKeepers";
      value: number;
    }
  | {
      type: "setSourceTeamSelectionCap";
      value: number;
    }
  | {
      type: "setSettings";
      value: PlannerSettings;
    };

type LineupSlotAssignment = {
  slot: string;
  asset: PlannerPlayer | null;
};

type ResultingLeagueRoster = {
  rosterKey: string;
  teamName: string;
  ownerName: string;
  assetCount: number;
  starters: LineupSlotAssignment[];
  benchAssets: PlannerPlayer[];
  isExpansion: boolean;
};

type PlannerViewModel = {
  combinedRosterValues: CombinedRosterValueSnapshot[];
  expansionTeams: ExpansionTeam[];
  orderedResultingLeagueRosters: ResultingLeagueRoster[];
  protectedRosters: ProtectedRoster[];
};

type PreparedRoster = PlannerRoster & {
  preDraftStarterValue: number;
  preDraftTotalValue: number;
  sortedAssets: PlannerPlayer[];
};

type PreparedPlannerData = {
  freeAgentPool: PoolAsset[];
  preparedRosters: PreparedRoster[];
  preDraftRosterValueByKey: Map<
    string,
    Pick<RosterValueSnapshot, "starterValue" | "totalValue">
  >;
  starterSlots: string[];
};

const KEEPERS_RANGE = {
  min: 0,
  max: 25,
} as const;

const EXPANSION_PICKS_RANGE = {
  min: 1,
  max: 25,
} as const;

const SOURCE_TEAM_CAP_RANGE = {
  min: 1,
  max: 10,
} as const;

const EXPANSION_TEAM_NAMES = ["Expansion A", "Expansion B"] as const;
const BENCH_SLOT_NAMES = new Set(["BN", "BENCH", "IR", "RESERVE", "TAXI"]);
const FLEX_SLOT_NAMES = new Set(["FLEX", "W_R_T"]);
const SUPER_FLEX_SLOT_NAMES = new Set(["SUPER_FLEX", "SUPERFLEX"]);
const FLEX_ELIGIBLE_POSITIONS: readonly string[] = ["RB", "WR", "TE"];
const SUPER_FLEX_ELIGIBLE_POSITIONS: readonly string[] = ["QB", "RB", "WR", "TE"];

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function comparePlayers(left: PlannerPlayer, right: PlannerPlayer) {
  return (
    left.rank - right.rank ||
    Number(right.isStarter) - Number(left.isStarter) ||
    left.fullName.localeCompare(right.fullName)
  );
}

function compareLineupCandidates(left: PlannerPlayer, right: PlannerPlayer) {
  return (right.value ?? 0) - (left.value ?? 0) || comparePlayers(left, right);
}

function getTeamIndexForPick(pickIndex: number, draftMode: DraftMode) {
  if (draftMode === "linear") {
    return pickIndex % 2;
  }

  const roundIndex = Math.floor(pickIndex / 2);
  const pickWithinRound = pickIndex % 2;

  return roundIndex % 2 === 0 ? pickWithinRound : 1 - pickWithinRound;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function createInitialPlannerSettings(data: PlannerData): PlannerSettings {
  return {
    requestedKeepers: clamp(data.defaultKeepers, KEEPERS_RANGE.min, KEEPERS_RANGE.max),
    sourceTeamSelectionCap: clamp(4, SOURCE_TEAM_CAP_RANGE.min, SOURCE_TEAM_CAP_RANGE.max),
  };
}

function plannerSettingsReducer(
  state: PlannerSettings,
  action: PlannerSettingsAction,
): PlannerSettings {
  switch (action.type) {
    case "setRequestedKeepers": {
      const requestedKeepers = clamp(action.value, KEEPERS_RANGE.min, KEEPERS_RANGE.max);

      return requestedKeepers === state.requestedKeepers
        ? state
        : {
            ...state,
            requestedKeepers,
          };
    }
    case "setSourceTeamSelectionCap": {
      const sourceTeamSelectionCap = clamp(
        action.value,
        SOURCE_TEAM_CAP_RANGE.min,
        SOURCE_TEAM_CAP_RANGE.max,
      );

      return sourceTeamSelectionCap === state.sourceTeamSelectionCap
        ? state
        : {
            ...state,
            sourceTeamSelectionCap,
          };
    }
    case "setSettings": {
      const requestedKeepers = clamp(
        action.value.requestedKeepers,
        KEEPERS_RANGE.min,
        KEEPERS_RANGE.max,
      );
      const sourceTeamSelectionCap = clamp(
        action.value.sourceTeamSelectionCap,
        SOURCE_TEAM_CAP_RANGE.min,
        SOURCE_TEAM_CAP_RANGE.max,
      );

      return requestedKeepers === state.requestedKeepers &&
        sourceTeamSelectionCap === state.sourceTeamSelectionCap
        ? state
        : {
            requestedKeepers,
            sourceTeamSelectionCap,
          };
    }
    default:
      return state;
  }
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

function normalizeSlot(slot: string) {
  return slot.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function getInitials(value: string) {
  const letters = value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return letters.length > 0 ? letters : "TM";
}

function slotLabel(asset: PlannerPlayer) {
  if (asset.assetType === "pick") {
    return "Pick";
  }

  if (asset.isReserve) {
    return "IR";
  }

  if (asset.isTaxi) {
    return "Taxi";
  }

  if (asset.isStarter) {
    return "Starter";
  }

  return "Bench";
}

function assetMeta(asset: PlannerPlayer) {
  if (asset.assetType === "pick") {
    const parts = ["Draft pick"];

    if (asset.pickTier && asset.pickRound != null) {
      parts.push(`${asset.pickTier} ${formatOrdinal(asset.pickRound)}`);
    } else if (asset.pickRound != null) {
      parts.push(formatOrdinal(asset.pickRound));
    }

    return parts.join(" - ");
  }

  const parts = [asset.position];

  if (asset.nflTeam) {
    parts.push(asset.nflTeam);
  }

  return parts.join(" - ");
}

function formatCompactNumber(value: number) {
  return value === 0 ? "0" : compactNumberFormatter.format(value);
}

function sumAssetValues(assets: Array<PlannerPlayer | null>) {
  return assets.reduce((total, asset) => total + (asset?.value ?? 0), 0);
}

function toAnchorId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function getStarterSlots(rosterPositions: string[]) {
  return rosterPositions.filter((slot) => !BENCH_SLOT_NAMES.has(normalizeSlot(slot)));
}

function canAssetFillSlot(asset: PlannerPlayer, slot: string) {
  if (asset.assetType !== "player") {
    return false;
  }

  const normalizedSlot = normalizeSlot(slot);
  const position = normalizeSlot(asset.position);

  if (FLEX_SLOT_NAMES.has(normalizedSlot)) {
    return FLEX_ELIGIBLE_POSITIONS.includes(position);
  }

  if (SUPER_FLEX_SLOT_NAMES.has(normalizedSlot)) {
    return SUPER_FLEX_ELIGIBLE_POSITIONS.includes(position);
  }

  return position === normalizedSlot;
}

function getExactSlotFillPriority(slot: string) {
  switch (slot) {
    case "QB":
      return 0;
    case "RB":
      return 1;
    case "WR":
      return 2;
    case "TE":
      return 3;
    default:
      return 4;
  }
}

function takeBestAvailableAsset(
  availablePlayersByPosition: Map<string, PlannerPlayer[]>,
  eligiblePositions: readonly string[],
): PlannerPlayer | null {
  let bestPosition: string | null = null;
  let bestAsset: PlannerPlayer | null = null;

  eligiblePositions.forEach((position) => {
    const candidate = availablePlayersByPosition.get(position)?.[0];

    if (!candidate) {
      return;
    }

    if (!bestAsset || compareLineupCandidates(candidate, bestAsset) < 0) {
      bestAsset = candidate;
      bestPosition = position;
    }
  });

  if (!bestAsset || !bestPosition) {
    return null;
  }

  const positionBucket = availablePlayersByPosition.get(bestPosition);

  if (!positionBucket) {
    return null;
  }

  positionBucket.shift();

  return bestAsset;
}

function buildLineup(
  assets: PlannerPlayer[],
  starterSlots: string[],
): {
  starters: LineupSlotAssignment[];
  benchAssets: PlannerPlayer[];
} {
  const assignedAssetIds = new Set<string>();
  const starters = starterSlots.map((slot) => ({
    slot,
    asset: null as PlannerPlayer | null,
  }));
  const playerAssets = assets.filter((asset) => asset.assetType === "player");

  if (starterSlots.length === 0 || playerAssets.length === 0) {
    return {
      starters,
      benchAssets: assets,
    };
  }

  const availablePlayersByPosition = new Map<string, PlannerPlayer[]>();

  playerAssets.forEach((asset) => {
    const position = normalizeSlot(asset.position);
    const positionBucket = availablePlayersByPosition.get(position);

    if (positionBucket) {
      positionBucket.push(asset);
      return;
    }

    availablePlayersByPosition.set(position, [asset]);
  });

  availablePlayersByPosition.forEach((positionBucket) => {
    positionBucket.sort(compareLineupCandidates);
  });

  const indexedStarterSlots = starterSlots.map((slot, index) => ({
    index,
    normalizedSlot: normalizeSlot(slot),
  }));
  const exactSlots = indexedStarterSlots
    .filter(
      ({ normalizedSlot }) =>
        !FLEX_SLOT_NAMES.has(normalizedSlot) && !SUPER_FLEX_SLOT_NAMES.has(normalizedSlot),
    )
    .sort(
      (left, right) =>
        getExactSlotFillPriority(left.normalizedSlot) -
          getExactSlotFillPriority(right.normalizedSlot) || left.index - right.index,
    );

  exactSlots.forEach(({ index, normalizedSlot }) => {
    const asset = takeBestAvailableAsset(availablePlayersByPosition, [normalizedSlot]);

    if (!asset) {
      return;
    }

    if (!canAssetFillSlot(asset, starterSlots[index])) {
      return;
    }

    starters[index].asset = asset;
    assignedAssetIds.add(asset.playerId);
  });

  indexedStarterSlots.forEach(({ index, normalizedSlot }) => {
    if (!FLEX_SLOT_NAMES.has(normalizedSlot)) {
      return;
    }

    const asset = takeBestAvailableAsset(availablePlayersByPosition, FLEX_ELIGIBLE_POSITIONS);

    if (!asset) {
      return;
    }

    if (!canAssetFillSlot(asset, starterSlots[index])) {
      return;
    }

    starters[index].asset = asset;
    assignedAssetIds.add(asset.playerId);
  });

  indexedStarterSlots.forEach(({ index, normalizedSlot }) => {
    if (!SUPER_FLEX_SLOT_NAMES.has(normalizedSlot)) {
      return;
    }

    const asset = takeBestAvailableAsset(
      availablePlayersByPosition,
      SUPER_FLEX_ELIGIBLE_POSITIONS,
    );

    if (!asset) {
      return;
    }

    if (!canAssetFillSlot(asset, starterSlots[index])) {
      return;
    }

    starters[index].asset = asset;
    assignedAssetIds.add(asset.playerId);
  });

  return {
    starters,
    benchAssets: assets.filter((asset) => !assignedAssetIds.has(asset.playerId)),
  };
}

function simulateExpansionDraft({
  rosterPool,
  freeAgentPool,
  settings,
}: {
  rosterPool: PoolAsset[];
  freeAgentPool: PoolAsset[];
  settings: SimulationSettings;
}): DraftSimulation {
  const expansionTeams = EXPANSION_TEAM_NAMES.map((name) => ({
    name,
    picks: [] as ExpansionPick[],
  }));
  const selectedAssetIds = new Set<string>();
  const sourceRosterSelectionCounts = new Map<number, number>();
  const totalRequestedPicks =
    settings.requestedSelectionsPerExpansionTeam * EXPANSION_TEAM_NAMES.length;

  for (let pickIndex = 0; pickIndex < totalRequestedPicks; pickIndex += 1) {
    const teamIndex = getTeamIndexForPick(pickIndex, settings.draftMode);
    let rosterFallbackAsset: PoolAsset | null = null;
    let freeAgentFallbackAsset: PoolAsset | null = null;
    let asset: PoolAsset | null = null;

    for (const candidate of rosterPool) {
      if (selectedAssetIds.has(candidate.playerId)) {
        continue;
      }

      if (candidate.sourceRosterId == null) {
        continue;
      }

      if (
        (sourceRosterSelectionCounts.get(candidate.sourceRosterId) ?? 0) >=
        settings.sourceTeamSelectionCap
      ) {
        continue;
      }

      rosterFallbackAsset ??= candidate;
      asset = candidate;
      break;
    }

    if (!asset && !rosterFallbackAsset && settings.includeFreeAgents) {
      for (const candidate of freeAgentPool) {
        if (selectedAssetIds.has(candidate.playerId)) {
          continue;
        }

        freeAgentFallbackAsset ??= candidate;
        asset = candidate;
        break;
      }
    }

    asset ??= rosterFallbackAsset;
    asset ??= freeAgentFallbackAsset;

    if (!asset) {
      break;
    }

    selectedAssetIds.add(asset.playerId);
    if (asset.sourceType === "roster" && asset.sourceRosterId != null) {
      sourceRosterSelectionCounts.set(
        asset.sourceRosterId,
        (sourceRosterSelectionCounts.get(asset.sourceRosterId) ?? 0) + 1,
      );
    }

    expansionTeams[teamIndex].picks.push({
      ...asset,
      overallPick: pickIndex + 1,
      teamPick: expansionTeams[teamIndex].picks.length + 1,
    });
  }

  return {
    expansionTeams,
    selectedAssetIds,
  };
}

function preparePlannerData(data: PlannerData): PreparedPlannerData {
  const starterSlots = getStarterSlots(data.league.rosterPositions);
  const preparedRosters = data.rosters.map((roster) => {
    const sortedAssets = [...roster.players, ...roster.draftPicks].sort(comparePlayers);
    const { starters, benchAssets } = buildLineup(sortedAssets, starterSlots);
    const starterValue = sumAssetValues(starters.map((starter) => starter.asset));

    return {
      ...roster,
      sortedAssets,
      preDraftStarterValue: starterValue,
      preDraftTotalValue: starterValue + sumAssetValues(benchAssets),
    } satisfies PreparedRoster;
  });
  const preDraftRosterValueByKey = new Map<
    string,
    Pick<RosterValueSnapshot, "starterValue" | "totalValue">
  >(
    preparedRosters.map((roster) => [
      `roster-${roster.rosterId}`,
      {
        starterValue: roster.preDraftStarterValue,
        totalValue: roster.preDraftTotalValue,
      },
    ]),
  );
  const freeAgentPool = data.freeAgents
    .filter((player) => !player.isUndraftedRookie)
    .map(
      (player) =>
        ({
          ...player,
          sourceRosterId: null,
          sourceTeamName: "F/A",
          sourceOwnerName: "Free agency",
          sourceType: "freeAgent",
        }) satisfies PoolAsset,
    );

  return {
    freeAgentPool,
    preparedRosters,
    preDraftRosterValueByKey,
    starterSlots,
  };
}

function buildProtectedRosters(
  preparedRosters: PreparedRoster[],
  requestedKeepers: number,
): ProtectedRoster[] {
  return preparedRosters.map((roster) => {
    const exposed = roster.sortedAssets.slice(requestedKeepers);
    const draftableExposed = exposed.filter(
      (asset) => asset.assetType === "pick" || !asset.isUndraftedRookie,
    );

    return {
      ...roster,
      assets: roster.sortedAssets,
      keepers: roster.sortedAssets.slice(0, requestedKeepers),
      exposed,
      draftableExposed,
    };
  });
}

function buildPlannerViewModel(
  preparedData: PreparedPlannerData,
  protectedRosters: ProtectedRoster[],
  sourceTeamSelectionCap: number,
): PlannerViewModel {
  const requestedSelectionsPerExpansionTeam = EXPANSION_PICKS_RANGE.max;
  const simulationSettings = {
    requestedSelectionsPerExpansionTeam,
    draftMode: "snake" satisfies DraftMode,
    sourceTeamSelectionCap,
    includeFreeAgents: true,
  } satisfies SimulationSettings;

  const availablePool = protectedRosters
    .flatMap((roster) =>
      roster.draftableExposed.map(
        (player) =>
          ({
            ...player,
            sourceRosterId: roster.rosterId,
            sourceTeamName: roster.teamName,
            sourceOwnerName: roster.ownerName,
            sourceType: "roster",
          }) satisfies PoolAsset,
      ),
    )
    .sort(comparePlayers);

  const { expansionTeams, selectedAssetIds } = simulateExpansionDraft({
    rosterPool: availablePool,
    freeAgentPool: preparedData.freeAgentPool,
    settings: simulationSettings,
  });

  const resultingLeagueRosters: ResultingLeagueRoster[] = [
    ...protectedRosters.map((roster) => {
      const resultingAssets = roster.assets
        .filter((asset) => !selectedAssetIds.has(asset.playerId))
        .sort(comparePlayers);
      const { starters, benchAssets } = buildLineup(resultingAssets, preparedData.starterSlots);

      return {
        rosterKey: `roster-${roster.rosterId}`,
        teamName: roster.teamName,
        ownerName: roster.ownerName,
        assetCount: resultingAssets.length,
        starters,
        benchAssets,
        isExpansion: false,
      } satisfies ResultingLeagueRoster;
    }),
    ...expansionTeams.map((team) => {
      const teamAssets = [...team.picks].sort(comparePlayers);
      const { starters, benchAssets } = buildLineup(teamAssets, preparedData.starterSlots);

      return {
        rosterKey: team.name,
        teamName: team.name,
        ownerName: "Expansion franchise",
        assetCount: teamAssets.length,
        starters,
        benchAssets,
        isExpansion: true,
      } satisfies ResultingLeagueRoster;
    }),
  ];
  const orderedResultingLeagueRosters = [
    ...resultingLeagueRosters.filter((roster) => roster.isExpansion),
    ...resultingLeagueRosters.filter((roster) => !roster.isExpansion),
  ];
  const combinedRosterValues: CombinedRosterValueSnapshot[] = orderedResultingLeagueRosters.map(
    (roster) => {
      const starterAssets = roster.starters.map((starter) => starter.asset);
      const postStarterValue = sumAssetValues(starterAssets);
      const preDraftValues = preparedData.preDraftRosterValueByKey.get(roster.rosterKey);

      return {
        rosterKey: roster.rosterKey,
        teamName: roster.teamName,
        ownerName: roster.ownerName,
        isExpansion: roster.isExpansion,
        preStarterValue: preDraftValues?.starterValue ?? null,
        preTotalValue: preDraftValues?.totalValue ?? null,
        postStarterValue,
        postTotalValue: postStarterValue + sumAssetValues(roster.benchAssets),
      } satisfies CombinedRosterValueSnapshot;
    },
  );

  return {
    combinedRosterValues,
    expansionTeams,
    orderedResultingLeagueRosters,
    protectedRosters,
  };
}

function RosterValueChart({
  data,
  emptyStateMessage,
  ariaLabel,
}: {
  data: CombinedRosterValueSnapshot[];
  emptyStateMessage: string;
  ariaLabel: string;
}) {
  const sortedData = [...data].sort(
    (left, right) =>
      left.postTotalValue - right.postTotalValue ||
      left.postStarterValue - right.postStarterValue ||
      left.teamName.localeCompare(right.teamName),
  );
  const maxValue = Math.max(
    ...sortedData.flatMap((item) => [
      item.postStarterValue,
      item.postTotalValue,
      item.preStarterValue ?? 0,
      item.preTotalValue ?? 0,
    ]),
    0,
  );
  if (maxValue === 0) {
    return <div className={styles.emptyState}>{emptyStateMessage}</div>;
  }

  return (
    <div className={styles.chartBlock}>
      <div className={styles.chartLegend}>
        <span className={styles.legendItem}>
          <span className={styles.legendExamples}>
            <span
              className={`${styles.legendSwatch} ${styles.legendSwatchStarterValueFaded}`}
            />
            <span
              className={`${styles.legendSwatch} ${styles.legendSwatchRosterValueFaded}`}
            />
          </span>
          Pre-Draft
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendExamples}>
            <span
              className={`${styles.legendSwatch} ${styles.legendSwatchStarterValue}`}
            />
            <span
              className={`${styles.legendSwatch} ${styles.legendSwatchRosterValue}`}
            />
          </span>
          Post-Draft
        </span>
      </div>

      <div className={styles.horizontalChart} role="img" aria-label={ariaLabel}>
        {sortedData.map((item) => {
          const preStarterValue = item.preStarterValue ?? 0;
          const preTotalValue = item.preTotalValue ?? 0;

          return (
            <article key={item.rosterKey} className={styles.chartRow}>
              <div className={styles.chartRowHeader}>
                <strong className={styles.chartTeamName}>{item.teamName}</strong>
                <span className={styles.chartRowMeta}>
                  {item.isExpansion ? "Expansion franchise" : item.ownerName}
                </span>
              </div>

              <ComparisonBarMeter
                label="Starters"
                preValueLabel={formatCompactNumber(Math.round(preStarterValue))}
                postValueLabel={formatCompactNumber(Math.round(item.postStarterValue))}
                preRatio={preStarterValue / Math.max(maxValue, 1)}
                postRatio={item.postStarterValue / Math.max(maxValue, 1)}
                tone="starter"
              />
              <ComparisonBarMeter
                label="Roster"
                preValueLabel={formatCompactNumber(Math.round(preTotalValue))}
                postValueLabel={formatCompactNumber(Math.round(item.postTotalValue))}
                preRatio={preTotalValue / Math.max(maxValue, 1)}
                postRatio={item.postTotalValue / Math.max(maxValue, 1)}
                tone="roster"
              />

              {item.preTotalValue == null ? (
                <p className={styles.chartComparisonNote}>
                  New franchise: pre-draft baseline is zero.
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function PlayerCard({
  player,
  compact = false,
  prefix,
  secondaryLine,
}: {
  player: PlannerPlayer;
  compact?: boolean;
  prefix?: string;
  secondaryLine?: string;
}) {
  const cardClassName = compact
    ? `${styles.playerCard} ${styles.playerCardCompact}`
    : styles.playerCard;

  return (
    <article className={cardClassName}>
      <div className={styles.playerCardTop}>
        <span className={styles.rankPill}>{player.rankDisplay}</span>
        <span className={styles.slotPill}>{slotLabel(player)}</span>
      </div>
      <div className={styles.playerCardBody}>
        <p className={styles.playerName}>
          {prefix ? <span className={styles.pickPrefix}>{prefix}</span> : null}
          {player.fullName}
        </p>
        <p className={styles.playerMeta}>{assetMeta(player)}</p>
        {secondaryLine ? <p className={styles.secondaryMeta}>{secondaryLine}</p> : null}
        {player.nickname && !compact ? (
          <p className={styles.nickname}>&quot;{player.nickname}&quot;</p>
        ) : null}
      </div>
    </article>
  );
}

function CompactRangeControl({
  label,
  value,
  min,
  max,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  return (
    <label className={styles.compactControl}>
      <span className={styles.compactControlHeader}>
        <span className={styles.compactControlLabel}>{label}</span>
        <span className={styles.compactControlValue}>{value}</span>
      </span>
      <input
        className={`${styles.range} ${styles.compactRange}`}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        aria-label={`${label}: ${value}`}
      />
      <span className={styles.compactControlBounds} aria-hidden="true">
        <span>{min}</span>
        <span>{max}</span>
      </span>
    </label>
  );
}

function ComparisonBarMeter({
  label,
  preValueLabel,
  postValueLabel,
  preRatio,
  postRatio,
  tone,
}: {
  label: string;
  preValueLabel: string;
  postValueLabel: string;
  preRatio: number;
  postRatio: number;
  tone: "starter" | "roster";
}) {
  const solidFillClassName =
    tone === "starter" ? styles.chartSeriesFillStarter : styles.chartSeriesFillRoster;
  const fadedFillClassName =
    tone === "starter"
      ? styles.chartSeriesFillStarterFaded
      : styles.chartSeriesFillRosterFaded;
  const preWidthPercent = preRatio <= 0 ? 0 : Math.max(preRatio * 100, 4);
  const postWidthPercent = postRatio <= 0 ? 0 : Math.max(postRatio * 100, 4);

  return (
    <div className={styles.chartSeriesRow}>
      <span className={styles.chartSeriesLabel}>{label}</span>
      <span className={styles.chartSeriesTrack}>
        <span
          className={`${styles.chartSeriesFill} ${styles.chartSeriesFillBackdrop} ${fadedFillClassName}`}
          style={{ width: `${preWidthPercent}%` }}
        />
        <span
          className={`${styles.chartSeriesFill} ${styles.chartSeriesFillInset} ${solidFillClassName}`}
          style={{ width: `${postWidthPercent}%` }}
        />
      </span>
      <span className={styles.chartSeriesMetric}>
        {postValueLabel} / {preValueLabel}
      </span>
    </div>
  );
}

function SlotBadge({ slot }: { slot: string }) {
  const normalizedSlot = normalizeSlot(slot);

  if (normalizedSlot === "FLEX" || normalizedSlot === "W_R_T") {
    return (
      <span className={`${styles.slotBadge} ${styles.slotBadgeMulti}`}>
        <span className={`${styles.slotBadgeSegment} ${styles.slotBadgeWr}`}>W</span>
        <span className={`${styles.slotBadgeSegment} ${styles.slotBadgeRb}`}>R</span>
        <span className={`${styles.slotBadgeSegment} ${styles.slotBadgeTe}`}>T</span>
      </span>
    );
  }

  if (normalizedSlot === "SUPER_FLEX" || normalizedSlot === "SUPERFLEX") {
    return (
      <span className={`${styles.slotBadge} ${styles.slotBadgeMulti}`}>
        <span className={`${styles.slotBadgeSegment} ${styles.slotBadgeWr}`}>W</span>
        <span className={`${styles.slotBadgeSegment} ${styles.slotBadgeRb}`}>R</span>
        <span className={`${styles.slotBadgeSegment} ${styles.slotBadgeTe}`}>T</span>
        <span className={`${styles.slotBadgeSegment} ${styles.slotBadgeQb}`}>Q</span>
      </span>
    );
  }

  const classNames = [styles.slotBadge];

  if (normalizedSlot === "QB") {
    classNames.push(styles.slotBadgeQb);
  } else if (normalizedSlot === "RB") {
    classNames.push(styles.slotBadgeRb);
  } else if (normalizedSlot === "WR") {
    classNames.push(styles.slotBadgeWr);
  } else if (normalizedSlot === "TE") {
    classNames.push(styles.slotBadgeTe);
  } else if (normalizedSlot === "PICK") {
    classNames.push(styles.slotBadgePick);
  } else {
    classNames.push(styles.slotBadgeBench);
  }

  const label =
    normalizedSlot === "PICK"
      ? "PK"
      : normalizedSlot === "BENCH"
        ? "BN"
        : normalizedSlot;

  return <span className={classNames.join(" ")}>{label}</span>;
}

function SleeperRow({
  slot,
  asset,
}: {
  slot: string;
  asset: PlannerPlayer | null;
}) {
  return (
    <div className={styles.lineupRow}>
      <SlotBadge slot={slot} />
      {asset ? (
        <>
          <div className={styles.lineupInfo}>
            <strong className={styles.lineupName}>{asset.fullName}</strong>
            <span className={styles.lineupMeta}>{assetMeta(asset)}</span>
          </div>
          <span className={styles.lineupRank}>{asset.rankDisplay}</span>
        </>
      ) : (
        <span className={styles.lineupEmpty}>Open slot</span>
      )}
    </div>
  );
}

function ResultingRosterCard({
  roster,
  anchorId,
}: {
  roster: ResultingLeagueRoster;
  anchorId?: string;
}) {
  return (
    <article
      id={anchorId}
      className={
        roster.isExpansion
          ? `${styles.rosterCard} ${styles.rosterCardExpansion}`
          : styles.rosterCard
      }
    >
      <div className={styles.rosterHeader}>
        <div className={styles.rosterIdentity}>
          <span className={styles.rosterAvatar}>{getInitials(roster.ownerName)}</span>
          <div>
            <strong className={styles.rosterTeamName}>{roster.teamName}</strong>
            <p className={styles.rosterOwner}>{roster.ownerName}</p>
          </div>
        </div>
        <span className={styles.rosterCount}>{roster.assetCount} assets</span>
      </div>

      <div className={styles.rosterBody}>
        <div className={styles.rosterSection}>
          <p className={styles.rosterSectionTitle}>Starters</p>
          <div className={styles.lineupList}>
            {roster.starters.map((starter, index) => (
              <SleeperRow
                key={`${roster.rosterKey}-starter-${starter.slot}-${index}`}
                slot={starter.slot}
                asset={starter.asset}
              />
            ))}
          </div>
        </div>

        <div className={styles.rosterSection}>
          <p className={styles.rosterSectionTitle}>Bench</p>
          <div className={styles.lineupList}>
            {roster.benchAssets.length > 0 ? (
              roster.benchAssets.map((asset) => (
                <SleeperRow
                  key={`${roster.rosterKey}-bench-${asset.playerId}`}
                  slot={asset.assetType === "pick" ? "PICK" : "BENCH"}
                  asset={asset}
                />
              ))
            ) : (
              <div className={styles.emptyState}>No bench assets.</div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function SettingsPanel({
  settings,
  onSettingsChange,
}: {
  settings: PlannerSettings;
  onSettingsChange: (value: PlannerSettings) => void;
}) {
  const [draftSettings, setDraftSettings] = useState(() => settings);
  const frameIdRef = useRef<number | null>(null);
  const pendingSettingsRef = useRef(settings);

  useEffect(() => {
    return () => {
      if (frameIdRef.current != null) {
        cancelAnimationFrame(frameIdRef.current);
      }
    };
  }, []);

  const flushPendingSettings = () => {
    if (frameIdRef.current != null) {
      cancelAnimationFrame(frameIdRef.current);
      frameIdRef.current = null;
    }

    const nextSettings = pendingSettingsRef.current;

    startTransition(() => {
      onSettingsChange(nextSettings);
    });
  };

  const scheduleSettingsCommit = (nextSettings: PlannerSettings) => {
    pendingSettingsRef.current = nextSettings;

    if (frameIdRef.current != null) {
      return;
    }

    frameIdRef.current = requestAnimationFrame(() => {
      frameIdRef.current = null;
      startTransition(() => {
        onSettingsChange(pendingSettingsRef.current);
      });
    });
  };

  const updateDraftSettings = (nextSettingsPatch: Partial<PlannerSettings>) => {
    setDraftSettings((currentSettings) => {
      const nextSettings = {
        ...currentSettings,
        ...nextSettingsPatch,
      };

      scheduleSettingsCommit(nextSettings);

      return nextSettings;
    });
  };

  return (
    <section
      id="planner-settings"
      className={styles.controlsPanel}
      aria-label="Simulation settings"
    >
      <div className={styles.compactSettingsBar}>
        <CompactRangeControl
          label="Keepers"
          value={draftSettings.requestedKeepers}
          min={KEEPERS_RANGE.min}
          max={KEEPERS_RANGE.max}
          onChange={(value) => updateDraftSettings({ requestedKeepers: value })}
          onCommit={flushPendingSettings}
        />
        <CompactRangeControl
          label="Max/team"
          value={draftSettings.sourceTeamSelectionCap}
          min={SOURCE_TEAM_CAP_RANGE.min}
          max={SOURCE_TEAM_CAP_RANGE.max}
          onChange={(value) => updateDraftSettings({ sourceTeamSelectionCap: value })}
          onCommit={flushPendingSettings}
        />
      </div>
    </section>
  );
}

export function ExpansionDraftPlanner({ data }: { data: PlannerData }) {
  const [settings, dispatchSettings] = useReducer(
    plannerSettingsReducer,
    data,
    createInitialPlannerSettings,
  );
  const preparedData = useMemo(() => preparePlannerData(data), [data]);
  const protectedRosters = useMemo(
    () => buildProtectedRosters(preparedData.preparedRosters, settings.requestedKeepers),
    [preparedData.preparedRosters, settings.requestedKeepers],
  );
  const viewModel = useMemo(
    () =>
      buildPlannerViewModel(
        preparedData,
        protectedRosters,
        settings.sourceTeamSelectionCap,
      ),
    [preparedData, protectedRosters, settings.sourceTeamSelectionCap],
  );

  return (
    <section id="planner" className={styles.planner}>
      <SettingsPanel
        settings={settings}
        onSettingsChange={(value) => dispatchSettings({ type: "setSettings", value })}
      />

      <section id="planner-values" className={styles.chartPanel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>Roster values</p>
            <h2 className={styles.panelTitle}>Strength board before and after</h2>
          </div>
          <p className={styles.panelNote}>
            Compare each roster&apos;s pre-draft faded bars against post-draft solid overlays in
            one merged view for starters and full roster value.
          </p>
        </div>

        <p className={styles.mobileHint}>
          Each team now keeps its pre-draft and post-draft starter and roster totals in the
          same compact card.
        </p>

        <RosterValueChart
          data={viewModel.combinedRosterValues}
          emptyStateMessage="No roster values are available for the current simulation."
          ariaLabel="Chart of pre-draft and post-draft roster values by team, with faded pre-draft bars and solid post-draft overlays for starters and whole roster value in each card"
        />
      </section>

      <section id="planner-picks" className={`${styles.panel} ${styles.priorityPanel}`}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>Projected selections</p>
            <h2 className={styles.panelTitle}>Expansion draft board</h2>
          </div>
          <p className={styles.panelNote}>
            Best exposed players, veteran free agents, and picks are assigned by
            draft order while excluding undrafted rookies and respecting the
            single-team cap.
          </p>
        </div>

        <div className={styles.summaryGrid}>
          {viewModel.expansionTeams.map((team) => {
            const anchorId = `expansion-${toAnchorId(team.name)}`;
            const topPick = team.picks[0];

            return (
              <a key={team.name} href={`#${anchorId}`} className={styles.summaryCard}>
                <span className={styles.summaryLabel}>{team.name}</span>
                <strong className={styles.summaryValue}>{team.picks.length} picks</strong>
                <span className={styles.summaryMeta}>
                  {topPick ? `Starts with ${topPick.fullName}` : "No selections at this setting."}
                </span>
              </a>
            );
          })}
        </div>

        <p className={styles.mobileHint}>Swipe sideways to compare each expansion team.</p>

        <div className={styles.expansionScroller}>
          <div className={styles.expansionGrid}>
            {viewModel.expansionTeams.map((team) => {
              const anchorId = `expansion-${toAnchorId(team.name)}`;

              return (
                <article key={team.name} id={anchorId} className={styles.expansionCard}>
                  <div className={styles.expansionHeader}>
                    <div>
                      <h3>{team.name}</h3>
                      <p className={styles.expansionSubhead}>Projected draft board</p>
                    </div>
                    <div className={styles.expansionMeta}>
                      <span>{team.picks.length} picks</span>
                      <span>{formatCompactNumber(sumAssetValues(team.picks))} value</span>
                    </div>
                  </div>

                  <div className={styles.playerList}>
                    {team.picks.length > 0 ? (
                      team.picks.map((pick) => (
                        <PlayerCard
                          key={`${team.name}-${pick.playerId}-${pick.overallPick}`}
                          player={pick}
                          prefix={`${pick.overallPick}.`}
                          secondaryLine={`From ${pick.sourceTeamName}`}
                        />
                      ))
                    ) : (
                      <div className={styles.emptyState}>No selections at this setting.</div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section id="planner-rosters" className={styles.simulatedPanel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>Resulting league</p>
            <h2 className={styles.panelTitle}>
              Resulting {viewModel.orderedResultingLeagueRosters.length}-team league rosters
            </h2>
          </div>
          <p className={styles.panelNote}>
            Expansion teams appear first so the new franchises are easier to inspect
            before paging through the rest of the league.
          </p>
        </div>

        <div className={styles.jumpRail}>
          {viewModel.orderedResultingLeagueRosters.map((roster) => {
            const anchorId = `roster-${toAnchorId(roster.rosterKey)}`;

            return (
              <a
                key={roster.rosterKey}
                href={`#${anchorId}`}
                className={
                  roster.isExpansion
                    ? `${styles.jumpChip} ${styles.jumpChipPriority}`
                    : styles.jumpChip
                }
              >
                {roster.teamName}
              </a>
            );
          })}
        </div>

        <p className={styles.mobileHint}>Swipe sideways to compare rosters one card at a time.</p>

        <div className={styles.rosterScroller}>
          <div className={styles.rosterGrid}>
            {viewModel.orderedResultingLeagueRosters.map((roster) => (
              <ResultingRosterCard
                key={roster.rosterKey}
                roster={roster}
                anchorId={`roster-${toAnchorId(roster.rosterKey)}`}
              />
            ))}
          </div>
        </div>
      </section>

      <section id="planner-keepers" className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>Protected rosters</p>
            <h2 className={styles.panelTitle}>Keepers by team</h2>
          </div>
          <p className={styles.panelNote}>
            This remains the full comparison table. Use it when you need the exact
            protected board team-by-team.
          </p>
        </div>

        <p className={styles.mobileHint}>
          Swipe across the table to compare team columns while the slot column stays pinned.
        </p>

        <div className={styles.tableScroller}>
          <table className={styles.keepersTable}>
            <thead>
              <tr>
                <th className={styles.stickyColumn}>Slot</th>
                {viewModel.protectedRosters.map((roster) => (
                  <th key={roster.rosterId}>
                    <span className={styles.teamName}>{roster.teamName}</span>
                    <span className={styles.teamOwner}>{roster.ownerName}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from(
                { length: settings.requestedKeepers },
                (_, index) => index,
              ).map(
                (rowIndex) => (
                  <tr key={rowIndex}>
                    <th className={styles.stickyColumn}>{rowIndex + 1}</th>
                    {viewModel.protectedRosters.map((roster) => {
                      const player = roster.keepers[rowIndex];

                      return (
                        <td key={`${roster.rosterId}-${rowIndex}`}>
                          {player ? (
                            <PlayerCard player={player} compact />
                          ) : (
                            <div className={styles.emptyState}>No asset</div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
