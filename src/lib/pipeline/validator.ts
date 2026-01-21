/**
 * Pipeline Step 4: Validator
 * 
 * FINAL AUTHORITY - Deterministic only.
 * NEVER calls AI, NEVER infers, NEVER coerces null.
 */

import { logger } from '../logger';
import { ExtractionSchema, type ExtractionResult, type DetectedType } from '../schemas/definitions';

export interface ValidationSuccess {
    success: true;
    jsonLd: object;
    detectedType: DetectedType;
    repairs: string[];
}

export interface ValidationError {
    success: false;
    stage: 'validator';
    reason: string;
}

// Required fields per schema type (Google Rich Results requirements)
const REQUIRED_FIELDS: Record<DetectedType, string[]> = {
    Product: ['name'],
    Recipe: ['name'],
    Event: ['name', 'startDate'],
    LocalBusiness: ['name'],
    Article: ['headline'],
    BlogPosting: ['headline'],
    FAQPage: ['mainEntity'],
    HowTo: ['name'],
    WebPage: ['name']
};

/**
 * Repair price values - extract numeric value
 */
function repairPrice(value: string | number | null): number | null {
    if (value === null || value === undefined) return null;

    const str = String(value);
    // Extract numeric value from string like "$19.99" or "19,99 EUR"
    const match = str.match(/[\d,]+\.?\d*/);
    if (match) {
        // Handle comma as decimal separator
        const cleaned = match[0].replace(/,(?=\d{3})/g, '').replace(',', '.');
        const num = parseFloat(cleaned);
        if (!isNaN(num)) return num;
    }
    return null;
}

/**
 * Repair URL - ensure absolute URL
 * Handles:
 * - Protocol-relative URLs: //domain.com/path → https://domain.com/path
 * - Relative URLs: /path/to/image.jpg → https://baseUrl/path/to/image.jpg
 * - Already absolute URLs: return as-is
 */
function repairUrl(url: string | null, baseUrl?: string): string | null {
    if (!url) return null;

    try {
        // Handle protocol-relative URLs (//domain.com/path)
        if (url.startsWith('//')) {
            const absoluteUrl = 'https:' + url;
            new URL(absoluteUrl); // Validate
            return absoluteUrl;
        }

        // If already absolute, validate it
        if (url.startsWith('http://') || url.startsWith('https://')) {
            new URL(url);
            return url;
        }

        // Try to make relative URL absolute using base URL
        if (baseUrl) {
            const absolute = new URL(url, baseUrl);
            return absolute.href;
        }

        // Can't resolve without base URL
        return null;
    } catch {
        return null;
    }
}

/**
 * Repair date - attempt to parse to ISO 8601
 */
function repairDate(date: string | null): string | null {
    if (!date) return null;

    try {
        const parsed = new Date(date);
        if (!isNaN(parsed.getTime())) {
            return parsed.toISOString().split('T')[0]; // YYYY-MM-DD
        }
        return date; // Return as-is if already formatted
    } catch {
        return date;
    }
}

/**
 * Build JSON-LD from extraction result
 */
