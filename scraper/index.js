import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";
import { fileURLToPath } from "url";
import { validateAndGetCompany } from "./company.js";
import { querySOLR, upsertJobs, upsertCompany } from "./api.js";
import { generateJobsMarkdown } from "./markdown-generator.js";
import companyConfig from "./config/company.js";

const COMPANY_ID = companyConfig.id;

const TARGET_URL = companyConfig.career[0];
const API_BASE = "https://jobs2.smartsearchonline.com/StefaniniEMEA/jobs";

const TIMEOUT = 10000;

let COMPANY_NAME = null;

async function searchANOFM(cif) {
  const jobs = [];
  try {
    console.log(`Searching ANOFM by CIF: ${cif}`);
    const payload = {
      current: 1,
      rowCount: 250,
      sort: { created_at: "desc" },
      employer_tax_code: cif
    };
    const res = await fetch("https://mediere.anofm.ro/api/entity/vw_public_job_posting", {
      method: "POST",
      timeout: TIMEOUT,
      headers: { "Content-Type": "application/json", "User-Agent": "job_seeker_ro_spider" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) { console.log(`  ANOFM returned ${res.status}`); return jobs; }
    const data = await res.json();
    for (const row of data.rows || []) {
      const locationParts = (row.address_locality_name || '').split('>').map(s => s.trim());
      const location = locationParts.length > 1 ? locationParts[locationParts.length - 1] : locationParts[0];
      jobs.push({
        url: `https://mediere.anofm.ro/app/module/mediere/job/${row.id}`,
        title: row.occupation,
        location: location ? [location] : undefined,
        source: "ANOFM"
      });
    }
    console.log(`  Found ${jobs.length} jobs on ANOFM`);
  } catch (err) { console.log(`  ANOFM error: ${err.message}`); }
  return jobs;
}

async function fetchJobListings() {
  console.log(`Fetching STEFANINI jobs page: ${TARGET_URL}`);
  const res = await fetch(TARGET_URL, { timeout: TIMEOUT, headers: { "User-Agent": "job_seeker_ro_spider", "Accept": "text/html" } });
  if (!res.ok) throw new Error(`HTTP error ${res.status} fetching ${TARGET_URL}`);
  return await res.text();
}

function parseJobsHTML(html) {
  const $ = cheerio.load(html);
  const jobs = [];
  $(".list-group-item").each((_, el) => {
    const $el = $(el);
    const title = $el.find("a.coloredlink.bold").first().text().trim();
    if (!title) return;
    const href = $el.find("a.coloredlink.bold").first().attr("href") || "";
    const url = href.startsWith("http") ? href : `${API_BASE}/${href.replace(/^\.\.\/|^\//, "")}`;
    const locationText = $el.find(".thinrow").first().text().trim();
    const locations = locationText.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    jobs.push({ url, title, location: locations.length ? locations : [companyConfig.location?.[0] || "București"], tags: [] });
  });
  return jobs;
}

async function scrapeAllListings() {
  const allJobs = [];
  const seenUrls = new Set();
  console.log("Fetching job listings from STEFANINI careers page...");
  const html = await fetchJobListings();
  const jobs = parseJobsHTML(html);
  console.log(`Total jobs found on listing page: ${jobs.length}`);
  for (const job of jobs) { if (!seenUrls.has(job.url)) { seenUrls.add(job.url); allJobs.push(job); } }
  console.log(`Total unique jobs collected: ${allJobs.length}`);
  return allJobs;
}

function mapToJobModel(rawJob, cif, companyName = COMPANY_NAME) {
  const now = new Date().toISOString();
  const job = {
    url: rawJob.url, title: rawJob.title, company: companyName, cif,
    location: rawJob.location?.length ? rawJob.location : undefined,
    tags: rawJob.tags?.length ? rawJob.tags : undefined,
    workmode: rawJob.workmode || undefined, date: now, status: "scraped"
  };
  Object.keys(job).forEach((k) => job[k] === undefined && delete job[k]);
  return job;
}

function transformJobsForSOLR(payload) {
  const romanianCities = [
    'Bucharest', 'București', 'Cluj-Napoca', 'Cluj Napoca',
    'Timișoara', 'Timisoara', 'Iași', 'Iasi', 'Brașov', 'Brasov',
    'Constanța', 'Constanta', 'Craiova', 'Bacău', 'Sibiu',
    'Târgu Mureș', 'Targu Mures', 'Oradea', 'Baia Mare', 'Satu Mare',
    'Ploiești', 'Ploiesti', 'Pitești', 'Pitesti', 'Arad', 'Galați', 'Galati',
    'Brăila', 'Braila', 'Drobeta-Turnu Severin', 'Râmnicu Vâlcea', 'Ramnicu Valcea',
    'Buzău', 'Buzau', 'Botoșani', 'Botosani', 'Zalău', 'Zalau', 'Hunedoara', 'Deva',
    'Suceava', 'Bistrița', 'Bistrita', 'Tulcea', 'Călărași', 'Calarasi',
    'Giurgiu', 'Alba Iulia', 'Slatina', 'Piatra Neamț', 'Piatra Neamt', 'Roman',
    'Dumbrăvița', 'Dumbravita', 'Voluntari', 'Popești-Leordeni', 'Popesti-Leordeni',
    'Chitila', 'Mogoșoaia', 'Mogosoaia', 'Otopeni'
  ];
  const citySet = new Set(romanianCities.map(c => c.toLowerCase()));
  const normalizeWorkmode = (wm) => {
    if (!wm) return undefined;
    const lower = wm.toLowerCase();
    if (lower.includes('remote')) return 'remote';
    if (lower.includes('office') || lower.includes('on-site') || lower.includes('site')) return 'on-site';
    return 'hybrid';
  };
  const transformed = {
    ...payload,
    company: payload.company?.toUpperCase(),
    jobs: payload.jobs.map(job => {
      const validLocations = (job.location || []).filter(loc => {
        const lower = loc.toLowerCase().trim();
        if (lower === 'romania' || lower === 'românia') return true;
        return citySet.has(lower);
      }).map(loc => loc.toLowerCase() === 'romania' ? 'România' : loc);
      return { ...job, location: validLocations.length > 0 ? validLocations : ['România'], workmode: normalizeWorkmode(job.workmode) };
    })
  };
  return transformed;
}

async function main() {
  const testOnlyOnePage = process.argv.includes("--test");

  try {
    fs.mkdirSync("scraper", { recursive: true });

    console.log("=== Step 1: Get existing jobs count ===");
    const existingResult = await querySOLR(COMPANY_ID);
    const existingCount = existingResult.numFound;
    console.log(`Found ${existingCount} existing jobs in SOLR`);

    console.log("=== Step 2: Validate company via ANAF ===");
    const { company, cif, address } = await validateAndGetCompany();
    COMPANY_NAME = company;
    const localCif = cif;

    try {
      await upsertCompany({
        id: cif, company,
        brand: companyConfig.brand || undefined,
        status: "activ",
        location: address ? [address] : companyConfig.location,
        website: companyConfig.website,
        career: companyConfig.career,
        scraperFile: companyConfig.scraperFile,
        lastScraped: new Date().toISOString().split('T')[0]
      });
    } catch (err) { console.log(`Note: Could not upsert company to SOLR core: ${err.message}`); }

    const rawJobs = await scrapeAllListings();
    const scrapedCount = rawJobs.length;
    console.log(`Jobs scraped from STEFANINI website: ${scrapedCount}`);

    if (!testOnlyOnePage) {
      const anofmJobs = await searchANOFM(localCif);
      for (const job of anofmJobs) { if (!rawJobs.find(j => j.url === job.url)) rawJobs.push(job); }
      console.log(`Jobs added from ANOFM: ${anofmJobs.length}`);
    }

    const jobs = rawJobs.map(job => mapToJobModel(job, localCif));

    const payload = {
      source: "smartsearchonline.com",
      scrapedAt: new Date().toISOString(),
      company: COMPANY_NAME,
      cif: localCif,
      jobs
    };

    console.log("Transforming jobs for SOLR...");
    const transformedPayload = transformJobsForSOLR(payload);
    const validCount = transformedPayload.jobs.filter(j => j.location).length;
    console.log(`Jobs with valid Romanian locations: ${validCount}`);

    fs.writeFileSync("scraper/jobs.json", JSON.stringify(transformedPayload, null, 2), "utf-8");
    console.log("Saved scraper/jobs.json");

    const companyData = {
      id: localCif, company: transformedPayload.company,
      brand: companyConfig.brand || undefined, status: "activ",
      location: address ? [address] : companyConfig.location,
      website: companyConfig.website, career: companyConfig.career,
      lastScraped: new Date().toISOString().split('T')[0]
    };
    const markdown = generateJobsMarkdown(companyData, transformedPayload.jobs);
    fs.mkdirSync("docs", { recursive: true });
    fs.writeFileSync("docs/jobs.md", markdown, "utf-8");
    console.log("Saved docs/jobs.md");

    fs.copyFileSync("scraper/config/company.json", "docs/company.json");
    console.log("Copied scraper/config/company.json → docs/company.json");

    console.log("\n=== Step 4: Upsert jobs to SOLR ===");
    await upsertJobs(transformedPayload.jobs);

    const finalResult = await querySOLR(COMPANY_ID);
    console.log(`\n=== SUMMARY ===`);
    console.log(`Jobs existing in SOLR before scrape: ${existingCount}`);
    console.log(`Jobs scraped from STEFANINI website: ${scrapedCount}`);
    console.log(`Jobs in SOLR after scrape: ${finalResult.numFound}`);
    console.log(`====================`);
    console.log("\n=== DONE ===");
    console.log("Scraper completed successfully!");

  } catch (err) {
    console.error("Scraper failed:", err);
    process.exit(1);
  }
}

export { parseJobsHTML, mapToJobModel, transformJobsForSOLR };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
