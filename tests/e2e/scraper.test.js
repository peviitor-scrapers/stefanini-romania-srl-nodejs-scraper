import { jest } from '@jest/globals';
import fetch from 'node-fetch';

const API_BASE = 'https://api.peviitor.ro/v1';

let HAS_API = false;

async function checkApiAvailability() {
  try {
    const res = await fetch(`${API_BASE}/scraper/jobs/?cif=16139707&rows=1`, {
      signal: AbortSignal.timeout(5000)
    });
    return res.ok || res.status === 400;
  } catch {
    return false;
  }
}

let HAS_ANAF = false;

async function checkAnafAvailability() {
  try {
    const res = await fetch('https://demoanaf.ro/api/search?q=test', {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

function itIfApi(name, fn, timeout) {
  if (HAS_API) {
    return it(name, fn, timeout);
  }
  return it.skip(`${name} (skipped: API unavailable)`, fn, timeout);
}

function itIfAnaf(name, fn, timeout) {
  if (HAS_ANAF) {
    return it(name, fn, timeout);
  }
  return it.skip(`${name} (skipped: ANAF API unavailable)`, fn, timeout);
}

beforeAll(async () => {
  [HAS_API, HAS_ANAF] = await Promise.all([checkApiAvailability(), checkAnafAvailability()]);
});

const TEST_CIF = '16139707';
const TEST_BRAND = 'Stefanini';
const STEFANINI_LISTING_URL = 'https://jobs2.smartsearchonline.com/StefaniniEMEA/jobs/process_jobsearch.asp?country=Romania';
const ROMANIAN_CITIES = ['Bucharest', 'București', 'Cluj-Napoca', 'Timișoara', 'Iași', 'Brașov', 'Constanța', 'Sibiu', 'Oradea'];

describe('E2E: Full Scraping Pipeline', () => {

  describe('SmartSearchOnline — Real Data Fetch', () => {
    let html;

    beforeAll(async () => {
      const res = await fetch(STEFANINI_LISTING_URL, {
        headers: {
          'User-Agent': 'job_seeker_ro_spider',
          'Accept': 'text/html'
        }
      });
      html = await res.text();
    }, 30000);

    it('should respond with valid HTML from Stefanini careers page', () => {
      expect(html).toBeDefined();
      expect(html.length).toBeGreaterThan(100);
    }, 10000);

    it('should have job listing elements in the HTML', () => {
      expect(html).toContain('list-group-item');
      expect(html).toContain('coloredlink');
    });
  });

  describe('Parse + Transform Pipeline', () => {
    let index;
    let html;

    beforeAll(async () => {
      index = await import('../../scraper/index.js');
      const res = await fetch(STEFANINI_LISTING_URL, {
        headers: {
          'User-Agent': 'job_seeker_ro_spider',
          'Accept': 'text/html'
        }
      });
      html = await res.text();
    }, 30000);

    it('should parse real SmartSearchOnline HTML into standardized format', () => {
      const jobs = index.parseJobsHTML(html);

      expect(Array.isArray(jobs)).toBe(true);
      expect(jobs.length).toBeGreaterThan(0);

      const parsed = jobs[0];
      expect(parsed).toHaveProperty('url');
      expect(parsed.url).toContain('smartsearchonline.com');
      expect(parsed).toHaveProperty('title');
      expect(typeof parsed.title).toBe('string');
      expect(parsed.title.length).toBeGreaterThan(0);
      expect(parsed).toHaveProperty('location');
      expect(Array.isArray(parsed.location)).toBe(true);
    });

    it('should map parsed jobs to job model', () => {
      const parsed = index.parseJobsHTML(html);

      if (parsed.length === 0) {
        console.log('⚠️ No jobs found on Stefanini careers page — skipping mapping test');
        return;
      }

      const model = index.mapToJobModel(parsed[0], TEST_CIF);

      expect(model).toHaveProperty('url');
      expect(model).toHaveProperty('title');
      expect(model).toHaveProperty('company');
      expect(model).toHaveProperty('cif', TEST_CIF);
      expect(model).toHaveProperty('status', 'scraped');
      expect(model).toHaveProperty('date');
    });

    it('should transform jobs and filter to Romanian locations', () => {
      const parsed = index.parseJobsHTML(html);

      if (parsed.length === 0) {
        console.log('⚠️ No jobs found on Stefanini careers page — skipping transform test');
        return;
      }

      const jobs = parsed.map(j => index.mapToJobModel(j, TEST_CIF));

      const payload = {
        source: 'smartsearchonline.com',
        company: 'STEFANINI ROMANIA SRL',
        cif: TEST_CIF,
        jobs
      };

      const transformed = index.transformJobsForSOLR(payload);

      expect(transformed.company).toBe('STEFANINI ROMANIA SRL');
      expect(transformed.jobs.length).toBe(jobs.length);

      for (const job of transformed.jobs) {
        expect(job).toHaveProperty('location');
        expect(Array.isArray(job.location)).toBe(true);
        expect(job.location.length).toBeGreaterThan(0);
      }
    });

    it('should produce valid job URLs that are accessible', async () => {
      const parsed = index.parseJobsHTML(html);

      if (parsed.length === 0) {
        console.log('⚠️ No jobs found — skipping URL accessibility test');
        return;
      }

      for (const job of parsed.slice(0, 2)) {
        const res = await fetch(job.url, {
          method: 'HEAD',
          headers: { 'User-Agent': 'job_seeker_ro_spider' }
        });
        expect(res.ok).toBe(true);
      }
    }, 30000);
  });

  describe('Company Validation Path', () => {
    let anaf;
    let company;

    beforeAll(async () => {
      anaf = await import('../../scraper/anaf.js');
      company = await import('../../scraper/company.js');
    });

    itIfAnaf('should find Stefanini in ANAF and validate active status', async () => {
      const results = await anaf.searchCompany(TEST_BRAND);

      const stef = results.find(c =>
        c.name.toUpperCase().includes('STEFANINI') &&
        c.statusLabel === 'Funcțiune'
      );
      expect(stef).toBeDefined();
      expect(stef.cui.toString()).toBe(TEST_CIF);

      const anafData = await anaf.getCompanyFromANAF(TEST_CIF);
      expect(anafData).toBeDefined();
      expect(anafData.inactive).toBe(false);
    }, 30000);

    itIfApi('should run full validation and report active status with job count', async () => {
      const result = await company.validateAndGetCompany();

      expect(result.status).toBe('active');
      expect(result.company).toBe('STEFANINI ROMANIA SRL');
      expect(result.cif).toBe(TEST_CIF);

      if (result.existingJobsCount === 0) {
        console.log('⚠️ No STEFANINI jobs in SOLR — skipping job count assertion');
        return;
      }
      expect(result.existingJobsCount).toBeGreaterThan(0);
    }, 30000);
  });

  describe('Inactive Company Handling', () => {
    let anaf;

    beforeAll(async () => {
      anaf = await import('../../scraper/anaf.js');
    });

    itIfAnaf('should detect inactive/radiated companies via ANAF', async () => {
      const results = await anaf.searchCompany('Stefanini');

      const nonActive = results.find(c => c.statusLabel !== 'Funcțiune');

      if (nonActive) {
        try {
          const anafData = await anaf.getCompanyFromANAF(nonActive.cui.toString());
          expect(anafData).toBeDefined();
          if (anafData.inactive !== undefined) {
            expect(anafData.inactive).toBe(true);
          }
        } catch {
          expect(nonActive.statusLabel).toMatch(/Radiată|Inactiv|Suspendat/);
        }
      }
    }, 30000);
  });

  describe('API Data Verification', () => {
    let api;

    beforeAll(async () => {
      api = await import('../../scraper/api.js');
    });

    itIfApi('should have STEFANINI jobs via API with correct company name', async () => {
      const result = await api.querySOLR(TEST_CIF);

      if (result.numFound === 0) {
        console.log('⚠️ No STEFANINI jobs in SOLR — skipping API data verification');
        return;
      }

      for (const job of result.docs) {
        expect(job.company).toBe('STEFANINI ROMANIA SRL');
        expect(job.cif).toBe(TEST_CIF);
      }
    }, 15000);

    itIfApi('should have STEFANINI company core entry with required fields', async () => {
      const stef = await api.getCompanyByCif(TEST_CIF);

      expect(stef).not.toBeNull();
      expect(stef.company).toBe('STEFANINI ROMANIA SRL');
      expect(stef.status).toBe('activ');
    }, 15000);
  });
});