function buildJsonLd(data: ExtractionResult, repairs: string[], pageUrl?: string): object {
    const type = data.detectedType;

    const base = {
        '@context': 'https://schema.org',
        '@type': type
    };

    switch (type) {
        case 'Product': {
            const p = data.product;
            if (!p) return base;

            const jsonLd: Record<string, unknown> = { ...base };

            // Required/Recommended fields
            if (p.name) jsonLd.name = p.name;
            if (p.description) jsonLd.description = p.description;
            if (p.image?.length) {
                jsonLd.image = p.image.map(img => repairUrl(img, pageUrl)).filter(Boolean);
            }
            if (p.brand?.name) jsonLd.brand = { '@type': 'Brand', name: p.brand.name };

            // Identifiers
            if (p.sku) jsonLd.sku = p.sku;
            if (p.gtin) jsonLd.gtin = p.gtin;
            if (p.mpn) jsonLd.mpn = p.mpn;
            if (p.productID) jsonLd.productID = p.productID;

            // Variant attributes
            if (p.color) jsonLd.color = p.color;
            if (p.size) jsonLd.size = p.size;
            if (p.material) jsonLd.material = p.material;
            if (p.pattern) jsonLd.pattern = p.pattern;
            if (p.category) jsonLd.category = p.category;

            // Physical properties
            if (p.weight && p.weight.value !== null) {
                jsonLd.weight = {
                    '@type': 'QuantitativeValue',
                    value: repairPrice(p.weight.value),
                    unitCode: p.weight.unitCode
                };
            }

            // Offers - handle single or array
            if (p.offers) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const buildOffer = (offer: any) => {
                    if (!offer) return null;
                    const o: Record<string, unknown> = { '@type': 'Offer' };
                    const price = repairPrice(offer.price);
                    if (price !== null) {
                        o.price = price;
                        repairs.push(`Repaired price: ${offer.price} → ${price}`);
                    }
                    if (offer.priceCurrency) o.priceCurrency = offer.priceCurrency;
                    if (offer.availability) o.availability = offer.availability;
                    if (offer.url) o.url = repairUrl(offer.url, pageUrl);
                    if (offer.priceValidUntil) o.priceValidUntil = repairDate(offer.priceValidUntil);
                    if (offer.itemCondition) o.itemCondition = offer.itemCondition;
                    if (offer.sku) o.sku = offer.sku;
                    if (offer.seller?.name) o.seller = { '@type': 'Organization', name: offer.seller.name };
                    return o;
                };

                if (Array.isArray(p.offers)) {
                    const offers = p.offers.filter(Boolean).map(buildOffer).filter(Boolean);
                    if (offers.length > 0) jsonLd.offers = offers;
                } else {
                    const offer = buildOffer(p.offers);
                    if (offer) jsonLd.offers = offer;
                }
            }

            // Aggregate Rating
            if (p.aggregateRating) {
                const rating: Record<string, unknown> = { '@type': 'AggregateRating' };
                const ratingValue = repairPrice(p.aggregateRating.ratingValue);
                const reviewCount = repairPrice(p.aggregateRating.reviewCount);
                const bestRating = repairPrice(p.aggregateRating.bestRating);
                const worstRating = repairPrice(p.aggregateRating.worstRating);
                if (ratingValue !== null) rating.ratingValue = ratingValue;
                if (reviewCount !== null) rating.reviewCount = Math.floor(reviewCount);
                if (bestRating !== null) rating.bestRating = bestRating;
                if (worstRating !== null) rating.worstRating = worstRating;
                jsonLd.aggregateRating = rating;
            }

            // Reviews
            if (p.review?.length) {
                jsonLd.review = p.review.filter(Boolean).map(r => ({
                    '@type': 'Review',
                    author: r.author?.name ? { '@type': 'Person', name: r.author.name } : undefined,
                    reviewRating: r.reviewRating ? {
                        '@type': 'Rating',
                        ratingValue: repairPrice(r.reviewRating.ratingValue),
                        bestRating: repairPrice(r.reviewRating.bestRating)
                    } : undefined,
                    reviewBody: r.reviewBody,
                    datePublished: repairDate(r.datePublished)
                }));
            }

            return jsonLd;
        }

        case 'Recipe': {
            const r = data.recipe;
            if (!r) return base;

            const jsonLd: Record<string, unknown> = { ...base };

            if (r.name) jsonLd.name = r.name;
            if (r.image?.length) jsonLd.image = r.image;
            if (r.author?.name) {
                jsonLd.author = { '@type': r.author.type || 'Person', name: r.author.name };
            }
            if (r.datePublished) {
                jsonLd.datePublished = repairDate(r.datePublished);
                repairs.push('Repaired datePublished to ISO format');
            }
            if (r.prepTime) jsonLd.prepTime = r.prepTime;
            if (r.cookTime) jsonLd.cookTime = r.cookTime;
            if (r.totalTime) jsonLd.totalTime = r.totalTime;
            if (r.recipeYield) jsonLd.recipeYield = r.recipeYield;
            if (r.nutrition) {
                jsonLd.nutrition = { '@type': 'NutritionInformation', ...r.nutrition };
            }
            if (r.recipeIngredient?.length) jsonLd.recipeIngredient = r.recipeIngredient;
            if (r.recipeInstructions?.length) {
                jsonLd.recipeInstructions = r.recipeInstructions.map(step => ({
                    '@type': 'HowToStep',
                    text: step.text
                }));
            }

            return jsonLd;
        }

        case 'Event': {
            const e = data.event;
            if (!e) return base;

            const jsonLd: Record<string, unknown> = { ...base };

            if (e.name) jsonLd.name = e.name;
            if (e.startDate) jsonLd.startDate = repairDate(e.startDate);
            if (e.endDate) jsonLd.endDate = repairDate(e.endDate);
            if (e.eventStatus) jsonLd.eventStatus = e.eventStatus;
            if (e.location) {
                const loc: Record<string, unknown> = { '@type': 'Place' };
                if (e.location.name) loc.name = e.location.name;
                if (e.location.address) {
                    loc.address = { '@type': 'PostalAddress', ...e.location.address };
                }
                jsonLd.location = loc;
            }
            if (e.offers) {
                const offer: Record<string, unknown> = { '@type': 'Offer' };
                const price = repairPrice(e.offers.price);
                if (price !== null) offer.price = price;
                if (e.offers.priceCurrency) offer.priceCurrency = e.offers.priceCurrency;
                if (e.offers.url) offer.url = e.offers.url;
                jsonLd.offers = offer;
            }

            return jsonLd;
        }

        case 'LocalBusiness': {
            const b = data.localBusiness;
            if (!b) return base;

            const jsonLd: Record<string, unknown> = { ...base };

            if (b.name) jsonLd.name = b.name;
            if (b.image?.length) jsonLd.image = b.image;
            if (b.telephone) jsonLd.telephone = b.telephone;
            if (b.address) {
                jsonLd.address = { '@type': 'PostalAddress', ...b.address };
            }
            if (b.geo) {
                const lat = repairPrice(b.geo.latitude);
                const lng = repairPrice(b.geo.longitude);
                if (lat !== null && lng !== null) {
                    jsonLd.geo = { '@type': 'GeoCoordinates', latitude: lat, longitude: lng };
                }
            }
            if (b.openingHours?.length) jsonLd.openingHoursSpecification = b.openingHours;
            if (b.priceRange) jsonLd.priceRange = b.priceRange;

            return jsonLd;
        }

        case 'Article':
        case 'BlogPosting': {
            const a = type === 'BlogPosting' ? data.blogPosting : data.article;
            if (!a) return base;

            const jsonLd: Record<string, unknown> = { ...base };

            // Headlines & Description
            if (a.headline) jsonLd.headline = a.headline;
            if (a.alternativeHeadline) jsonLd.alternativeHeadline = a.alternativeHeadline;
            if (a.description) jsonLd.description = a.description;

            // Images (array of URLs)
            if (a.image?.length) {
                jsonLd.image = a.image.map(img => repairUrl(img, pageUrl)).filter(Boolean);
            }

            // Author handling (primary author)
            if (a.author?.name) {
                const author = {
                    '@type': a.author.type || 'Person',
                    name: a.author.name,
                    url: repairUrl(a.author.url, pageUrl)
                };

                // Check for additional authors (co-authors)
                if (a.additionalAuthors?.length) {
                    const allAuthors = [author, ...a.additionalAuthors
                        .filter((aa: { name: string | null }) => aa?.name)
                        .map((aa: { type: string | null; name: string | null; url: string | null }) => ({
                            '@type': aa.type || 'Person',
                            name: aa.name,
                            url: aa.url
                        }))
                    ];
                    jsonLd.author = allAuthors;
                } else {
                    jsonLd.author = author;
                }
            }

            // Publisher with logo
            if (a.publisher?.name) {
                const publisher: Record<string, unknown> = {
                    '@type': 'Organization',
                    name: a.publisher.name
                };
                if (a.publisher.logoUrl) {
                    publisher.logo = {
                        '@type': 'ImageObject',
                        url: repairUrl(a.publisher.logoUrl, pageUrl),
                        width: repairPrice(a.publisher.logoWidth),
                        height: repairPrice(a.publisher.logoHeight)
                    };
                }
                jsonLd.publisher = publisher;
            }

            // Dates
            if (a.datePublished) jsonLd.datePublished = repairDate(a.datePublished);
            if (a.dateModified) jsonLd.dateModified = repairDate(a.dateModified);

            // Content metrics & categories
            if (a.articleSection) jsonLd.articleSection = a.articleSection;
            if (a.keywords?.length) jsonLd.keywords = a.keywords;
            if (a.wordCount) jsonLd.wordCount = repairPrice(a.wordCount);

            // Paywall / Access
            if (a.isAccessibleForFree !== null && a.isAccessibleForFree !== undefined) {
                jsonLd.isAccessibleForFree = a.isAccessibleForFree;
            }

            // SEO technicals
            if (a.mainEntityOfPage) jsonLd.mainEntityOfPage = repairUrl(a.mainEntityOfPage, pageUrl);

            // Additional fields
            if (a.inLanguage) jsonLd.inLanguage = a.inLanguage;
            if (a.copyrightHolder) jsonLd.copyrightHolder = a.copyrightHolder;
            if (a.copyrightYear) jsonLd.copyrightYear = repairPrice(a.copyrightYear);
            if (a.thumbnailUrl) jsonLd.thumbnailUrl = repairUrl(a.thumbnailUrl, pageUrl);

            return jsonLd;
        }

        case 'FAQPage': {
            const f = data.faq;
            if (!f) return base;

            const jsonLd: Record<string, unknown> = { ...base };

            if (f.mainEntity?.length) {
                jsonLd.mainEntity = f.mainEntity.map(q => ({
                    '@type': 'Question',
                    name: q.name,
                    acceptedAnswer: q.acceptedAnswer ? {
                        '@type': 'Answer',
                        text: q.acceptedAnswer.text
                    } : undefined
                }));
            }

            return jsonLd;
        }

        case 'HowTo': {
            const h = data.howto;
            if (!h) return base;

            const jsonLd: Record<string, unknown> = { ...base };

            if (h.name) jsonLd.name = h.name;
            if (h.totalTime) jsonLd.totalTime = h.totalTime;
            if (h.step?.length) {
                jsonLd.step = h.step.map(s => ({
                    '@type': 'HowToStep',
                    name: s.name,
                    text: s.text,
                    url: s.url,
                    image: s.image
                }));
            }
            if (h.tool?.length) {
                jsonLd.tool = h.tool.map(t => ({ '@type': 'HowToTool', name: t.name }));
            }
            if (h.supply?.length) {
                jsonLd.supply = h.supply.map(s => ({ '@type': 'HowToSupply', name: s.name }));
            }

            return jsonLd;
        }

        case 'WebPage':
        default: {
            const w = data.webPage;
            if (!w) return base;

            const jsonLd: Record<string, unknown> = { ...base };

            if (w.name) jsonLd.name = w.name;
            if (w.description) jsonLd.description = w.description;
            if (w.datePublished) jsonLd.datePublished = repairDate(w.datePublished);
            if (w.dateModified) jsonLd.dateModified = repairDate(w.dateModified);
            if (w.breadcrumb?.length) {
                jsonLd.breadcrumb = {
                    '@type': 'BreadcrumbList',
                    itemListElement: w.breadcrumb.map((name, i) => ({
                        '@type': 'ListItem',
                        position: i + 1,
                        name
                    }))
                };
            }

            return jsonLd;
        }
    }
}

