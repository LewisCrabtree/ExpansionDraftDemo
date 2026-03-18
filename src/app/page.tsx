import { ExpansionDraftPlanner } from "@/components/ExpansionDraftPlanner";
import { loadPlannerData } from "@/lib/planner-data";

import styles from "./page.module.css";

export default async function Home() {
  const plannerData = await loadPlannerData();
  const snapshotLabel = new Date(plannerData.league.snapshotTime).toLocaleString(
    "en-CA",
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  );

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <details className={styles.topNav}>
          <summary className={styles.topNavToggle}>Navigate</summary>
          <nav className={styles.topNavMenu} aria-label="Page sections">
            <a href="#planner" className={styles.topNavLink}>
              Expansion Draft
            </a>
            <a href="#league-stats" className={styles.topNavLink}>
              League Stats
            </a>
          </nav>
        </details>

        <div id="league-stats" className={styles.leagueStatsSection}>
          <section className={styles.hero}>
            <div className={styles.heroCopy}>
              <p className={styles.kicker}>Expansion draft sandbox</p>
              <h1 className={styles.title}>{plannerData.league.name}</h1>
              <p className={styles.subtitle}>
                Test keeper protection, expansion-team picks, and post-draft roster
                outcomes from your saved Sleeper league snapshot.
              </p>
              <div className={styles.heroTags}>
                <span className={styles.heroTag}>2 expansion teams</span>
                <span className={styles.heroTag}>
                  {plannerData.league.totalRosters}-team league
                </span>
                <span className={styles.heroTag}>
                  Bundled {plannerData.league.season} snapshot
                </span>
              </div>
              <div className={styles.heroActions}>
                <a href="#planner" className={styles.primaryAction}>
                  Open planner
                </a>
              </div>
            </div>

            <div className={styles.heroMeta}>
              <div className={styles.metaBlock}>
                <span className={styles.metaLabel}>League</span>
                <strong>
                  {plannerData.league.totalRosters} teams - {plannerData.league.season}
                </strong>
              </div>
              <div className={styles.metaBlock}>
                <span className={styles.metaLabel}>Snapshot</span>
                <strong>{snapshotLabel}</strong>
              </div>
              <div className={styles.metaBlock}>
                <span className={styles.metaLabel}>Values</span>
                <strong>{plannerData.rankingSourceLabel}</strong>
              </div>
            </div>
          </section>

          <section className={styles.notesBar}>
            <div className={styles.notesCopy}>
              <span className={styles.notesLabel}>Data note</span>
              <p>
                Uses the bundled KTC CSV file for player values, with Sleeper
                search-rank fallback where the CSV is missing a player.
              </p>
            </div>
            <div className={styles.links}>
              <a href={plannerData.links.sleeperLeague} target="_blank" rel="noreferrer">
                Sleeper league
              </a>
              <a href={plannerData.links.keepTradeCutLeague} target="_blank" rel="noreferrer">
                KeepTradeCut league page
              </a>
            </div>
          </section>
        </div>

        <ExpansionDraftPlanner data={plannerData} />
      </div>
    </main>
  );
}
