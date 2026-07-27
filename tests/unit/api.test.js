import { jest } from '@jest/globals';

const mockFetch = jest.fn();

jest.unstable_mockModule('node-fetch', () => ({
  default: mockFetch
}));

function makeApiJobsResponse(total, data) {
  return {
    ok: true,
    json: async () => ({ success: true, total, count: data.length, data })
  };
}

function makeApiDeleteResponse(count) {
  return {
    ok: true,
    json: async () => ({ success: true, message: 'Jobs deleted successfully', count })
  };
}

function makeApi404() {
  return {
    ok: false,
    status: 404,
    json: async () => ({ error: 'No jobs found', count: 0 })
  };
}

function makeErrorResponse(status, text) {
  return {
    ok: false,
    status,
    text: async () => text,
    json: async () => ({ error: text })
  };
}

describe('api.js', () => {
  let api;

  beforeAll(async () => {
    api = await import('../../scraper/api.js');
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('querySOLR', () => {
    it('should return normalized response with numFound and docs', async () => {
      mockFetch.mockResolvedValue(makeApiJobsResponse(2, [
        { id: 'job1', url: 'https://test.com/1', cif: '16139707' },
        { id: 'job2', url: 'https://test.com/2', cif: '16139707' }
      ]));

      const result = await api.querySOLR('16139707');

      expect(result).toHaveProperty('numFound', 2);
      expect(result).toHaveProperty('docs');
      expect(Array.isArray(result.docs)).toBe(true);
      expect(result.docs).toHaveLength(2);
    });

    it('should return empty docs when no jobs found', async () => {
      mockFetch.mockResolvedValue(makeApiJobsResponse(0, []));

      const result = await api.querySOLR('99999999');

      expect(result.numFound).toBe(0);
      expect(result.docs).toEqual([]);
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(500, 'Internal Server Error'));

      await expect(api.querySOLR('16139707')).rejects.toThrow('API jobs query error: 500');
    });

    it('should call API endpoint with correct URL', async () => {
      mockFetch.mockResolvedValue(makeApiJobsResponse(0, []));

      await api.querySOLR('16139707');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.peviitor.ro/v1/scraper/jobs/?cif=16139707&rows=500',
        expect.objectContaining({
          headers: { 'User-Agent': 'job_seeker_ro_spider' }
        })
      );
    });
  });

  describe('getCompanyByCif', () => {
    it('should return company data via API', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, total: 1, count: 1, data: [
          { id: '16139707', company: 'STEFANINI ROMANIA SRL', status: 'activ' }
        ] })
      });

      const result = await api.getCompanyByCif('16139707');

      expect(result).toHaveProperty('id', '16139707');
      expect(result.status).toBe('activ');
    });

    it('should return null when company not found', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, total: 0, count: 0, data: [] })
      });

      const result = await api.getCompanyByCif('00000000');

      expect(result).toBeNull();
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(401, 'Unauthorized'));

      await expect(api.getCompanyByCif('16139707')).rejects.toThrow('API company search error: 401');
    });
  });

  describe('searchCompanyByName', () => {
    it('should return matching companies via API', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, total: 2, count: 2, data: [
          { id: '16139707', company: 'STEFANINI ROMANIA SRL', brand: 'STEFANINI' },
          { id: '12345678', company: 'STEFANINI DOO', brand: 'STEFANINI' }
        ] })
      });

      const results = await api.searchCompanyByName('stefanini');

      expect(results).toHaveLength(2);
      expect(results[0].company).toContain('STEFANINI');
    });

    it('should return empty array when no matches', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, total: 0, count: 0, data: [] })
      });

      const results = await api.searchCompanyByName('zzzzz');

      expect(results).toEqual([]);
    });
  });

  describe('upsertCompany', () => {
    it('should upsert company via API', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, id: '16139707', message: 'upserted' })
      });

      await expect(api.upsertCompany({
        id: '16139707',
        company: 'STEFANINI ROMANIA SRL',
        brand: 'STEFANINI'
      })).resolves.not.toThrow();
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(500, 'Internal Server Error'));

      await expect(api.upsertCompany({ id: '16139707', company: 'TEST' })).rejects.toThrow('API company upsert error: 500');
    });
  });

  describe('upsertJobs', () => {
    it('should accept array of jobs', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: 'Jobs successfully uploaded to Solr', count: 1 })
      });

      const testJob = {
        url: 'https://test.com/job1',
        title: 'Test Job',
        company: 'TEST COMPANY',
        cif: '12345678',
        status: 'scraped'
      };

      await expect(api.upsertJobs([testJob])).resolves.not.toThrow();
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(400, 'Bad Request'));

      await expect(api.upsertJobs([{ url: 'https://test.com/bad', title: 'Bad', company: 'X' }])).rejects.toThrow('API jobs upload error: 400');
    });
  });

  describe('deleteJobByUrl', () => {
    it('should delete a job by URL via API', async () => {
      mockFetch.mockResolvedValue(makeApiDeleteResponse(1));

      await expect(api.deleteJobByUrl('https://test.com/old-job')).resolves.not.toThrow();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.peviitor.ro/v1/scraper/jobs/delete/',
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({ url: 'https://test.com/old-job' })
        })
      );
    });

    it('should handle 404 gracefully (no job found)', async () => {
      mockFetch.mockResolvedValue(makeApi404());

      await expect(api.deleteJobByUrl('https://test.com/nonexistent')).resolves.not.toThrow();
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(500, 'Error'));

      await expect(api.deleteJobByUrl('https://test.com/bad')).rejects.toThrow('API jobs delete error: 500');
    });
  });

  describe('deleteJobsByCIF', () => {
    it('should delete all jobs for a CIF via API', async () => {
      mockFetch.mockResolvedValue(makeApiDeleteResponse(32));

      await expect(api.deleteJobsByCIF('16139707')).resolves.not.toThrow();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.peviitor.ro/v1/scraper/jobs/delete/',
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({ cif: '16139707' })
        })
      );
    });

    it('should handle 404 gracefully (no jobs found)', async () => {
      mockFetch.mockResolvedValue(makeApi404());

      await expect(api.deleteJobsByCIF('99999999')).resolves.not.toThrow();
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(500, 'Error'));

      await expect(api.deleteJobsByCIF('16139707')).rejects.toThrow('API jobs delete error: 500');
    });
  });

  describe('Data Integrity', () => {
    it('should not have duplicate URLs for same CIF', async () => {
      mockFetch.mockResolvedValue(makeApiJobsResponse(2, [
        { url: 'https://test.com/job1', title: 'Job 1', cif: '16139707' },
        { url: 'https://test.com/job2', title: 'Job 2', cif: '16139707' }
      ]));

      const result = await api.querySOLR('16139707');
      const urls = result.docs.map(j => j.url);
      const uniqueUrls = new Set(urls);

      expect(uniqueUrls.size).toBe(result.numFound);
    });

    it('should have valid CIF format for all jobs', async () => {
      mockFetch.mockResolvedValue(makeApiJobsResponse(2, [
        { url: 'https://test.com/1', title: 'Job 1', cif: '16139707' },
        { url: 'https://test.com/2', title: 'Job 2', cif: '12345678' }
      ]));

      const result = await api.querySOLR('16139707');

      for (const job of result.docs) {
        expect(job.cif).toMatch(/^\d{8}$/);
      }
    });

    it('should detect invalid CIF format', async () => {
      mockFetch.mockResolvedValue(makeApiJobsResponse(1, [
        { url: 'https://test.com/1', title: 'Job 1', cif: 'abc' }
      ]));

      const result = await api.querySOLR('abc');

      for (const job of result.docs) {
        expect(job.cif).not.toMatch(/^\d{8}$/);
      }
    });

    it('should have valid status values', async () => {
      const validStatuses = ['scraped', 'tested', 'verified', 'published'];

      mockFetch.mockResolvedValue(makeApiJobsResponse(3, [
        { url: 'https://test.com/1', title: 'Job 1', cif: '16139707', status: 'scraped' },
        { url: 'https://test.com/2', title: 'Job 2', cif: '16139707', status: 'verified' },
        { url: 'https://test.com/3', title: 'Job 3', cif: '16139707', status: 'published' }
      ]));

      const result = await api.querySOLR('16139707');

      for (const job of result.docs) {
        expect(validStatuses).toContain(job.status);
      }
    });
  });
});
