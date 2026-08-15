import { jest } from '@jest/globals';
import fs from 'fs';

const mockFetch = jest.fn();

jest.unstable_mockModule('node-fetch', () => ({
  default: mockFetch
}));

function anafCompanyResponse(data) {
  return {
    ok: true,
    json: async () => ({ data, success: true })
  };
}

function peviitorResponse(data) {
  return {
    ok: true,
    json: async () => ({ success: true, data })
  };
}

function apiJobsResponse(total, data) {
  return {
    ok: true,
    json: async () => ({ success: true, total, count: data.length, data })
  };
}

const STEFANINI_ANAF_RECORD = {
  cui: 16139707,
  name: 'STEFANINI ROMANIA SRL',
  address: 'STR. DANIEL DANIELOPOL, 2, Bucureşti Sectorul 1, Bucureşti',
  caenCode: '6201',
  inactive: false,
  vatRegistered: true,
  eFacturaRegistered: false,
  headquartersAddress: { locality: 'Bucureşti Sectorul 1' }
};

describe('company.js', () => {
  let company;

  beforeAll(async () => {
    company = await import('../../scraper/company.js');
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('getCompanyData', () => {
    it('should return company data from config (cached)', async () => {
      const result = await company.getCompanyData();

      expect(result).toHaveProperty('company', 'STEFANINI ROMANIA SRL');
      expect(result).toHaveProperty('cif', '16139707');
      expect(result).toHaveProperty('active', true);
    });
  });

  describe('validateAndGetCompany', () => {
    it('should return company data with status active', async () => {
      mockFetch
        .mockResolvedValueOnce(anafCompanyResponse(STEFANINI_ANAF_RECORD))
        .mockResolvedValueOnce(apiJobsResponse(5, [
          { url: 'https://test.com/1', title: 'Job 1' },
          { url: 'https://test.com/2', title: 'Job 2' }
        ]))
        .mockResolvedValueOnce(peviitorResponse([{ company: 'STEFANINI ROMANIA SRL' }]));

      const result = await company.validateAndGetCompany();

      expect(result).toHaveProperty('status', 'active');
      expect(result).toHaveProperty('company', 'STEFANINI ROMANIA SRL');
      expect(result).toHaveProperty('cif', '16139707');
      expect(result).toHaveProperty('existingJobsCount');
      expect(typeof result.existingJobsCount).toBe('number');
    });
  });
});