/**
 * Check if required fields are present
 */
function checkRequiredFields(data: ExtractionResult): string | null {
    const type = data.detectedType;
    const required = REQUIRED_FIELDS[type] || [];

    let schemaData: Record<string, unknown> | null = null;

    switch (type) {
        case 'Product': schemaData = data.product as Record<string, unknown>; break;
        case 'Recipe': schemaData = data.recipe as Record<string, unknown>; break;
        case 'Event': schemaData = data.event as Record<string, unknown>; break;
        case 'LocalBusiness': schemaData = data.localBusiness as Record<string, unknown>; break;
        case 'Article': schemaData = data.article as Record<string, unknown>; break;
        case 'BlogPosting': schemaData = data.blogPosting as Record<string, unknown>; break;
        case 'FAQPage': schemaData = data.faq as Record<string, unknown>; break;
        case 'HowTo': schemaData = data.howto as Record<string, unknown>; break;
        case 'WebPage': schemaData = data.webPage as Record<string, unknown>; break;
    }

    if (!schemaData) {
        return `Missing ${type} data object`;
    }

    for (const field of required) {
        const value = schemaData[field];
        if (value === null || value === undefined || value === '') {
            return `Missing required field: ${type}.${field}`;
        }
        // Check arrays are not empty
        if (Array.isArray(value) && value.length === 0) {
            return `Empty required field: ${type}.${field}`;
        }
    }

    return null;
}

