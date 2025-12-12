import { Actor, log } from 'apify';
import { CheerioCrawler } from 'crawlee';

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
        fetchDetails = true,
        maxConcurrency: maxConcurrencyRaw = 15,
    } = input;

    const resultsWanted = Number.isFinite(+resultsWantedRaw) && +resultsWantedRaw > 0 ? +resultsWantedRaw : 100;
    const maxPages = Number.isFinite(+maxPagesRaw) && +maxPagesRaw > 0 ? +maxPagesRaw : 10;
    const maxConcurrency = Number.isFinite(+maxConcurrencyRaw) && +maxConcurrencyRaw > 0 ? Math.min(50, +maxConcurrencyRaw) : 10;

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

    const defaultHeaders = {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        referer: 'https://www.google.com/',
    };

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

    const pendingByKey = new Map();
    const pushedKeys = new Set();

    log.info(`Mode: ${fetchDetails ? 'LIST + DETAIL' : 'LIST-only'} | results_wanted=${resultsWanted} | max_pages=${maxPages} | maxConcurrency=${maxConcurrency}`);

    const crawler = new CheerioCrawler({
        proxyConfiguration,
        useSessionPool: true,
        persistCookiesPerSession: true,
        autoscaledPoolOptions: {
            desiredConcurrency: maxConcurrency,
            minConcurrency: Math.min(5, maxConcurrency),
        },
        maxConcurrency,
        maxRequestRetries: 4,
        requestHandlerTimeoutSecs: 120,
        failedRequestHandler: async ({ request }, error) => {
            log.warning(`Request failed: ${request.url} (${error?.message || error})`);
        },
        requestHandler: async ({ request, $, response }) => {
            const label = request.userData?.label || 'LIST';
            const pageNo = request.userData?.page ?? 1;

            log.debug(`${label} status=${response?.statusCode ?? 'n/a'} url=${request.url}`);
            if (!$) {
                log.warning(`Missing HTML for ${request.url}`);
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

                if (saved % 10 === 0 || saved === resultsWanted) {
                    log.info(`Saved ${saved}/${resultsWanted}`);
                }
                return;
            }

            const jsonDocs = parseJsonLdDoctors($);
            const htmlDocs = parseHtmlDoctors($);
            const merged = mergeDoctors(jsonDocs, htmlDocs).map((doc) => ({
                ...doc,
                city: doc.city || city,
                speciality: doc.speciality || speciality,
            }));

            const filtered = applyFilters(merged);
            if (!filtered.length) {
                log.info(`No doctors found on page ${pageNo}: ${request.url}`);
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
                    log.info(`Saved ${batch.length} (total ${saved}/${resultsWanted})`);
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
                        headers: defaultHeaders,
                        userData: { label: 'DETAIL', doctorKey },
                    }]);
                }
            }

            if (saved >= resultsWanted || saved + enqueuedDetails >= resultsWanted) return;
            if (pageNo >= maxPages) return;

            const nextUrl = findNextPageUrl($, request.url, pageNo);
            if (!nextUrl) return;

            await crawler.addRequests([{
                url: nextUrl,
                uniqueKey: `LIST:${nextUrl}`,
                headers: defaultHeaders,
                userData: { label: 'LIST', page: pageNo + 1 },
            }]);
        },
    });

    const initialRequests = initialUrls.filter(Boolean).map((u) => ({
        url: u,
        headers: defaultHeaders,
        userData: { label: 'LIST', page: 1 },
    }));

    await crawler.run(initialRequests);
    log.info(`Finished. Output: ${saved}`);
});
