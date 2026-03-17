"use client";

import { useState } from "react";

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
};

type ExpansionTeam = {
  name: string;
  picks: ExpansionPick[];
};

type TeamDraftImpact = {
  rosterId: number;
  teamName: string;
  ownerName: string;
  assetsTaken: number;
  totalValueTaken: number;
};

type RosterValueSnapshot = {
  rosterKey: string;
  teamName: string;
  ownerName: string;
  starterValue: number;
  totalValue: number;
};

type DraftSimulation = {
  expansionTeams: ExpansionTeam[];
  selectedAssetIds: Set<string>;
  sourceRosterSelectionCounts: Map<number, number>;
  sourceRosterValueTaken: Map<number, number>;
};

type SimulationSettings = {
  requestedSelectionsPerExpansionTeam: number;
  draftMode: DraftMode;
  sourceTeamSelectionCap: number;
  includeFreeAgents: boolean;
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

function shortenTeamLabel(teamName: string) {
  return teamName.length > 16 ? `${teamName.slice(0, 15)}...` : teamName;
}

function getStarterSlots(rosterPositions: string[]) {
  return rosterPositions.filter((slot) => !BENCH_SLOT_NAMES.has(normalizeSlot(slot)));
}

function canAssetFillSlot(asset: PlannerPlayer, slot: string) {
  if (asset.assetType !== "player") {
    return false;
  }

  const normalizedSlot = normalizeSlot(slot);
  const position = asset.position.toUpperCase();

  if (normalizedSlot === "FLEX" || normalizedSlot === "W_R_T") {
    return ["RB", "WR", "TE"].includes(position);
  }

  if (normalizedSlot === "SUPER_FLEX" || normalizedSlot === "SUPERFLEX") {
    return ["QB", "RB", "WR", "TE"].includes(position);
  }

  return position === normalizedSlot;
}

function buildLineup(
  assets: PlannerPlayer[],
  starterSlots: string[],
): {
  starters: LineupSlotAssignment[];
  benchAssets: PlannerPlayer[];
} {
  const assignedAssetIds = new Set<string>();
  const playerAssets = assets.filter((asset) => asset.assetType === "player");
  const starters = starterSlots.map((slot) => {
    const asset =
      playerAssets.find(
        (candidate) =>
          !assignedAssetIds.has(candidate.playerId) && canAssetFillSlot(candidate, slot),
      ) ?? null;

    if (asset) {
      assignedAssetIds.add(asset.playerId);
    }

    return {
      slot,
      asset,
    };
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
  const sourceRosterValueTaken = new Map<number, number>();
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
      sourceRosterValueTaken.set(
        asset.sourceRosterId,
        (sourceRosterValueTaken.get(asset.sourceRosterId) ?? 0) +
          (asset.value ?? 0),
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
    sourceRosterSelectionCounts,
    sourceRosterValueTaken,
  };
}

function TeamImpactChart({
  data,
  countSeriesLabel,
}: {
  data: TeamDraftImpact[];
  countSeriesLabel: string;
}) {
  const maxValueTaken = Math.max(...data.map((item) => item.totalValueTaken), 0);
  const maxAssetsTaken = Math.max(...data.map((item) => item.assetsTaken), 0);

  if (maxValueTaken === 0 && maxAssetsTaken === 0) {
    return (
      <div className={styles.emptyState}>
        No expansion picks are being filled under the current settings.
      </div>
    );
  }

  const chartWidth = Math.max(840, data.length * 92);
  const chartHeight = 360;
  const margin = {
    top: 28,
    right: 64,
    bottom: 118,
    left: 64,
  };
  const innerWidth = chartWidth - margin.left - margin.right;
  const innerHeight = chartHeight - margin.top - margin.bottom;
  const bandWidth = innerWidth / data.length;
  const barWidth = Math.min(34, bandWidth * 0.42);
  const valueScaleMax = Math.max(maxValueTaken, 1);
  const assetScaleMax = Math.max(maxAssetsTaken, 1);
  const gridLineCount = 4;

  const points = data.map((item, index) => {
    const x = margin.left + bandWidth * index + bandWidth / 2;
    const barHeight = (item.totalValueTaken / valueScaleMax) * innerHeight;
    const barY = margin.top + innerHeight - barHeight;
    const lineY =
      margin.top + innerHeight - (item.assetsTaken / assetScaleMax) * innerHeight;

    return {
      ...item,
      x,
      barHeight,
      barY,
      lineY,
    };
  });

  const linePath = points
    .map((point, index) =>
      `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.lineY.toFixed(1)}`,
    )
    .join(" ");

  return (
    <div className={styles.chartBlock}>
      <div className={styles.chartLegend}>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendSwatchValue}`} />
          Total value taken
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendSwatchPlayers}`} />
          {countSeriesLabel}
        </span>
      </div>

      <div className={styles.chartScroller}>
        <svg
          className={styles.impactChart}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label={`Chart of expansion-draft impact by team, showing total value taken and ${countSeriesLabel.toLowerCase()}`}
        >
          {Array.from({ length: gridLineCount + 1 }, (_, index) => {
            const ratio = index / gridLineCount;
            const y = margin.top + innerHeight - ratio * innerHeight;
            const valueTick = (valueScaleMax / gridLineCount) * index;
            const assetTick = (assetScaleMax / gridLineCount) * index;

            return (
              <g key={index}>
                <line
                  className={styles.chartGridLine}
                  x1={margin.left}
                  y1={y}
                  x2={chartWidth - margin.right}
                  y2={y}
                />
                <text className={styles.chartAxisText} x={margin.left - 12} y={y + 4}>
                  {formatCompactNumber(Math.round(valueTick))}
                </text>
                <text
                  className={styles.chartAxisText}
                  x={chartWidth - margin.right + 12}
                  y={y + 4}
                  textAnchor="start"
                >
                  {Math.round(assetTick)}
                </text>
              </g>
            );
          })}

          <line
            className={styles.chartAxisLine}
            x1={margin.left}
            y1={margin.top + innerHeight}
            x2={chartWidth - margin.right}
            y2={margin.top + innerHeight}
          />

          {points.map((point) => (
            <g key={point.rosterId}>
              <title>
                {`${point.teamName}: ${point.assetsTaken} taken, ${formatCompactNumber(point.totalValueTaken)} value`}
              </title>
              <rect
                className={styles.chartBar}
                x={point.x - barWidth / 2}
                y={point.barY}
                width={barWidth}
                height={point.barHeight}
                rx={10}
              />
              <text
                className={styles.chartLabel}
                x={point.x}
                y={chartHeight - 26}
                textAnchor="end"
                transform={`rotate(-35 ${point.x} ${chartHeight - 26})`}
              >
                {shortenTeamLabel(point.teamName)}
              </text>
            </g>
          ))}

          <path className={styles.chartLine} d={linePath} />

          {points.map((point) => (
            <circle
              key={`dot-${point.rosterId}`}
              className={styles.chartDot}
              cx={point.x}
              cy={point.lineY}
              r={5}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

function RosterValueChart({
  data,
  emptyStateMessage,
  ariaLabel,
}: {
  data: RosterValueSnapshot[];
  emptyStateMessage: string;
  ariaLabel: string;
}) {
  const maxValue = Math.max(...data.map((item) => item.totalValue), 0);

  if (maxValue === 0) {
    return <div className={styles.emptyState}>{emptyStateMessage}</div>;
  }

  const chartWidth = Math.max(840, data.length * 92);
  const chartHeight = 360;
  const margin = {
    top: 28,
    right: 24,
    bottom: 118,
    left: 64,
  };
  const innerWidth = chartWidth - margin.left - margin.right;
  const innerHeight = chartHeight - margin.top - margin.bottom;
  const bandWidth = innerWidth / data.length;
  const seriesGap = Math.min(12, bandWidth * 0.12);
  const barWidth = Math.min(24, (bandWidth - seriesGap) / 2.35);
  const valueScaleMax = Math.max(maxValue, 1);
  const gridLineCount = 4;

  const bars = data.map((item, index) => {
    const centerX = margin.left + bandWidth * index + bandWidth / 2;
    const starterHeight = (item.starterValue / valueScaleMax) * innerHeight;
    const totalHeight = (item.totalValue / valueScaleMax) * innerHeight;

    return {
      ...item,
      centerX,
      starterX: centerX - seriesGap / 2 - barWidth,
      totalX: centerX + seriesGap / 2,
      starterHeight,
      totalHeight,
      starterY: margin.top + innerHeight - starterHeight,
      totalY: margin.top + innerHeight - totalHeight,
    };
  });

  return (
    <div className={styles.chartBlock}>
      <div className={styles.chartLegend}>
        <span className={styles.legendItem}>
          <span
            className={`${styles.legendSwatch} ${styles.legendSwatchStarterValue}`}
          />
          Starter value
        </span>
        <span className={styles.legendItem}>
          <span
            className={`${styles.legendSwatch} ${styles.legendSwatchRosterValue}`}
          />
          Whole roster value
        </span>
      </div>

      <div className={styles.chartScroller}>
        <svg
          className={styles.impactChart}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label={ariaLabel}
        >
          {Array.from({ length: gridLineCount + 1 }, (_, index) => {
            const ratio = index / gridLineCount;
            const y = margin.top + innerHeight - ratio * innerHeight;
            const valueTick = (valueScaleMax / gridLineCount) * index;

            return (
              <g key={index}>
                <line
                  className={styles.chartGridLine}
                  x1={margin.left}
                  y1={y}
                  x2={chartWidth - margin.right}
                  y2={y}
                />
                <text className={styles.chartAxisText} x={margin.left - 12} y={y + 4}>
                  {formatCompactNumber(Math.round(valueTick))}
                </text>
              </g>
            );
          })}

          <line
            className={styles.chartAxisLine}
            x1={margin.left}
            y1={margin.top + innerHeight}
            x2={chartWidth - margin.right}
            y2={margin.top + innerHeight}
          />

          {bars.map((bar) => (
            <g key={bar.rosterKey}>
              <title>
                {`${bar.teamName}: starters ${formatCompactNumber(bar.starterValue)}, whole roster ${formatCompactNumber(bar.totalValue)}`}
              </title>
              <rect
                className={styles.chartBarStarter}
                x={bar.starterX}
                y={bar.starterY}
                width={barWidth}
                height={bar.starterHeight}
                rx={10}
              />
              <rect
                className={styles.chartBarRoster}
                x={bar.totalX}
                y={bar.totalY}
                width={barWidth}
                height={bar.totalHeight}
                rx={10}
              />
              <text
                className={styles.chartLabel}
                x={bar.centerX}
                y={chartHeight - 26}
                textAnchor="end"
                transform={`rotate(-35 ${bar.centerX} ${chartHeight - 26})`}
              >
                {shortenTeamLabel(bar.teamName)}
              </text>
            </g>
          ))}
        </svg>
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
        {player.nickname ? (
          <p className={styles.nickname}>&quot;{player.nickname}&quot;</p>
        ) : null}
      </div>
    </article>
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

function ResultingRosterCard({ roster }: { roster: ResultingLeagueRoster }) {
  return (
    <article
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

export function ExpansionDraftPlanner({ data }: { data: PlannerData }) {
  const [keepersPerTeam, setKeepersPerTeam] = useState(
    clamp(8, KEEPERS_RANGE.min, KEEPERS_RANGE.max),
  );
  const [maxSelectionsFromSingleTeam, setMaxSelectionsFromSingleTeam] = useState<number>(
    SOURCE_TEAM_CAP_RANGE.max,
  );
  const [includeDraftPicks, setIncludeDraftPicks] = useState(true);
  const [includeFreeAgents, setIncludeFreeAgents] = useState(true);
  const [draftMode, setDraftMode] = useState<DraftMode>("snake");

  const requestedKeepers = clamp(
    keepersPerTeam,
    KEEPERS_RANGE.min,
    KEEPERS_RANGE.max,
  );
  const requestedSelectionsPerExpansionTeam = EXPANSION_PICKS_RANGE.max;
  const sourceTeamSelectionCap = clamp(
    maxSelectionsFromSingleTeam,
    SOURCE_TEAM_CAP_RANGE.min,
    SOURCE_TEAM_CAP_RANGE.max,
  );
  const availableDraftPickCount = data.rosters.reduce(
    (total, roster) => total + roster.draftPicks.length,
    0,
  );
  const starterSlots = getStarterSlots(data.league.rosterPositions);
  const simulationSettings = {
    requestedSelectionsPerExpansionTeam,
    draftMode,
    sourceTeamSelectionCap,
    includeFreeAgents,
  } satisfies SimulationSettings;

  const protectedRosters: ProtectedRoster[] = data.rosters.map((roster) => {
    const assets = includeDraftPicks
      ? [...roster.players, ...roster.draftPicks].sort(comparePlayers)
      : roster.players;

    return {
      ...roster,
      assets,
      keepers: assets.slice(0, requestedKeepers),
      exposed: assets.slice(requestedKeepers),
    };
  });

  const availablePool = protectedRosters
    .flatMap((roster) =>
      roster.exposed.map(
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
  const freeAgentPool = data.freeAgents.map(
    (player) =>
      ({
        ...player,
        sourceRosterId: null,
        sourceTeamName: "F/A",
        sourceOwnerName: "Free agency",
        sourceType: "freeAgent",
      }) satisfies PoolAsset,
  );

  const draftableAssetLimit = protectedRosters.reduce(
    (total, roster) => total + Math.min(roster.exposed.length, sourceTeamSelectionCap),
    0,
  );
  const activeDraftPoolCount =
    availablePool.length + (includeFreeAgents ? freeAgentPool.length : 0);
  const maxFillableSelectionsPerExpansionTeam = Math.min(
    EXPANSION_PICKS_RANGE.max,
    Math.floor(
      (draftableAssetLimit + (includeFreeAgents ? freeAgentPool.length : 0)) /
        EXPANSION_TEAM_NAMES.length,
    ),
  );

  const {
    expansionTeams,
    selectedAssetIds,
    sourceRosterSelectionCounts,
    sourceRosterValueTaken,
  } = simulateExpansionDraft({
    rosterPool: availablePool,
    freeAgentPool,
    settings: simulationSettings,
  });

  const totalExpansionSelections = expansionTeams.reduce(
    (total, team) => total + team.picks.length,
    0,
  );
  const remainingAssetCount = activeDraftPoolCount - totalExpansionSelections;
  const actualSelectionsByExpansionTeam = expansionTeams.map((team) => team.picks.length);
  const hasConstrainedDraft =
    actualSelectionsByExpansionTeam.some(
      (count) => count !== requestedSelectionsPerExpansionTeam,
    ) || requestedSelectionsPerExpansionTeam > maxFillableSelectionsPerExpansionTeam;
  const countSeriesLabel = includeDraftPicks ? "Assets taken" : "Players taken";
  const assetLabel = includeDraftPicks ? "assets" : "players";

  const impactByTeam: TeamDraftImpact[] = protectedRosters.map((roster) => ({
    rosterId: roster.rosterId,
    teamName: roster.teamName,
    ownerName: roster.ownerName,
    assetsTaken: sourceRosterSelectionCounts.get(roster.rosterId) ?? 0,
    totalValueTaken: sourceRosterValueTaken.get(roster.rosterId) ?? 0,
  }));
  const resultingLeagueRosters: ResultingLeagueRoster[] = [
    ...protectedRosters.map((roster) => {
      const resultingAssets = roster.assets
        .filter((asset) => !selectedAssetIds.has(asset.playerId))
        .sort(comparePlayers);
      const { starters, benchAssets } = buildLineup(resultingAssets, starterSlots);

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
      const { starters, benchAssets } = buildLineup(teamAssets, starterSlots);

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
  const preDraftRosterValues: RosterValueSnapshot[] = protectedRosters.map((roster) => {
    const { starters, benchAssets } = buildLineup(roster.assets, starterSlots);
    const starterAssets = starters.map((starter) => starter.asset);
    const starterValue = sumAssetValues(starterAssets);

    return {
      rosterKey: `pre-${roster.rosterId}`,
      teamName: roster.teamName,
      ownerName: roster.ownerName,
      starterValue,
      totalValue: starterValue + sumAssetValues(benchAssets),
    } satisfies RosterValueSnapshot;
  });
  const resultingRosterValues: RosterValueSnapshot[] = resultingLeagueRosters.map(
    (roster) => {
      const starterAssets = roster.starters.map((starter) => starter.asset);
      const starterValue = sumAssetValues(starterAssets);

      return {
        rosterKey: roster.rosterKey,
        teamName: roster.teamName,
        ownerName: roster.ownerName,
        starterValue,
        totalValue: starterValue + sumAssetValues(roster.benchAssets),
      } satisfies RosterValueSnapshot;
    },
  );

  return (
    <section className={styles.planner}>
      <div className={styles.controlsPanel}>
        <div className={styles.controlsGrid}>
          <label className={styles.control}>
            <span className={styles.controlLabel}>Keepers per team</span>
            <input
              className={styles.range}
              type="range"
              min={KEEPERS_RANGE.min}
              max={KEEPERS_RANGE.max}
              value={requestedKeepers}
              onChange={(event) => setKeepersPerTeam(Number(event.target.value))}
            />
            <strong className={styles.controlValue}>{requestedKeepers}</strong>
          </label>

          <label className={styles.control}>
            <span className={styles.controlLabel}>Max picks from one team</span>
            <input
              className={styles.range}
              type="range"
              min={SOURCE_TEAM_CAP_RANGE.min}
              max={SOURCE_TEAM_CAP_RANGE.max}
              value={sourceTeamSelectionCap}
              onChange={(event) =>
                setMaxSelectionsFromSingleTeam(Number(event.target.value))
              }
            />
            <strong className={styles.controlValue}>{sourceTeamSelectionCap}</strong>
            <span className={styles.helperText}>
              Applies across both expansion teams combined. Current{" "}
              {includeFreeAgents ? "pool plus F/A" : "pool"} can fill up to{" "}
              {maxFillableSelectionsPerExpansionTeam} per expansion team.
            </span>
          </label>

          <label className={styles.control}>
            <span className={styles.controlLabel}>Include draft picks</span>
            <span className={styles.toggleRow}>
              <input
                className={styles.checkbox}
                type="checkbox"
                checked={includeDraftPicks}
                onChange={(event) => setIncludeDraftPicks(event.target.checked)}
              />
              <strong className={styles.toggleValue}>
                {includeDraftPicks ? "Enabled" : "Disabled"}
              </strong>
            </span>
            <span className={styles.helperText}>
              Adds {availableDraftPickCount} current rookie picks using the 2026 draft
              slot tiers.
            </span>
          </label>

          <label className={styles.control}>
            <span className={styles.controlLabel}>Include F/A</span>
            <span className={styles.toggleRow}>
              <input
                className={styles.checkbox}
                type="checkbox"
                checked={includeFreeAgents}
                onChange={(event) => setIncludeFreeAgents(event.target.checked)}
              />
              <strong className={styles.toggleValue}>
                {includeFreeAgents ? "Enabled" : "Disabled"}
              </strong>
            </span>
            <span className={styles.helperText}>
              Uses {data.freeAgents.length} ranked free agents only after team-owned
              assets can no longer fill the draft.
            </span>
          </label>

          <label className={styles.control}>
            <span className={styles.controlLabel}>Expansion draft order</span>
            <select
              className={styles.select}
              value={draftMode}
              onChange={(event) => setDraftMode(event.target.value as DraftMode)}
            >
              <option value="snake">Snake</option>
              <option value="linear">Linear</option>
            </select>
            <span className={styles.helperText}>
              Snake alternates direction every two picks.
            </span>
          </label>
        </div>

        <div className={styles.metricsGrid}>
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>Protected {assetLabel}</span>
            <strong className={styles.metricValue}>
              {protectedRosters.reduce((total, roster) => total + roster.keepers.length, 0)}
            </strong>
          </article>

          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>Expansion pool</span>
            <strong className={styles.metricValue}>{activeDraftPoolCount}</strong>
          </article>

          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>Expansion selections</span>
            <strong className={styles.metricValue}>{totalExpansionSelections}</strong>
          </article>

          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>Still available</span>
            <strong className={styles.metricValue}>{remainingAssetCount}</strong>
          </article>
        </div>

        {hasConstrainedDraft ? (
          <p className={styles.constraintNote}>
            Current settings requested {requestedSelectionsPerExpansionTeam} picks per
            expansion team, but the simulation filled {actualSelectionsByExpansionTeam[0]}
            {" / "}
            {actualSelectionsByExpansionTeam[1]} after applying the exposed pool,
            per-team cap, and {includeFreeAgents ? "optional F/A fallback." : "no F/A fallback."}
          </p>
        ) : null}
      </div>

      <section className={styles.chartPanel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>Simulated impact</p>
            <h2 className={styles.panelTitle}>Value and {assetLabel} lost by team</h2>
          </div>
          <p className={styles.panelNote}>
            Bars show total value taken. The line shows {countSeriesLabel.toLowerCase()}
            {" "}from each existing team. Missing values count as 0.
          </p>
        </div>

        <TeamImpactChart data={impactByTeam} countSeriesLabel={countSeriesLabel} />
      </section>

      <div className={styles.contentGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Protected rosters</p>
              <h2 className={styles.panelTitle}>Keepers by team</h2>
            </div>
            <p className={styles.panelNote}>
              Each column is sorted by the active ranking source. Draft picks are
              included when enabled.
            </p>
          </div>

          <div className={styles.tableScroller}>
            <table className={styles.keepersTable}>
              <thead>
                <tr>
                  <th className={styles.stickyColumn}>Slot</th>
                  {protectedRosters.map((roster) => (
                    <th key={roster.rosterId}>
                      <span className={styles.teamName}>{roster.teamName}</span>
                      <span className={styles.teamOwner}>{roster.ownerName}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: requestedKeepers }, (_, index) => index).map(
                  (rowIndex) => (
                    <tr key={rowIndex}>
                      <th className={styles.stickyColumn}>{rowIndex + 1}</th>
                      {protectedRosters.map((roster) => {
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

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Expansion teams</p>
              <h2 className={styles.panelTitle}>Projected selections</h2>
            </div>
            <p className={styles.panelNote}>
              Best exposed {assetLabel} are assigned by draft order while respecting
              the single-team cap.
            </p>
          </div>

          <div className={styles.expansionGrid}>
            {expansionTeams.map((team) => (
              <article key={team.name} className={styles.expansionCard}>
                <div className={styles.expansionHeader}>
                  <h3>{team.name}</h3>
                  <span>{team.picks.length} picks</span>
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
            ))}
          </div>
        </section>
      </div>

      <section className={styles.simulatedPanel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>Resulting league</p>
            <h2 className={styles.panelTitle}>
              Resulting {resultingLeagueRosters.length}-team league rosters
            </h2>
          </div>
          <p className={styles.panelNote}>
            Sleeper-style starter and bench layout using the current lineup slots
            and simulated expansion outcome.
          </p>
        </div>

        <div className={styles.rosterGrid}>
          {resultingLeagueRosters.map((roster) => (
            <ResultingRosterCard key={roster.rosterKey} roster={roster} />
          ))}
        </div>

        <div className={styles.panelSubsection}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Resulting values</p>
              <h3 className={styles.panelTitle}>Starter and whole-roster value</h3>
            </div>
            <p className={styles.panelNote}>
              Post-draft KTC value totals for each resulting roster. Missing values
              count as 0.
            </p>
          </div>

          <RosterValueChart
            data={resultingRosterValues}
            emptyStateMessage="No roster values are available for the simulated result."
            ariaLabel="Chart of resulting roster values by team, showing starter value and whole roster value"
          />
        </div>

        <div className={styles.panelSubsection}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Pre-draft values</p>
              <h3 className={styles.panelTitle}>Starter and whole-roster value</h3>
            </div>
            <p className={styles.panelNote}>
              KTC value totals for each team before the simulated expansion draft.
              Missing values count as 0.
            </p>
          </div>

          <RosterValueChart
            data={preDraftRosterValues}
            emptyStateMessage="No roster values are available for the pre-draft view."
            ariaLabel="Chart of pre-draft roster values by team, showing starter value and whole roster value"
          />
        </div>
      </section>
    </section>
  );
}