/**
 * Validate and build final JSON-LD output
 */
export function validate(data: ExtractionResult, pageUrl?: string): ValidationSuccess | ValidationError {
    const log = logger.scoped('Validator');
    const repairs: string[] = [];

    try {
        log.info('Starting validation', {
            detectedType: data.detectedType
        });

        // Step 1: Zod validation
        log.debug('Running Zod schema validation');
        const zodResult = ExtractionSchema.safeParse(data);

        if (!zodResult.success) {
            const errors = zodResult.error.issues.map((e) => `${String(e.path.join('.'))}: ${e.message}`);
            log.error('Zod validation failed', { errors });
            return {
                success: false,
                stage: 'validator',
                reason: `Schema validation failed: ${errors.join('; ')}`
            };
        }

        // Step 2: Check required fields
        log.debug('Checking required fields');
        const requiredError = checkRequiredFields(data);
        if (requiredError) {
            log.error('Required field missing', { error: requiredError });
            return {
                success: false,
                stage: 'validator',
                reason: requiredError
            };
        }

        // Step 3: Build JSON-LD with repairs
        log.debug('Building JSON-LD with repairs');
        const jsonLd = buildJsonLd(data, repairs, pageUrl);

        // Step 4: Freeze output
        const frozen = Object.freeze(jsonLd);

        log.info('Validation complete', {
            type: data.detectedType,
            repairsCount: repairs.length,
            repairs
        });

        return {
            success: true,
            jsonLd: frozen,
            detectedType: data.detectedType,
            repairs
        };

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error('Validation failed', { error: message });

        return {
            success: false,
            stage: 'validator',
            reason: message
        };
    }
}
