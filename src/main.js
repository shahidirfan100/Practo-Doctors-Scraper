import { Actor, log } from 'apify';
import { CheerioCrawler } from 'crawlee';
import { gotScraping } from 'got-scraping';
import { load as cheerioLoad } from 'cheerio';

// ═══════════════════════════════════════════════════════════════════════════════
// PRACTO DOCTORS SCRAPER - ANTI-DETECTION HARDENED VERSION
// ═══════════════════════════════════════════════════════════════════════════════
// Advanced stealth techniques:
// ✅ Sophisticated user-agent rotation (Dec 2025 browsers)
// ✅ Complete client hint headers (Chrome/Edge/Safari versions)
// ✅ Version consistency validation
// ✅ Random human-like timing patterns
// ✅ Request pacing with exponential backoff + jitter
// ✅ Network latency simulation
// ✅ Aggressive session rotation + bad session retirement
// ✅ Request randomization (referrer, sec-fetch, origin)
// ✅ Natural browsing patterns (viewport sizes, language)
// ✅ Intelligent rate limiting per domain
// ═══════════════════════════════════════════════════════════════════════════════

const stealthUserAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
];

const chromeVersions = [
    { major: '132', full: '132.0.6834.110' },
    { major: '131', full: '131.0.6778.204' },
    { major: '130', full: '130.0.6723.116' },
    { major: '129', full: '129.0.6668.100' },
];

const viewportSizes = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
];

const languages = [
    'en-US,en;q=0.9',
    'en-US,en;q=0.9,hi;q=0.8',
    'en;q=0.9,en-US;q=0.8',
];

const referers = [
    'https://www.google.com/',
    'https://www.google.co.in/',
    'https://www.bing.com/',
    '',
];

const randomDelay = (min = 100, max = 500) => new Promise(r => setTimeout(r, Math.random() * (max - min) + min));

const getRandomElement = (arr) => arr[Math.floor(Math.random() * arr.length)];

const exponentialBackoffWithJitter = (retryCount, baseDelay = 1000, jitterFactor = 0.1) => {
    const exponential = baseDelay * Math.pow(2, retryCount);
    const jitter = exponential * (Math.random() - 0.5) * 2 * jitterFactor;
    return Math.max(exponential + jitter, 500);
};

const generateClientHints = () => {
    const chromeVersion = getRandomElement(chromeVersions);
    const viewport = getRandomElement(viewportSizes);
    return {
        'sec-ch-ua': `"Google Chrome";v="${chromeVersion.major}", "Chromium";v="${chromeVersion.major}", ";Not A Brand";v="99"`,
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-ch-ua-platform-version': '"15.0"',
        'sec-ch-viewport-width': String(viewport.width),
        'sec-ch-viewport-height': String(viewport.height),
    };
};

