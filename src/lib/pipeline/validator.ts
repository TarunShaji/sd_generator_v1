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
 */
function repairUrl(url: string | null, baseUrl?: string): string | null {
    if (!url) return null;

    try {
        // If already absolute, validate it
        if (url.startsWith('http://') || url.startsWith('https://')) {
            new URL(url);
            return url;
        }

        // Try to make relative URL absolute
        if (baseUrl) {
            const absolute = new URL(url, baseUrl);
            return absolute.href;
        }

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
function buildJsonLd(data: ExtractionResult, repairs: string[]): object {
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

            if (p.name) jsonLd.name = p.name;
            if (p.description) jsonLd.description = p.description;
            if (p.image?.length) jsonLd.image = p.image;
            if (p.sku) jsonLd.sku = p.sku;
            if (p.gtin) jsonLd.gtin = p.gtin;
            if (p.brand?.name) jsonLd.brand = { '@type': 'Brand', name: p.brand.name };

            if (p.offers) {
                const offer: Record<string, unknown> = { '@type': 'Offer' };
                const price = repairPrice(p.offers.price);
                if (price !== null) {
                    offer.price = price;
                    repairs.push(`Repaired price: ${p.offers.price} → ${price}`);
                }
                if (p.offers.priceCurrency) offer.priceCurrency = p.offers.priceCurrency;
                if (p.offers.availability) offer.availability = p.offers.availability;
                if (p.offers.url) offer.url = p.offers.url;
                jsonLd.offers = offer;
            }

            if (p.aggregateRating) {
                const rating: Record<string, unknown> = { '@type': 'AggregateRating' };
                const ratingValue = repairPrice(p.aggregateRating.ratingValue);
                const reviewCount = repairPrice(p.aggregateRating.reviewCount);
                if (ratingValue !== null) rating.ratingValue = ratingValue;
                if (reviewCount !== null) rating.reviewCount = Math.floor(reviewCount);
                jsonLd.aggregateRating = rating;
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

            if (a.headline) jsonLd.headline = a.headline;
            if (a.image?.length) jsonLd.image = a.image;
            if (a.author?.name) {
                jsonLd.author = { '@type': a.author.type || 'Person', name: a.author.name };
            }
            if (a.publisher?.name) {
                jsonLd.publisher = { '@type': a.publisher.type || 'Organization', name: a.publisher.name };
            }
            if (a.datePublished) jsonLd.datePublished = repairDate(a.datePublished);
            if (a.dateModified) jsonLd.dateModified = repairDate(a.dateModified);
            if (a.description) jsonLd.description = a.description;

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
export function validate(data: ExtractionResult): ValidationSuccess | ValidationError {
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
        const jsonLd = buildJsonLd(data, repairs);

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
