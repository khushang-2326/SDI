import fs from 'fs';
import xlsxPkg from 'xlsx';
const XLSX = xlsxPkg.default || xlsxPkg;

async function main() {
  const wb = XLSX.readFile('data/30-form.xlsx');
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);
  const targetUrls = rows.map((r, idx) => ({
    index: idx + 1,
    url: String(r.website || r.Website || Object.values(r)[0]).trim()
  }));

  const data = JSON.parse(fs.readFileSync('outputs/vps_extracted_data.json', 'utf8'));
  const reportCards = data.reportCards;

  console.log("Matching 29 Target URLs against VPS Report Cards:\n");
  const matched = [];

  for (const t of targetUrls) {
    let host = "";
    try { host = new URL(t.url).hostname.replace(/^www\./, ""); } catch { host = t.url; }

    const card = reportCards.find(c => {
      try {
        const cHost = new URL(c.siteUrl).hostname.replace(/^www\./, "");
        return cHost === host;
      } catch {
        return c.siteUrl.includes(host);
      }
    });

    if (card) {
      matched.push({ target: t, card });
    } else {
      matched.push({ target: t, card: null });
    }
  }

  let succCount = 0;
  let failCount = 0;
  let totalAttempts = 0;

  console.log("| # | Target URL | Title | Outcome | Badge | Trials | Attempts Summary |");
  console.log("|---|------------|-------|---------|-------|--------|------------------|");

  for (const m of matched) {
    const t = m.target;
    const c = m.card;
    if (!c) {
      console.log(`| ${t.index} | ${t.url} | NOT FOUND IN REPORTS | - | - | 0 | - |`);
      continue;
    }

    const isSuccess = c.badge.toLowerCase().includes("completed");
    if (isSuccess) succCount++; else failCount++;
    totalAttempts += c.attemptsCount;

    const attemptsSummary = c.attempts.map(a => `${a.type}:${a.statusText}${a.error ? ' (' + a.error.slice(0, 30) + '...)' : ''}`).join(" ; ");

    console.log(`| ${t.index} | ${t.url} | ${c.title} | ${isSuccess ? 'SUCCESS' : 'FAILED'} | ${c.badge} | ${c.attemptsCount} | ${attemptsSummary} |`);
  }

  console.log("\n==========================================");
  console.log(`SUMMARY: ${succCount}/29 SUCCEEDED (${(succCount/29*100).toFixed(1)}%), ${failCount}/29 FAILED`);
  console.log(`TOTAL TRIALS: ${totalAttempts} (${(totalAttempts/29).toFixed(2)} trials/target)`);
  console.log("==========================================");
}

main().catch(console.error);
