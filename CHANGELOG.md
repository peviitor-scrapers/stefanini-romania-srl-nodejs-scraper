# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-07-27

### Fixed
- Hardcoded SmartSearchOnline API base moved to `scraper/config/scraper.json`
- ANAF company cache moved from committed `scraper/anaf-cache.json` to runtime-only `tmp/company.json`
- Stale job cleanup: URLs no longer present on the website are now deleted from Solr
- `lastScraped` is no longer written back into `scraper/config/company.json`
- Root `CONTRIBUTING.md` and `SECURITY.md` moved from `ai/` to repo root

### Added
- `ai/AI-DERIVATION-GUIDE.md`, `ai/MAINTENANCE.md`, `CODE_OF_CONDUCT.md`
- `scraper/demoanaf.js`, `scraper/validate-jobs.js`
- `tests/package.json`, `tests/company.json`, consistency tests (root-files, version)
- `automation-template-sync-check.yml`, `job-deep-validate.yml` workflows

## [1.0.0] - 2026-06-22

### Added
- Initial release
- Job scraping from STEFANINI careers page (SmartSearchOnline HTML/cheerio)
- Company validation via ANAF
- Solr integration for job storage
- GitHub Actions workflows for daily scraping and testing
- Comprehensive test suite (unit, integration, E2E)
- ANAF API fallback with cached data support
- Node 24 compatibility

### Features
- Automated daily job scraping
- Company core validation and management
- Job URL validation
- Data integrity checks
- Romanian location filtering
- Work mode normalization

## License

Copyright (c) 2024-2026 BOGA SEBASTIAN-NICOLAE
Licensed under MIT License