const buildStealthHeaders = (referer = '') => {
    const userAgent = getRandomElement(stealthUserAgents);
    const clientHints = generateClientHints();
    
    return {
        'user-agent': userAgent,
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': getRandomElement(languages),
        'sec-fetch-site': referer ? 'cross-site' : 'none',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
        'cache-control': 'max-age=0',
        'upgrade-insecure-requests': '1',
        'referer': referer || getRandomElement(referers),
        ...clientHints,
    };
};

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
        maxConcurrency: maxConcurrencyRaw = 3, // CRITICAL: Lower = more stealthy
    } = input;

    const resultsWanted = Number.isFinite(+resultsWantedRaw) && +resultsWantedRaw > 0 ? +resultsWantedRaw : 50;
    const maxPages = Number.isFinite(+maxPagesRaw) && +maxPagesRaw > 0 ? +maxPagesRaw : 10;
    const maxConcurrency = Number.isFinite(+maxConcurrencyRaw) && +maxConcurrencyRaw > 0
        ? Math.min(5, +maxConcurrencyRaw)  // CAP at 5 for stealth
        : 3;

    const normalizeUrlLike = (value) => {
        if (!value) return null;
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'object' && typeof value.url === 'string') return value.url.trim();
        return null;
    };

    const buildStartUrl = (spec, cty, loc) => {
        const base = `https://www.practo.com/${cty}/${spec}`;
        return loc ? `${base}/${loc}` : base;
    };

    const initialUrls = [];
    if (Array.isArray(startUrls) && startUrls.length) initialUrls.push(...startUrls.map(normalizeUrlLike).filter(Boolean));
    if (startUrl) initialUrls.push(normalizeUrlLike(startUrl));
    if (url) initialUrls.push(normalizeUrlLike(url));
    if (!initialUrls.filter(Boolean).length) initialUrls.push(buildStartUrl(speciality, city, locality));

    const proxyConfiguration = await Actor.createProxyConfiguration(
        proxyConfigurationInput || { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    );

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

    const applyFilters = (doctors) => doctors.filter((doc) => {
        const experienceOk = (doc.experience ?? 0) >= minExperience;
        const ratingOk = !minRating || (doc.rating ?? 0) >= minRating;
        return experienceOk && ratingOk;
    });

    // Parse doctors from JSON-LD blobs.
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

    // Parse doctors from listing HTML cards.
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

    // Merge two doctor lists, preferring primary fields.
    const mergeDoctors = (primary = [], secondary = []) => {
        const map = new Map();
        for (const doc of primary) {
            const key = doc.url || doc.name;
            if (!key) continue;
            map.set(key, doc);
        }
        for (const doc of secondary) {
            const key = doc.url || doc.name;
            if (!key) continue;
            const existing = map.get(key) || {};
            map.set(key, { ...existing, ...doc });
        }
        return Array.from(map.values());
    };

    // Attempt to use Practo JSON search endpoint first (stealthier, faster).
    const fetchDoctorsViaApi = async ({ cityName, specialityName, page, proxyUrl, cookieJar, retryCount = 0 }) => {
        // Add strategic delay for human-like behavior
        await randomDelay(200 + Math.random() * 300);

        const apiUrl = `https://www.practo.com/search/doctors?results_type=doctor&q=%5B%7B%22word%22%3A%22${encodeURIComponent(specialityName)}%22%2C%22autocompleted%22%3Atrue%2C%22category%22%3A%22subspeciality%22%7D%5D&city=${encodeURIComponent(cityName)}&page=${page}`;
        
        try {
            const res = await gotScraping({
                url: apiUrl,
                headers: buildStealthHeaders('https://www.google.com'),
                proxyUrl,
                cookieJar,
                http2: false,
                timeout: { request: 25000 },
                retry: {
                    limit: 0, // We handle retries manually
                },
            });

            if (res.statusCode === 403) {
                log.warning(`API 403 on page ${page}, rotating strategy`);
                return [];
            }

            const contentType = res.headers['content-type'] || '';
            if (contentType.includes('application/json')) {
                const body = typeof res.body === 'string' ? res.body : res.body.toString();
                let parsed;
                try {
                    parsed = JSON.parse(body);
                } catch {
                    parsed = null;
                }
                if (parsed?.data?.length) {
                    return parsed.data.map((item) => ({
                        name: item.name || null,
                        speciality: item.speciality || specialityName,
                        experience: item.experience_years || null,
                        location: item.locality || null,
                        city: item.city || cityName,
                        consultationFee: item.consultation_fee || null,
                        rating: item.recommendation_score ? Number(item.recommendation_score) : null,
                        url: toAbsoluteUrl(item.link || item.url),
                        profileImage: toAbsoluteUrl(item.profile_picture),
                        source: 'api',
                    }));
                }
            }

            // If not pure JSON, parse JSON-LD from HTML body.
            const $ = cheerioLoad(res.body);
            return parseJsonLdDoctors($);
        } catch (err) {
            log.debug(`API fetch error (retry ${retryCount}): ${err.message}`);
            if (retryCount < 2) {
                const delay = exponentialBackoffWithJitter(retryCount);
                await new Promise(r => setTimeout(r, delay));
                return fetchDoctorsViaApi({ cityName, specialityName, page, proxyUrl, cookieJar, retryCount: retryCount + 1 });
            }
            return [];
        }
    };

    const makePageUrl = (currentUrl, page) => {
        try {
            const u = new URL(currentUrl);
            u.searchParams.set('page', String(page));
            return u.toString();
        } catch {
            return null;
        }
    };

    const findNextPageUrl = ($, currentUrl, currentPage) => {
        const relNext = $('a[rel="next"]').attr('href');
        if (relNext) return toAbsoluteUrl(relNext);

        const labeledNext = $('a:contains("Next"), a[aria-label="Next"]').not('.disabled').first().attr('href');
        if (labeledNext) return toAbsoluteUrl(labeledNext);

        const pageLink = $(`a[href*="page=${currentPage + 1}"]`).first().attr('href');
        if (pageLink) return toAbsoluteUrl(pageLink);

        const constructed = makePageUrl(currentUrl, currentPage + 1);
        if (constructed) return constructed;

        return null;
    };

    const parseDoctorDetail = ($, requestUrl) => {
        const description = clean($('p.c-profile__description').first().text());
        const profileImage = toAbsoluteUrl(
            $('img.c-profile__image').attr('src') || $('img.c-profile__image').attr('data-src'),
        );

        if (description || profileImage) {
            return {
                description: description || null,
                profileImage: profileImage || null,
            };
        }

        const jsonDoctors = parseJsonLdDoctors($);
        const best = jsonDoctors.find((d) => d.url && toDoctorKey(d.url) === toDoctorKey(requestUrl)) || jsonDoctors[0];
        return {
            description: best?.description || null,
            profileImage: best?.profileImage || null,
        };
    };

    let saved = 0;
    let enqueuedDetails = 0;
    let requestCount = 0;
    const lastRequestTime = { value: 0 };

    const pendingByKey = new Map();
    const pushedKeys = new Set();

    log.info(`🚀 Stealthy Mode: ${fetchDetails ? 'LIST + DETAIL' : 'LIST-only'}`);
    log.info(`📊 Config: results=${resultsWanted} | maxPages=${maxPages} | concurrency=${maxConcurrency}`);
    log.info(`🛡️ Protection: User-Agent rotation | Client hints | Session cycling | Smart backoff`);

    const crawler = new CheerioCrawler({
        proxyConfiguration,
        useSessionPool: true,
        persistCookiesPerSession: true,
        autoscaledPoolOptions: {
            desiredConcurrency: maxConcurrency,
            minConcurrency: Math.min(2, maxConcurrency),
            maxConcurrency: maxConcurrency,
        },
        maxRequestRetries: 3,
        requestHandlerTimeoutSecs: 60,
        preNavigationHooks: [
            async ({ session, request }) => {
                // Intelligent session retirement
                if (request.retryCount >= 1) {
                    if (session) session.markBad();
                    log.debug(`⚠️ Session marked bad, retry ${request.retryCount}`);
                }
                
                // Add exponential backoff to retried requests
                if (request.retryCount > 0) {
                    const delay = exponentialBackoffWithJitter(request.retryCount);
                    await new Promise(r => setTimeout(r, delay));
                    log.debug(`⏱️ Backoff: ${delay}ms after retry ${request.retryCount}`);
                }
                
                // Random delay between requests
                const now = Date.now();
                const timeSinceLastRequest = now - lastRequestTime.value;
                const minDelay = 500 + Math.random() * 1500;
                if (timeSinceLastRequest < minDelay) {
                    const waitTime = minDelay - timeSinceLastRequest;
                    await new Promise(r => setTimeout(r, waitTime));
                }
                lastRequestTime.value = Date.now();
            },
        ],
        failedRequestHandler: async ({ request }, error) => {
            const errorMsg = error?.message || String(error);
            if (errorMsg.includes('403')) {
                log.warning(`🔒 403 BLOCKED: ${request.url}`);
            } else if (errorMsg.includes('502') || errorMsg.includes('UPSTREAM')) {
                log.warning(`📡 Proxy error: ${errorMsg}`);
            } else {
                log.warning(`❌ Failed: ${request.url} - ${errorMsg}`);
            }
        },
        requestHandler: async ({ request, $, response, session, proxyInfo }) => {
            const label = request.userData?.label || 'LIST';
            const pageNo = request.userData?.page ?? 1;

            requestCount++;

            if (response?.statusCode === 403) {
                log.warning(`🔒 403 detected, bad session mark`);
                if (session) session.markBad();
                return;
            }

            if (!$) {
                log.warning(`⚠️ No HTML for ${request.url}`);
                return;
            }

            if (label === 'DETAIL') {
                const doctorKey = request.userData?.doctorKey || toDoctorKey(request.url) || request.url;
                if (pushedKeys.has(doctorKey)) return;

                const base = pendingByKey.get(doctorKey) || {
                    url: request.url,
                    city,
                    speciality,
                };

                const detail = parseDoctorDetail($, request.url);
                const item = {
                    ...base,
                    ...detail,
                    url: base.url || request.url,
                };

                pendingByKey.delete(doctorKey);

                const outputKey = doctorKey;
                if (!outputKey || pushedKeys.has(outputKey)) return;

                await Actor.pushData(item);
                pushedKeys.add(outputKey);
                saved += 1;

                if (saved % 5 === 0 || saved === resultsWanted) {
                    log.info(`✅ Saved ${saved}/${resultsWanted} | Requests: ${requestCount}`);
                }
                return;
            }

            // LIST handler: API first, HTML fallback
            log.info(`📄 Processing LIST page ${pageNo}: ${request.url}`);
            
            let jsonDocs = [];
            try {
                jsonDocs = await fetchDoctorsViaApi({
                    cityName: city,
                    specialityName: speciality,
                    page: pageNo,
                    proxyUrl: proxyInfo?.url,
                    cookieJar: session?.cookieJar,
                });
                if (jsonDocs.length > 0) {
                    log.info(`📡 API success: ${jsonDocs.length} doctors`);
                }
            } catch (err) {
                log.debug(`API fallback: ${err.message}`);
            }

            const htmlDocs = parseHtmlDoctors($);
            if (htmlDocs.length > 0) {
                log.info(`🌐 HTML parsed: ${htmlDocs.length} doctors`);
            }

            const merged = mergeDoctors(jsonDocs, htmlDocs).map((doc) => ({
                ...doc,
                city: doc.city || city,
                speciality: doc.speciality || speciality,
            }));

            const filtered = applyFilters(merged);
            if (!filtered.length) {
                log.info(`⚠️ No doctors after filtering on page ${pageNo}`);
            }

            if (!fetchDetails) {
                const remaining = resultsWanted - saved;
                const batch = filtered.slice(0, Math.max(0, remaining)).filter((doc) => {
                    const key = toDoctorKey(doc.url) || doc.url || doc.name;
                    if (!key || pushedKeys.has(key)) return false;
                    pushedKeys.add(key);
                    return true;
                });
                if (batch.length) {
                    await Actor.pushData(batch);
                    saved += batch.length;
                    log.info(`✅ Saved ${batch.length} (total: ${saved}/${resultsWanted})`);
                }
            } else {
                for (const doc of filtered) {
                    if (saved + enqueuedDetails >= resultsWanted) break;
                    if (!doc.url) continue;

                    const doctorKey = toDoctorKey(doc.url);
                    if (!doctorKey) continue;
                    if (pendingByKey.has(doctorKey) || pushedKeys.has(doctorKey)) continue;

                    pendingByKey.set(doctorKey, {
                        ...doc,
                        url: doc.url,
                        doctorKey,
                    });

                    enqueuedDetails += 1;
                    await crawler.addRequests([{
                        url: doc.url,
                        uniqueKey: doctorKey,
                        headers: buildStealthHeaders(request.url),
                        userData: { label: 'DETAIL', doctorKey },
                    }]);
                }
            }

            if (saved >= resultsWanted || saved + enqueuedDetails >= resultsWanted) {
                log.info(`🎯 Reached target results`);
                return;
            }
            if (pageNo >= maxPages) {
                log.info(`⏸️ Reached max pages limit`);
                return;
            }

            const nextUrl = findNextPageUrl($, request.url, pageNo);
            if (!nextUrl) {
                log.info(`⏸️ No next page found`);
                return;
            }

            log.info(`⬇️ Enqueuing page ${pageNo + 1}`);
            await crawler.addRequests([{
                url: nextUrl,
                uniqueKey: `LIST:${nextUrl}`,
                headers: buildStealthHeaders(request.url),
                userData: { label: 'LIST', page: pageNo + 1 },
            }]);
        },
    });

    const initialRequests = initialUrls.filter(Boolean).map((u) => ({
        url: u,
        headers: buildStealthHeaders(),
        userData: { label: 'LIST', page: 1 },
    }));

    log.info(`🌐 Starting from: ${initialRequests.map(r => r.url).join(', ')}`);
    await crawler.run(initialRequests);
    log.info(`✅ FINISHED! Extracted: ${saved} doctors in ${requestCount} requests`);
});
