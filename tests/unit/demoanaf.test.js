import { jest } from '@jest/globals';

const mockFetch = jest.fn();

jest.unstable_mockModule('node-fetch', () => ({
  default: mockFetch
}));

function anafSearchResponse(results) {
  return {
    ok: true,
    json: async () => ({ data: results, success: true })
  };
}

function anafCompanyResponse(data) {
  return {
    ok: true,
    json: async () => ({ data, success: true })
  };
}

function errorResponse(status) {
  return {
    ok: false,
    status,
    text: async () => 'Error'
  };
}

function cuiscanCompanyResponse(data) {
  return {
    ok: true,
    json: async () => data
  };
}

const STEFANINI_ANAF_RECORD = {
  cui: 16139707,
  name: 'STEFANINI ROMANIA SRL',
  address: 'STR. DANIEL DANIELOPOL, 2, Bucureşti Sectorul 1, Bucureşti',
  caenCode: '6201',
  inactive: false,
  registrationNumber: 'J40/12345/2006',
  vatRegistered: true,
  onrcStatusLabel: 'Funcțiune',
  legalForm: 'SRL'
};

const CUISCAN_RECORD = {
  cui: 16139707,
  denumire: 'STEFANINI ROMANIA SRL',
  adresa: 'STR. DANIEL DANIELOPOL, 2, Bucureşti Sectorul 1, Bucureşti',
  codCaen: '6201',
  activ: true,
  nrRegCom: 'J40/12345/2006',
  platitorTVA: true,
  stareInregistrare: 'INREGISTRAT din data 15.03.2006',
  adresaSediu: { strada: 'Str. Daniel Danielopol', numar: '2', localitate: 'Sector 1 Mun. Bucureşti', judet: 'MUNICIPIUL BUCUREŞTI', codPostal: '011171' }
};

const CACHED_DATA = {
  cui: 16139707,
  name: 'STEFANINI ROMANIA SRL',
  address: 'STR. DANIEL DANIELOPOL, NR.2, SECTOR 1, BUCURESTI',
  registrationNumber: 'J40/12345/2006',
  caenCode: '6201',
  inactive: false,
  onrcStatusLabel: 'Funcțiune'
};

describe('scraper/anaf.js', () => {
  let anaf;

  beforeAll(async () => {
    anaf = await import('../../scraper/anaf.js');
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('searchCompany', () => {
    it('should return array of companies for valid brand', async () => {
      mockFetch.mockResolvedValue(anafSearchResponse([
        { cui: 16139707, name: 'STEFANINI ROMANIA SRL', statusLabel: 'Funcțiune' }
      ]));

      const results = await anaf.searchCompany('Stefanini');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('cui');
      expect(results[0]).toHaveProperty('name');
    });

    it('should return empty array for non-existent brand', async () => {
      mockFetch.mockResolvedValue(anafSearchResponse([]));

      const results = await anaf.searchCompany('NonExistentBrandXYZ123');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    it('should include statusLabel in results', async () => {
      mockFetch.mockResolvedValue(anafSearchResponse([
        { cui: 16139707, name: 'STEFANINI ROMANIA SRL', statusLabel: 'Funcțiune' }
      ]));

      const results = await anaf.searchCompany('Stefanini');

      expect(results[0]).toHaveProperty('statusLabel', 'Funcțiune');
    });

    it('should fallback to CUIFirma when ANAF search fails', async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse(500))
        .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ cui: 16139707, name: 'STEFANINI ROMANIA SRL', is_active: true }] }) });

      const results = await anaf.searchCompany('Stefanini');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].cui).toBe('16139707');
    });

    it('should encode brand name in URL', async () => {
      let capturedUrl;
      mockFetch.mockImplementation((url) => {
        capturedUrl = url;
        return Promise.resolve(anafSearchResponse([]));
      });

      await anaf.searchCompany('Stefanini SRL');
      expect(capturedUrl).toContain(encodeURIComponent('Stefanini SRL'));
    });
  });

  describe('getCompanyFromANAF', () => {
    it('should return company data for valid CIF', async () => {
      mockFetch.mockResolvedValue(anafCompanyResponse(STEFANINI_ANAF_RECORD));

      const data = await anaf.getCompanyFromANAF('16139707');

      expect(data).toBeDefined();
      expect(data.cui).toBe(16139707);
      expect(data.name).toBe('STEFANINI ROMANIA SRL');
      expect(data).toHaveProperty('address');
      expect(data).toHaveProperty('registrationNumber');
    });

    it('should fallback to CUIScan when ANAF fails', async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse(500))
        .mockResolvedValueOnce(cuiscanCompanyResponse(CUISCAN_RECORD));

      const data = await anaf.getCompanyFromANAF('16139707');

      expect(data).toBeDefined();
      expect(data.cui).toBe(16139707);
      expect(data.name).toBe('STEFANINI ROMANIA SRL');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw when both ANAF and CUIScan fail', async () => {
      mockFetch.mockResolvedValue(errorResponse(500));

      await expect(anaf.getCompanyFromANAF('16139707')).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle API-level error response', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: false, error: { message: 'Company not found' } })
        })
        .mockResolvedValueOnce(errorResponse(500));

      await expect(anaf.getCompanyFromANAF('00000000')).rejects.toThrow();
    });

    it('should return null when data is null', async () => {
      mockFetch.mockResolvedValue(anafCompanyResponse(null));

      const data = await anaf.getCompanyFromANAF('16139707');
      expect(data).toBeNull();
    });
  });

  describe('getCompanyFromANAFWithFallback', () => {
    it('should return fresh data when API works', async () => {
      mockFetch.mockResolvedValue(anafCompanyResponse(STEFANINI_ANAF_RECORD));

      const data = await anaf.getCompanyFromANAFWithFallback('16139707');

      expect(data.name).toBe('STEFANINI ROMANIA SRL');
    });

    it('should use cached data when API fails', async () => {
      mockFetch.mockResolvedValue(errorResponse(500));

      const data = await anaf.getCompanyFromANAFWithFallback('16139707', CACHED_DATA);

      expect(data).toEqual(CACHED_DATA);
    });

    it('should throw when API fails and no cache available', async () => {
      mockFetch.mockResolvedValue(errorResponse(500));

      await expect(anaf.getCompanyFromANAFWithFallback('16139707')).rejects.toThrow();
    });
  });
});
