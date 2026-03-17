import { ExpansionDraftPlanner } from "@/components/ExpansionDraftPlanner";
import { loadPlannerData } from "@/lib/planner-data";

import styles from "./page.module.css";

export default async function Home() {
  const plannerData = await loadPlannerData();

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.kicker}>Expansion draft sandbox</p>
            <h1 className={styles.title}>{plannerData.league.name}</h1>
            <p className={styles.subtitle}>
              Model keeper thresholds, expansion selections, and the leftover
              player pool for a two-team expansion using the latest saved Sleeper
              snapshot.
            </p>
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
              <strong>
                {new Date(plannerData.league.snapshotTime).toLocaleString("en-CA", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </strong>
            </div>
            <div className={styles.metaBlock}>
              <span className={styles.metaLabel}>Ranking source</span>
              <strong>{plannerData.rankingSourceLabel}</strong>
            </div>
          </div>
        </section>

        <section className={styles.notesBar}>
          <p>{plannerData.rankingNote}</p>
          <div className={styles.links}>
            <a href={plannerData.links.sleeperLeague} target="_blank" rel="noreferrer">
              Sleeper league
            </a>
            <a href={plannerData.links.keepTradeCutLeague} target="_blank" rel="noreferrer">
              KeepTradeCut league page
            </a>
            <a href={plannerData.links.sleeperDocs} target="_blank" rel="noreferrer">
              Sleeper API docs
            </a>
          </div>
        </section>

        <ExpansionDraftPlanner data={plannerData} />
      </div>
    </main>
  );
}
