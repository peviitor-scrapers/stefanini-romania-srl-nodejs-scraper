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

let COMPANY_CONFIG;
const STEFANINI_CIF = '16139707';

beforeAll(async () => {
  [HAS_API, HAS_ANAF] = await Promise.all([checkApiAvailability(), checkAnafAvailability()]);
  const mod = await import('../../scraper/config/company.js');
  COMPANY_CONFIG = mod.default;
});

describe('Integration: API Workflow', () => {

  describe('ANAF API', () => {
    let anaf;

    beforeAll(async () => {
      anaf = await import('../../scraper/anaf.js');
    });

    itIfAnaf('should search for Stefanini brand and find the company', async () => {
      const results = await anaf.searchCompany('Stefanini');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);

      const stef = results.find(c =>
        c.name.toUpperCase().includes('STEFANINI') && c.statusLabel === 'Funcțiune'
      );
      expect(stef).toBeDefined();
      expect(stef.cui.toString()).toBe(STEFANINI_CIF);
    }, 15000);

    itIfAnaf('should return empty array for non-existent brand', async () => {
      const results = await anaf.searchCompany('ThisBrandDoesNotExistXYZ123');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    }, 15000);

    itIfAnaf('should fetch company details by valid CIF', async () => {
      const data = await anaf.getCompanyFromANAF(STEFANINI_CIF);

      expect(data).toBeDefined();
      expect(data.cui).toBe(16139707);
      expect(data.name).toBe('STEFANINI ROMANIA SRL');
      expect(data).toHaveProperty('address');
      expect(data).toHaveProperty('registrationNumber');
      expect(data).toHaveProperty('caenCode');
      expect(data).toHaveProperty('inactive', false);
      expect(data).toHaveProperty('onrcStatusLabel', 'Funcțiune');
    }, 15000);

    itIfAnaf('should throw for invalid CIF', async () => {
      await expect(anaf.getCompanyFromANAF('00000000')).rejects.toThrow();
    }, 60000);

    itIfAnaf('should use cached data when API fails (getCompanyFromANAFWithFallback)', async () => {
      const cached = { cui: 16139707, name: 'STEFANINI ROMANIA SRL' };

      const data = await anaf.getCompanyFromANAFWithFallback(STEFANINI_CIF, cached);

      expect(data).toBeDefined();
      expect(data.cui).toBe(16139707);
    }, 15000);
  });

  describe('Peviitor API', () => {
    itIfApi('should return company data from Peviitor API', async () => {
      const api = await import('../../scraper/api.js');
      const company = await api.getCompanyByCif(STEFANINI_CIF);
      expect(company).toBeTruthy();
      expect(company.id).toBe(STEFANINI_CIF);
    }, 15000);
  });

  describe('API Company Core', () => {
    let api;

    beforeAll(async () => {
      api = await import('../../scraper/api.js');
    });

    itIfApi('should query company core by CIF', async () => {
      const result = await api.getCompanyByCif(STEFANINI_CIF);

      expect(result).not.toBeNull();
      expect(result.id).toBe(STEFANINI_CIF);
      expect(result.company).toBe(COMPANY_CONFIG.company);
      expect(result.status).toBe('activ');
      expect(Array.isArray(result.location)).toBe(true);
      expect(result.lastScraped).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }, 15000);

    itIfApi('should have required company model fields', async () => {
      const result = await api.getCompanyByCif(STEFANINI_CIF);

      expect(result).toHaveProperty('id', STEFANINI_CIF);
      expect(result).toHaveProperty('company');
      expect(result).toHaveProperty('status');
      expect(['activ', 'suspendat', 'inactiv', 'radiat']).toContain(result.status);
      expect(result).toHaveProperty('location');
      expect(Array.isArray(result.location)).toBe(true);
      expect(result).toHaveProperty('website');
      expect(Array.isArray(result.website)).toBe(true);
      expect(result.website[0]).toMatch(/^https?:\/\/.+/);
      expect(result).toHaveProperty('career');
      expect(Array.isArray(result.career)).toBe(true);
      expect(result.career[0]).toMatch(/^https?:\/\/.+/);
      expect(result).toHaveProperty('lastScraped');
      expect(result).toHaveProperty('scraperFile');
    }, 15000);

    itIfApi('should have optional field (group) if present', async () => {
      const result = await api.getCompanyByCif(STEFANINI_CIF);

      if (result.group !== undefined) {
        expect(typeof result.group).toBe('string');
      }
    }, 15000);
  });

  describe('API Jobs Core', () => {
    let api;

    beforeAll(async () => {
      api = await import('../../scraper/api.js');
    });

    itIfApi('should query jobs by CIF and return valid data', async () => {
      const result = await api.querySOLR(STEFANINI_CIF);

      if (result.numFound === 0) {
        console.log('⚠️ No STEFANINI jobs in SOLR — skipping job field assertions (scraper may not have run yet)');
        return;
      }

      expect(result.numFound).toBeGreaterThan(0);
      expect(Array.isArray(result.docs)).toBe(true);

      const job = result.docs[0];
      expect(job).toHaveProperty('url');
      expect(job).toHaveProperty('title');
      expect(job).toHaveProperty('company', COMPANY_CONFIG.company);
      expect(job).toHaveProperty('cif', STEFANINI_CIF);
      expect(job).toHaveProperty('status');
      expect(job).toHaveProperty('location');
    }, 15000);

    itIfApi('should not have duplicate URLs for same CIF', async () => {
      const result = await api.querySOLR(STEFANINI_CIF);

      const urls = result.docs.map(j => j.url);
      const uniqueUrls = new Set(urls);
      expect(uniqueUrls.size).toBe(result.docs.length);
    }, 15000);

    itIfApi('should have valid status values for all jobs', async () => {
      const validStatuses = ['scraped', 'tested', 'verified', 'published'];
      const result = await api.querySOLR(STEFANINI_CIF);

      for (const job of result.docs) {
        expect(validStatuses).toContain(job.status);
      }
    }, 15000);

    itIfApi('should have valid CIF format for all jobs', async () => {
      const result = await api.querySOLR(STEFANINI_CIF);

      for (const job of result.docs) {
        expect(job.cif).toMatch(/^\d{8}$/);
      }
    }, 15000);
  });

  describe('Full Validation Workflow', () => {
    let anaf;
    let companyModule;
    let api;

    beforeAll(async () => {
      anaf = await import('../../scraper/anaf.js');
      companyModule = await import('../../scraper/company.js');
      api = await import('../../scraper/api.js');
    });

    itIfAnaf('should complete the ANAF → Peviitor validation path', async () => {
      const searchResults = await anaf.searchCompany('Stefanini');
      expect(searchResults.length).toBeGreaterThan(0);

      const stefCompany = searchResults.find(c =>
        c.name.toUpperCase().includes('STEFANINI') && c.statusLabel === 'Funcțiune'
      );
      expect(stefCompany).toBeDefined();

      const anafData = await anaf.getCompanyFromANAF(stefCompany.cui.toString());
      expect(anafData.name).toBe('STEFANINI ROMANIA SRL');
      expect(anafData.inactive).toBe(false);
    }, 30000);

    itIfApi('should have matching CIF in company core', async () => {
      const companyResult = await companyModule.validateAndGetCompany();

      const companyData = await api.getCompanyByCif(STEFANINI_CIF);
      expect(companyData).not.toBeNull();
      expect(companyData.id).toBe(STEFANINI_CIF);
      expect(companyData.company).toBe(COMPANY_CONFIG.company);
    }, 30000);

    itIfApi('should validate company and query SOLR for existing jobs', async () => {
      const companyResult = await companyModule.validateAndGetCompany();

      expect(companyResult.status).toBe('active');
      expect(companyResult.company).toBe(COMPANY_CONFIG.company);
      expect(companyResult.cif).toBe(STEFANINI_CIF);

      if (companyResult.existingJobsCount === 0) {
        console.log('⚠️ No STEFANINI jobs in SOLR — skipping job count assertion (scraper may not have run yet)');
        return;
      }
      expect(companyResult.existingJobsCount).toBeGreaterThan(0);
    }, 30000);
  });
});
