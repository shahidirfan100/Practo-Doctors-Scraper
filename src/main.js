import { Actor, log } from 'apify';
import { CheerioCrawler } from 'crawlee';

/**
 * Practo Doctors Scraper (production-oriented, stealthy, fast)
 *
 * Strategy (in priority order):
 * 1) Use Practo search endpoint (HTTP + HTML) and extract doctors from JSON-LD + HTML cards.
 * 2) Optionally enrich each doctor from the profile page for `description` + `profileImage`.
 *
 * Notes:
 * - Detail/profile pages can 403 depending on proxy geo/quality. This implementation treats details as best-effort:
 *   it will not stall the run; it will fall back to listing data if the profile blocks/timeouts.
 * - If you need highest success on detail pages, set Apify Proxy country to `IN` in proxy settings.
 */

await Actor.main(async () => {
    const input = (await Actor.getInput()) || {};
    const {
        speciality = 'dermatologist',
        city = 'bangalore',
        locality = '',
        results_wanted: resultsWantedRaw = 50,
        max_pages: maxPagesRaw = 10,
        startUrl,
        startUrls,
        url,
        proxyConfiguration: proxyConfigurationInput,
        minExperience = 0,
        minRating = 0,
        fetchDetails = true,
        // Keep speed + stealth balanced. Detail pages are the most sensitive.
        maxConcurrency: maxConcurrencyRaw = 10,
    } = input;

    const resultsWanted = Number.isFinite(+resultsWantedRaw) && +resultsWantedRaw > 0 ? +resultsWantedRaw : 50;
    const maxPages = Number.isFinite(+maxPagesRaw) && +maxPagesRaw > 0 ? +maxPagesRaw : 10;
    const maxConcurrency = Number.isFinite(+maxConcurrencyRaw) && +maxConcurrencyRaw > 0
        ? Math.min(20, +maxConcurrencyRaw)
        : 10;

    const clean = (text = '') => String(text).replace(/\s+/g, ' ').trim();
    const numberFromText = (text = '', fallback = 0) => {
        const match = clean(text).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
        return match ? Number(match[1]) : fallback;
    };
    const toAbsoluteUrl = (value, base = 'https://www.practo.com') => {
        if (!value) return null;
        try {
            return value.startsWith('http') ? value : new URL(value, base).toString();
        } catch {
            return null;
        }
    };
    const toDoctorKey = (value) => {
        const abs = toAbsoluteUrl(value);
        if (!abs) return null;
        try {
            const u = new URL(abs);
            return `${u.origin}${u.pathname}`;
        } catch {
            return null;
        }
    };

    const normalizeUrlLike = (value) => {
        if (!value) return null;
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'object' && typeof value.url === 'string') return value.url.trim();
        return null;
    };

    // Minimal, consistent "browser-like" headers.
    const baseHeaders = {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'upgrade-insecure-requests': '1',
    };

    // Default to IN for better Practo success (especially profile pages). Users can override in proxy editor.
    const proxyConfiguration = await Actor.createProxyConfiguration(
        proxyConfigurationInput || { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'], apifyProxyCountry: 'IN' },
    );

    const applyFilters = (doctors) => doctors.filter((doc) => {
        const experienceOk = (doc.experience ?? 0) >= minExperience;
        const ratingOk = !minRating || (doc.rating ?? 0) >= minRating;
        return experienceOk && ratingOk;
    });

    /**
     * Practo "search" endpoint that returns the listing HTML.
     * We use this as our "JSON API first" approach because it is stable and supports paging.
     */
    const buildSearchUrl = ({ cityName, specialityName, page }) => {
        const q = encodeURIComponent(`[{"word":"${specialityName}","autocompleted":true,"category":"subspeciality"}]`);
        const cityParam = encodeURIComponent(cityName);
        const pageParam = encodeURIComponent(String(page));
        return `https://www.practo.com/search/doctors?results_type=doctor&q=${q}&city=${cityParam}&page=${pageParam}`;
    };

    // Parse doctors from JSON-LD blocks in listing/profile pages.
    const parseJsonLdDoctors = ($) => {
        const doctors = [];
        $('script[type="application/ld+json"]').each((_, el) => {
            const raw = $(el).contents().text();
            if (!raw) return;
            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch {
                return;
            }
            const items = Array.isArray(parsed) ? parsed : [parsed];
            for (const item of items) {
                const type = item['@type'];
                const typeList = Array.isArray(type) ? type.map(String) : [String(type || '')];
                const isDoctor = typeList.some((t) => {
                    const normalized = t.toLowerCase();
                    return normalized === 'physician' || normalized === 'person';
                });
                if (!isDoctor) continue;

                doctors.push({
                    name: item.name || null,
                    speciality: item.medicalSpecialty || item.specialty || null,
                    description: item.description || null,
                    consultationFee: item.priceRange ? Number(item.priceRange) : null,
                    location: item.address?.addressLocality || item.address?.streetAddress || null,
                    city: item.address?.addressRegion || null,
                    url: toAbsoluteUrl(item.url),
                    profileImage: toAbsoluteUrl(item.image || (Array.isArray(item.photo) ? item.photo[0]?.url : null)),
                    rating: item.aggregateRating?.ratingValue ? Number(item.aggregateRating.ratingValue) : null,
                    source: 'json-ld',
                });
            }
        });
        return doctors;
    };

    // Parse doctors from listing HTML cards (experience, clinic, patient stories, etc).
    const parseHtmlDoctors = ($) => {
        const doctors = [];
        const cards = $('[data-qa-id="doctor_card"], .listing-doctor-card, .doctor-card');
        cards.each((_, card) => {
            const $card = $(card);
            const name = clean($card.find('[data-qa-id="doctor_name"], .doctor-name').first().text());
            const urlPath = $card.find('a[href*="/doctor/"]').first().attr('href');
            const urlAbs = toAbsoluteUrl(urlPath);
            const specialityText = clean(
                $card.find('[data-qa-id="doctor_name"]').closest('.info-section').find('.u-grey_3-text span').first().text()
                || $card.find('[class*="speciality"]').first().text(),
            );
            const experienceText = clean($card.find('[data-qa-id="doctor_experience"]').text());
            const experience = experienceText ? numberFromText(experienceText, 0) : numberFromText($card.text(), 0);
            const location = clean($card.find('[data-qa-id="practice_locality"]').text());
            const cityFromCard = clean($card.find('[data-qa-id="practice_city"]').text());
            const fee = numberFromText($card.find('[data-qa-id="consultation_fee"]').text(), null);
            const rating = numberFromText($card.find('[data-qa-id="doctor_recommendation"]').text(), null);
            const patientStories = numberFromText($card.find('[data-qa-id="total_feedback"]').text(), 0);
            const clinicName = clean($card.find('[data-qa-id="doctor_clinic_name"]').text());

            if (!name && !urlAbs) return;
            doctors.push({
                name: name || null,
                speciality: specialityText || null,
                experience,
                location: location || null,
                city: cityFromCard || null,
                consultationFee: fee,
                rating,
                patientStories,
                clinicName: clinicName || null,
                url: urlAbs,
                source: 'html',
            });
        });
        return doctors;
    };

    // Merge two lists, preferring primary fields (primary overwrites secondary).
    const mergeDoctors = (primary = [], secondary = []) => {
        const map = new Map();
        for (const doc of secondary) {
            const key = doc.url || doc.name;
            if (!key) continue;
            map.set(key, doc);
        }
        for (const doc of primary) {
            const key = doc.url || doc.name;
            if (!key) continue;
            const existing = map.get(key) || {};
            map.set(key, { ...existing, ...doc });
        }
        return Array.from(map.values());
    };

    // Extract profile fields via selectors (requested by user).
    const parseDoctorDetail = ($, requestUrl) => {
        const description = clean($('p.c-profile__description').first().text());
        const profileImage = toAbsoluteUrl(
            $('img.c-profile__image').attr('src') || $('img.c-profile__image').attr('data-src'),
        );

        // Fallback: sometimes JSON-LD on profile contains image/description.
        if (!description || !profileImage) {
            const jsonDoctors = parseJsonLdDoctors($);
            const best = jsonDoctors.find((d) => d.url && toDoctorKey(d.url) === toDoctorKey(requestUrl)) || jsonDoctors[0];
            return {
                description: description || best?.description || null,
                profileImage: profileImage || best?.profileImage || null,
            };
        }

        return { description, profileImage };
    };

    const starting = [];
    if (Array.isArray(startUrls) && startUrls.length) starting.push(...startUrls.map(normalizeUrlLike).filter(Boolean));
    if (startUrl) starting.push(normalizeUrlLike(startUrl));
    if (url) starting.push(normalizeUrlLike(url));
    if (!starting.length) starting.push(buildSearchUrl({ cityName: city, specialityName: speciality, page: 1 }));

    // When profile pages block, we keep base records here and flush at the end.
    const pendingByDoctorKey = new Map();
    const pushedKeys = new Set();

    let saved = 0;
    let listPagesEnqueued = 0;
    let detailPagesEnqueued = 0;
    let detailPagesBlocked = 0;
    let stopRequested = false;
    let crawler;

    // Prevent queue explosion (helps stealth and keeps LIST pages progressing).
    const detailBacklogLimit = Math.max(20, maxConcurrency * 3);

    const pushDoctor = async (doctor, doctorKey) => {
        if (saved >= resultsWanted) return;
        if (!doctorKey || pushedKeys.has(doctorKey)) return;
        await Actor.pushData(doctor);
        pushedKeys.add(doctorKey);
        saved += 1;
        if (saved % 10 === 0 || saved === resultsWanted) {
            log.info(`Saved ${saved}/${resultsWanted}`);
        }
        if (saved >= resultsWanted && !stopRequested) {
            stopRequested = true;
            log.info('Reached results_wanted, stopping crawler early to avoid waiting on remaining detail timeouts.');
            try {
                crawler?.autoscaledPool?.abort();
            } catch (err) {
                log.debug(`Failed to abort autoscaled pool: ${err.message}`);
            }
        }
    };

    log.info(`Mode=${fetchDetails ? 'LIST+DETAIL(best-effort)' : 'LIST-only'} results=${resultsWanted} maxPages=${maxPages} concurrency=${maxConcurrency}`);

    crawler = new CheerioCrawler({
        proxyConfiguration,
        useSessionPool: true,
        persistCookiesPerSession: true,
        maxConcurrency,
        navigationTimeoutSecs: 25,
        // Small delay reduces 403s significantly without killing throughput at concurrency ~10.
        sameDomainDelaySecs: 0.2,
        autoscaledPoolOptions: {
            desiredConcurrency: maxConcurrency,
            minConcurrency: Math.min(3, maxConcurrency),
        },
        maxRequestRetries: 3,
        requestHandlerTimeoutSecs: 60,
        // Make headers look like a normal navigation from a referrer.
        preNavigationHooks: [
            async ({ request, session }) => {
                const referer = request.userData?.referer || 'https://www.google.com/';
                request.headers = {
                    ...baseHeaders,
                    referer,
                };

                // If a request is already failing multiple times, rotate session sooner.
                if (request.retryCount >= 2) session?.markBad();
            },
        ],
        failedRequestHandler: async ({ request }, error) => {
            const label = request.userData?.label || 'LIST';
            if (label === 'DETAIL') {
                const doctorKey = request.userData?.doctorKey;
                const base = doctorKey ? pendingByDoctorKey.get(doctorKey) : null;
                if (doctorKey && base) {
                    pendingByDoctorKey.delete(doctorKey);
                    await pushDoctor(base, doctorKey);
                }
                log.debug(`Detail failed: ${request.url} (${error?.message || error})`);
                return;
            }
            log.warning(`Request failed: ${request.url} (${error?.message || error})`);
        },
        requestHandler: async ({ request, $, response, session }) => {
            if (stopRequested) return;

            const label = request.userData?.label || 'LIST';
            const page = request.userData?.page ?? 1;

            // LIST pages should be retried on blocks. DETAIL pages should degrade quickly.
            if (response?.statusCode === 403 || response?.statusCode === 429) {
                session?.markBad();
                if (label === 'DETAIL') {
                    detailPagesBlocked += 1;
                    const doctorKey = request.userData?.doctorKey;
                    const base = doctorKey ? pendingByDoctorKey.get(doctorKey) : null;
                    if (doctorKey && base) {
                        pendingByDoctorKey.delete(doctorKey);
                        await pushDoctor(base, doctorKey);
                    }
                    return;
                }
                throw new Error(`Blocked (HTTP ${response.statusCode})`);
            }

            if (!$) {
                if (label === 'DETAIL') {
                    const doctorKey = request.userData?.doctorKey;
                    const base = doctorKey ? pendingByDoctorKey.get(doctorKey) : null;
                    if (doctorKey && base) {
                        pendingByDoctorKey.delete(doctorKey);
                        await pushDoctor(base, doctorKey);
                    }
                    return;
                }
                throw new Error('Missing HTML');
            }

            if (label === 'DETAIL') {
                const doctorKey = request.userData?.doctorKey || toDoctorKey(request.url) || request.url;
                const base = pendingByDoctorKey.get(doctorKey) || { url: request.url, city, speciality };

                pendingByDoctorKey.delete(doctorKey);
                const detail = parseDoctorDetail($, request.url);
                await pushDoctor({ ...base, ...detail }, doctorKey);
                return;
            }

            // LIST page: extract doctors (JSON-LD first, HTML fallback).
            const jsonDocs = parseJsonLdDoctors($);
            const htmlDocs = parseHtmlDoctors($);
            const merged = mergeDoctors(jsonDocs, htmlDocs).map((doc) => ({
                ...doc,
                city: doc.city || city,
                speciality: doc.speciality || speciality,
            }));

            const filtered = applyFilters(merged);
            if (!filtered.length) {
                log.info(`No doctors found on LIST page ${page}: ${request.url}`);
            }

            for (const doc of filtered) {
                if (saved >= resultsWanted) break;
                const doctorKey = toDoctorKey(doc.url) || doc.url || doc.name;
                if (!doctorKey || pushedKeys.has(doctorKey)) continue;

                // If detail enrichment is off (or backlog is too big), push listing data immediately.
                if (!fetchDetails || pendingByDoctorKey.size >= detailBacklogLimit || !doc.url) {
                    await pushDoctor(doc, doctorKey);
                    continue;
                }

                // If we already have desired fields from listing, no need to fetch profile.
                if (doc.description && doc.profileImage) {
                    await pushDoctor(doc, doctorKey);
                    continue;
                }

                // Enqueue profile page as best-effort. If it blocks, we will fall back to listing data.
                pendingByDoctorKey.set(doctorKey, doc);
                detailPagesEnqueued += 1;
                await crawler.addRequests([{
                    url: doc.url,
                    uniqueKey: `DETAIL:${doctorKey}`,
                    // Do not waste time on repeated 403s for profiles.
                    maxRetries: 0,
                    userData: { label: 'DETAIL', doctorKey, referer: request.url },
                }]);
            }

            // Deterministic paging: enqueue next page URL (search endpoint).
            if (saved < resultsWanted && page < maxPages) {
                const nextUrl = buildSearchUrl({ cityName: city, specialityName: speciality, page: page + 1 });
                listPagesEnqueued += 1;
                await crawler.addRequests([{
                    url: nextUrl,
                    uniqueKey: `LIST:${city}:${speciality}:${page + 1}`,
                    userData: { label: 'LIST', page: page + 1, referer: request.url },
                }]);
            }
        },
    });

    // If users provide direct listing URLs, crawl them as LIST pages too.
    // This keeps compatibility with existing inputs without relying on parsing the URL for parameters.
    const initialRequests = [];
    for (const u of starting.filter(Boolean)) {
        const isSearch = u.includes('/search/doctors');
        initialRequests.push({
            url: u,
            uniqueKey: isSearch ? `LIST:seed:${u}` : `LIST:seed:${toAbsoluteUrl(u)}`,
            userData: { label: 'LIST', page: 1, referer: 'https://www.google.com/' },
        });
    }

    // If we were started from non-search URLs (e.g. /bangalore/urologist), also add the search URL seed.
    if (!starting.some((u) => (u || '').includes('/search/doctors'))) {
        initialRequests.push({
            url: buildSearchUrl({ cityName: city, specialityName: speciality, page: 1 }),
            uniqueKey: `LIST:${city}:${speciality}:1`,
            userData: { label: 'LIST', page: 1, referer: 'https://www.google.com/' },
        });
    }

    log.info(`Start URLs: ${initialRequests.map((r) => r.url).join(', ')}`);
    await crawler.run(initialRequests);

    // Flush any remaining base records that could not be enriched due to blocks/timeouts.
    if (saved < resultsWanted && pendingByDoctorKey.size) {
        for (const [doctorKey, doc] of pendingByDoctorKey.entries()) {
            if (saved >= resultsWanted) break;
            await pushDoctor(doc, doctorKey);
        }
    }

    log.info(`Finished: saved=${saved} listPagesEnqueued=${listPagesEnqueued} detailPagesEnqueued=${detailPagesEnqueued} detailBlocked=${detailPagesBlocked}`);
    log.info('Options: set `fetchDetails: false` for fastest/most reliable runs; set proxy country to IN to improve profile success.');
});
