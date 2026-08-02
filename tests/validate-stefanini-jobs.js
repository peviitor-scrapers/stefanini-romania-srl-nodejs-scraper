/**
 * STEFANINI-Specific Job URL Validator
 *
 * Two modes:
 *   - HEAD-only (default): fast nightly cleanup pass. Uses HEAD requests only.
 *   - Content-aware (--content): full GET + body scan. Catches soft-404s where
 *     the page returns 200 but the job is gone (e.g. SmartSearchOnline falling
 *     back to the portal home page).
 *
 * Called by .github/workflows/automation-testing.yml (HEAD, scheduled run) and
 * .github/workflows/job-deep-validate.yml (content-aware, manual dispatch).
 *
 * For deep content-aware validation across any CIF, see validate-jobs.js
 * at the repo root.
 *
 * Flags:
 *   --content     Use GET + body scan instead of HEAD-only check
 *   --dry-run     Show invalid jobs but do not delete
 *   --delete      Delete invalid jobs from SOLR after listing
 *   --timeout ms  Request timeout in ms (default 15000)
 */
import companyConfig from "../scraper/config/company.js";
import { querySOLR, deleteJobByUrl } from "../scraper/api.js";
import { validateByHead, validateByContent } from "../scraper/job-validator.js";

const CIF = companyConfig.id;
const COMPANY = companyConfig.company;

async function main() {
  const contentMode = process.argv.includes("--content");
  const dryRun = process.argv.includes("--dry-run");
  const doDelete = process.argv.includes("--delete");
  const timeoutArg = process.argv.indexOf("--timeout");
  const timeout = timeoutArg !== -1 ? Number(process.argv[timeoutArg + 1]) || 15000 : 15000;

  console.log(`=== Validating ${COMPANY} (CIF: ${CIF}) ===`);
  console.log(`Mode: ${contentMode ? "CONTENT (GET + body scan)" : "HEAD-only"}\n`);

  const result = await querySOLR(CIF);
  console.log(`Total jobs in SOLR: ${result.numFound}`);

  if (result.numFound === 0) {
    console.log("No jobs to validate.");
    return;
  }

  const invalid = [];
  for (const job of result.docs) {
    const check = contentMode
      ? await validateByContent(job.url, { timeout })
      : await validateByHead(job.url);
    const verdict = check.status === "active" ? "OK" : check.status.toUpperCase();
    console.log(`[${check.httpStatus}] ${verdict}  ${job.title}`);
    if (check.status !== "active") invalid.push(job);
  }

  if (invalid.length === 0) {
    console.log("\n✅ All jobs valid");
    return;
  }

  console.log(`\n⚠️ ${invalid.length} invalid jobs found`);
  for (const job of invalid) {
    console.log(`  - ${job.title}\n    ${job.url}`);
  }
  if (dryRun) {
    console.log("(dry run — no deletions performed)");
    return;
  }
  if (doDelete) {
    for (const job of invalid) {
      await deleteJobByUrl(job.url);
      console.log(`Deleted: ${job.title}`);
    }
  }
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
