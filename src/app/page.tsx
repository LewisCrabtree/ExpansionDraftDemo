import { ExpansionDraftPlanner } from "@/components/ExpansionDraftPlanner";
import { loadPlannerData } from "@/lib/planner-data";

import styles from "./page.module.css";

export default async function Home() {
  const plannerData = await loadPlannerData();

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
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
            </div>
          </section>
        </div>

        <ExpansionDraftPlanner data={plannerData} />
      </div>
    </main>
  );
}
