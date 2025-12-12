import { Actor, log } from 'apify';
import { CheerioCrawler } from 'crawlee';
import { gotScraping } from 'got-scraping';
import { load as cheerioLoad } from 'cheerio';

await Actor.main(async () => {
    const input = (await Actor.getInput()) || {};
    const {
        speciality = 'dermatologist',
        city = 'bangalore',
        locality = '',
        results_wanted: resultsWantedRaw = 100,
        max_pages: maxPagesRaw = 10,
        startUrl,
        startUrls,
        url,
        proxyConfiguration: proxyConfigurationInput,
        minExperience = 0,
        minRating = 0,
    } = input;

    const resultsWanted = Number.isFinite(+resultsWantedRaw) && +resultsWantedRaw > 0 ? +resultsWantedRaw : 100;
    const maxPages = Number.isFinite(+maxPagesRaw) && +maxPagesRaw > 0 ? +maxPagesRaw : 10;

    const startFromInput = [];
    if (Array.isArray(startUrls) && startUrls.length) startFromInput.push(...startUrls);
    if (startUrl) startFromInput.push(startUrl);
    if (url) startFromInput.push(url);
    if (!startFromInput.length) {
        const base = `https://www.practo.com/${city}/${speciality}`;
        startFromInput.push(locality ? `${base}/${locality}` : base);
    }

    const defaultHeaders = {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        referer: 'https://www.google.com/',
    };

    const checklist = [
        'Hit listing endpoints with browser-like headers and proxy before parsing.',
        'Extract doctors from JSON-LD first to avoid brittle selectors.',
        'Fallback to HTML card parsing when structured data is absent.',
        'Deduplicate by profile URL/name and apply filters before saving.',
        'Stop at results_wanted/max_pages while paginating defensively.',
    ];
    log.info(`Execution plan:\n- ${checklist.join('\n- ')}`);

    const proxyConfiguration = await Actor.createProxyConfiguration(
        proxyConfigurationInput || { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    );

    let saved = 0;
    const detailCache = new Map();
    const seen = new Set();

    const clean = (text = '') => text.replace(/\s+/g, ' ').trim();
    const numberFromText = (text = '', fallback = 0) => {
        const match = clean(text).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
        return match ? Number(match[1]) : fallback;
    };
    const toAbsoluteUrl = (value) => {
        if (!value) return null;
        try {
            return value.startsWith('http') ? value : new URL(value, 'https://www.practo.com').toString();
        } catch (err) {
            log.debug(`Failed to normalize URL "${value}": ${err.message}`);
            return null;
        }
    };

    function parseJsonLdDoctors($) {
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
                const isDoctor = typeList.some((t) => t.toLowerCase() === 'physician' || t.toLowerCase() === 'person');
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
    }

    function parseHtmlDoctors($) {
        const doctors = [];
        const cards = $('[data-qa-id="doctor_card"], .listing-doctor-card, .doctor-card');
        cards.each((_, card) => {
            const $card = $(card);
            const name = clean($card.find('[data-qa-id="doctor_name"], .doctor-name').first().text());
            const urlPath = $card.find('a[href*="/doctor/"]').first().attr('href');
            const urlAbs = toAbsoluteUrl(urlPath);
            const specialityText = clean(
                $card.find('[data-qa-id="doctor_name"]').closest('.info-section').find('.u-grey_3-text span').first().text()
                || $card.find('[class*="speciality"]').first().text()
            );
            const experienceText = clean($card.find('[data-qa-id="doctor_experience"]').text());
            const experience = experienceText ? numberFromText(experienceText, 0) : numberFromText($card.text(), 0);
            const location = clean($card.find('[data-qa-id="practice_locality"]').text());
            const cityFromCard = clean($card.find('[data-qa-id="practice_city"]').text());
            const fee = numberFromText($card.find('[data-qa-id="consultation_fee"]').text(), null);
            const rating = numberFromText($card.find('[data-qa-id="doctor_recommendation"]').text(), null);
            const patientStories = numberFromText($card.find('[data-qa-id="total_feedback"]').text(), 0);
            const clinicName = clean($card.find('[data-qa-id="doctor_clinic_name"]').text());
            const profileImage = toAbsoluteUrl(
                $card.find('img').first().attr('src')
                || $card.find('img').first().attr('data-src'),
            );

            if (!name && !urlAbs) return;
            doctors.push({
                name,
                speciality: specialityText || null,
                experience,
                location,
                city: cityFromCard || null,
                consultationFee: fee,
                rating,
                patientStories,
                clinicName,
                profileImage,
                url: urlAbs,
                source: 'html',
            });
        });
        return doctors;
    }

    function mergeDoctors(primary = [], secondary = []) {
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
    }

    const applyFilters = (doctors) => doctors.filter((doc) => {
        const experienceOk = (doc.experience ?? 0) >= minExperience;
        const ratingOk = !minRating || (doc.rating ?? 0) >= minRating;
        return experienceOk && ratingOk;
    });

    const findNextPageUrl = ($, currentUrl, currentPage) => {
        const relNext = $('a[rel="next"]').attr('href');
        if (relNext) return toAbsoluteUrl(relNext);

        const labeledNext = $('a:contains("Next"), a[aria-label="Next"]').not('.disabled').first().attr('href');
        if (labeledNext) return toAbsoluteUrl(labeledNext);

        const pageLink = $(`a[href*="page=${currentPage + 1}"]`).first().attr('href');
        if (pageLink) return toAbsoluteUrl(pageLink);

        const anyHigher = $('a[href*="page="]').map((_, el) => {
            const href = $(el).attr('href') || '';
            const match = href.match(/page=(\d+)/);
            return match ? { href, page: Number(match[1]) } : null;
        }).get().filter(Boolean).sort((a, b) => a.page - b.page);
        const nextHigher = anyHigher.find((item) => item.page > currentPage);
        if (nextHigher) return toAbsoluteUrl(nextHigher.href);

        return null;
    };

    const fetchDoctorDetail = async (doctor) => {
        if (!doctor.url) return doctor;
        if (detailCache.has(doctor.url)) {
            return { ...doctor, ...detailCache.get(doctor.url) };
        }

        try {
            const response = await gotScraping({
                url: doctor.url,
                headers: defaultHeaders,
                proxyUrl: await proxyConfiguration.newUrl(),
                timeout: { request: 30000 },
            });
            const $$ = cheerioLoad(response.body);
            const description = clean($$('p.c-profile__description').first().text());
            const profileImage = toAbsoluteUrl(
                $$('img.c-profile__image').attr('src')
                || $$('img.c-profile__image').attr('data-src'),
            );
            const detail = {
                description: description || null,
                profileImage: profileImage || doctor.profileImage || null,
            };
            detailCache.set(doctor.url, detail);
            return { ...doctor, ...detail };
        } catch (err) {
            log.debug(`Detail fetch failed for ${doctor.url}: ${err.message}`);
            return doctor;
        }
    };

    const crawler = new CheerioCrawler({
        proxyConfiguration,
        maxConcurrency: 5,
        maxRequestRetries: 2,
        requestHandlerTimeoutSecs: 45,
        requestHandler: async ({ request, $ }) => {
            const pageNo = request.userData.page ?? 1;
            log.info(`Processing page ${pageNo}: ${request.url}`);

            const jsonDocs = parseJsonLdDoctors($);
            if (jsonDocs.length) {
                log.debug(`Found ${jsonDocs.length} doctors via JSON-LD`);
            } else {
                log.debug('No JSON-LD doctors found on this page');
            }

            const htmlDocs = parseHtmlDoctors($);
            if (htmlDocs.length) {
                log.debug(`Parsed ${htmlDocs.length} doctors from HTML`);
            }

            const merged = mergeDoctors(jsonDocs, htmlDocs).map((doc) => ({
                city: doc.city || city,
                speciality: doc.speciality || speciality,
                ...doc,
            }));

            const filtered = applyFilters(merged).filter((doc) => {
                const key = doc.url || `${doc.name || ''}-${doc.location || ''}-${doc.city || ''}`;
                if (!key) return false;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            const remaining = resultsWanted - saved;
            const toEnrich = filtered.slice(0, Math.max(0, remaining));
            const batch = [];

            for (const doc of toEnrich) {
                if (!doc.description || !doc.profileImage) {
                    const enriched = await fetchDoctorDetail(doc);
                    batch.push(enriched);
                } else {
                    batch.push(doc);
                }
            }

            if (batch.length) {
                await Actor.pushData(batch);
                saved += batch.length;
                log.info(`Saved ${batch.length} doctors (total ${saved}/${resultsWanted})`);
            } else {
                log.debug('No new doctors to save from this page');
            }

            const hasResults = jsonDocs.length || htmlDocs.length;
            if (saved >= resultsWanted) {
                log.info('Reached requested result count, stopping pagination');
                return;
            }
            if (pageNo >= maxPages) {
                log.info('Reached max_pages guard, stopping pagination');
                return;
            }
            if (!hasResults) {
                log.info('No results detected, stopping pagination to stay stealthy');
                return;
            }

            const nextUrl = findNextPageUrl($, request.url, pageNo);
            if (!nextUrl) {
                log.info('No next page link detected');
                return;
            }

            await crawler.addRequests([{
                url: nextUrl,
                userData: { page: pageNo + 1 },
                headers: defaultHeaders,
            }]);
            log.info(`Enqueued page ${pageNo + 1}: ${nextUrl}`);
        },
    });

    const initialRequests = startFromInput.map((u) => ({
        url: u,
        userData: { page: 1 },
        headers: defaultHeaders,
    }));

    await crawler.run(initialRequests);
    log.info(`Scraping completed. Total doctors saved: ${saved}`);
});
