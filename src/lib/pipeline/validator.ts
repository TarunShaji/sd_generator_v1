/**
 * Pipeline Step 4: Validator (Multi-Entity)
 * 
 * FINAL AUTHORITY - Deterministic only.
 * Validates and builds JSON-LD for MULTIPLE entities.
 * NEVER calls AI, NEVER infers, NEVER coerces null.
 */

import { logger } from '../logger';
import { type MultiEntityResult, type EntityTypeName } from '../schemas/definitions';

// Type alias for a single entity from the schemas array
type Entity = MultiEntityResult['schemas'][number];

export interface RejectedEntity {
    '@type': EntityTypeName;
    reason: string;
}

export interface ValidationSuccess {
    success: true;
    acceptedEntities: object[];  // Array of valid JSON-LD objects
    rejectedEntities: RejectedEntity[];  // Array of rejected entities with reasons
    jsonLd: object[];  // Backward compatibility alias for acceptedEntities
    entityTypes: EntityTypeName[];  // Types of accepted entities only
    repairs: string[];
}

export interface ValidationError {
    success: false;
    stage: 'validator';
    reason: string;
}

// Required fields per entity type (Google Rich Results requirements)
const REQUIRED_FIELDS: Partial<Record<EntityTypeName, string[]>> = {
    Product: ['name'],
    Recipe: ['name'],
    Event: ['name'],
    LocalBusiness: ['name'],
    Article: ['headline'],
    BlogPosting: ['headline'],
    FAQPage: [],
    HowTo: ['name'],
    WebPage: ['name'],
    WebSite: ['name'],
    ItemList: ['itemListElement'],
    VideoObject: ['name'],
    Organization: ['name']
};

/**
 * Repair price values - extract numeric value
 */
function repairPrice(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined) return null;

    const str = String(value);
    const match = str.match(/[\d,]+\.?\d*/);
    if (match) {
        const cleaned = match[0].replace(/,(?=\d{3})/g, '').replace(',', '.');
        const num = parseFloat(cleaned);
        if (!isNaN(num)) return num;
    }
    return null;
}

/**
 * Repair URL - ensure absolute URL
 */
function repairUrl(url: string | null | undefined, baseUrl?: string): string | null {
    if (!url) return null;

    try {
        // Handle protocol-relative URLs
        if (url.startsWith('//')) {
            const absoluteUrl = 'https:' + url;
            new URL(absoluteUrl);
            return absoluteUrl;
        }

        // Already absolute
        if (url.startsWith('http://') || url.startsWith('https://')) {
            new URL(url);
            return url;
        }

        // Relative URL - resolve against base
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
 * Repair date - normalize to ISO 8601
 */
function repairDate(date: string | null | undefined): string | null {
    if (!date) return null;

    try {
        const parsed = new Date(date);
        if (!isNaN(parsed.getTime())) {
            return parsed.toISOString().split('T')[0];
        }
    } catch { /* ignore */ }

    return date;
}

/**
 * Check required fields for an entity
 */
function checkRequiredFields(entity: Entity): string | null {
    const type = entity['@type'];
    const required = REQUIRED_FIELDS[type] || [];

    for (const field of required) {
        const value = entity[field as keyof Entity];
        if (value === null || value === undefined || value === '') {
            return `Missing required field: ${type}.${field}`;
        }
        if (Array.isArray(value) && value.length === 0) {
            return `Empty required field: ${type}.${field}`;
        }
    }

    return null;
}

/**
 * Build JSON-LD for a single entity
 */
function buildEntityJsonLd(entity: Entity, pageUrl?: string, repairs: string[] = []): object {
    const type = entity['@type'];

    // Base JSON-LD structure
    const jsonLd: Record<string, unknown> = {
        '@context': 'https://schema.org',
        '@type': type
    };

    // Map common fields
    if (entity.name) jsonLd.name = entity.name;
    if (entity.description) jsonLd.description = entity.description;
    if (entity.url) jsonLd.url = repairUrl(entity.url, pageUrl);

    // Type-specific handling
    switch (type) {
        case 'Product': {
            if (entity.image?.length) {
                jsonLd.image = entity.image.map(img => repairUrl(img, pageUrl)).filter(Boolean);
            }
            if (entity.brand) jsonLd.brand = { '@type': 'Brand', ...entity.brand };
            if (entity.sku) jsonLd.sku = entity.sku;
            if (entity.gtin) jsonLd.gtin = entity.gtin;
            if (entity.aggregateRating) {
                const ar = entity.aggregateRating;
                jsonLd.aggregateRating = {
                    '@type': 'AggregateRating',
                    ratingValue: repairPrice(ar.ratingValue),
                    reviewCount: repairPrice(ar.reviewCount),
                    bestRating: repairPrice(ar.bestRating) || 5,
                    worstRating: repairPrice(ar.worstRating) || 1
                };
            }
            if (entity.offers) {
                const offers = Array.isArray(entity.offers) ? entity.offers : [entity.offers];
                jsonLd.offers = offers.filter(Boolean).map(offer => {
                    if (!offer) return null;
                    const o: Record<string, unknown> = { '@type': 'Offer' };
                    const price = repairPrice(offer.price);
                    if (price !== null) {
                        o.price = price;
                        if (!offer.price?.toString().match(/^\d/)) {
                            repairs.push(`Cleaned price: ${offer.price} → ${price}`);
                        }
                    }
                    if (offer.priceCurrency) o.priceCurrency = offer.priceCurrency;
                    if (offer.availability) o.availability = offer.availability;
                    if (offer.url) o.url = repairUrl(offer.url, pageUrl);
                    return o;
                }).filter(Boolean);
            }
            break;
        }

        case 'Organization': {
            if (entity.logo) jsonLd.logo = repairUrl(entity.logo, pageUrl);
            if (entity.sameAs?.length) jsonLd.sameAs = entity.sameAs;
            break;
        }

        case 'WebSite': {
            if (entity.potentialAction?.target) {
                jsonLd.potentialAction = {
                    '@type': 'SearchAction',
                    target: entity.potentialAction.target,
                    'query-input': entity.potentialAction.queryInput || 'required name=search_term_string'
                };
            }
            break;
        }

        case 'ItemList': {
            if (entity.numberOfItems) jsonLd.numberOfItems = repairPrice(entity.numberOfItems);
            if (entity.itemListElement?.length) {
                jsonLd.itemListElement = entity.itemListElement.map((item, index) => ({
                    '@type': 'ListItem',
                    position: item.position ?? index + 1,
                    url: repairUrl(item.url, pageUrl),
                    name: item.name
                }));
            }
            break;
        }

        case 'Article':
        case 'BlogPosting': {
            if (entity.headline) jsonLd.headline = entity.headline;
            if (entity.image?.length) {
                jsonLd.image = entity.image.map(img => repairUrl(img, pageUrl)).filter(Boolean);
            }
            if (entity.author) {
                jsonLd.author = {
                    '@type': entity.author.type || 'Person',
                    name: entity.author.name,
                    url: repairUrl(entity.author.url, pageUrl)
                };
            }
            if (entity.publisher) {
                jsonLd.publisher = {
                    '@type': 'Organization',
                    name: entity.publisher.name,
                    logo: entity.publisher.logoUrl ? {
                        '@type': 'ImageObject',
                        url: repairUrl(entity.publisher.logoUrl, pageUrl)
                    } : undefined
                };
            }
            if (entity.datePublished) jsonLd.datePublished = repairDate(entity.datePublished);
            if (entity.dateModified) jsonLd.dateModified = repairDate(entity.dateModified);
            break;
        }

        case 'VideoObject': {
            if (entity.thumbnailUrl) jsonLd.thumbnailUrl = repairUrl(entity.thumbnailUrl, pageUrl);
            if (entity.uploadDate) jsonLd.uploadDate = repairDate(entity.uploadDate);
            if (entity.duration) jsonLd.duration = entity.duration;
            if (entity.contentUrl) jsonLd.contentUrl = repairUrl(entity.contentUrl, pageUrl);
            if (entity.embedUrl) jsonLd.embedUrl = repairUrl(entity.embedUrl, pageUrl);
            break;
        }
    }

    return jsonLd;
}

/**
 * Validate and build final JSON-LD output for all entities
 */
export function validateMultiEntity(
    data: MultiEntityResult,
    pageUrl?: string
): ValidationSuccess | ValidationError {
    const log = logger.scoped('Validator');
    const repairs: string[] = [];

    try {
        log.info('Starting multi-entity validation', {
            entityCount: data.schemas.length,
            entityTypes: data.schemas.map(s => s['@type'])
        });

        // Validate each entity - track accepted and rejected separately
        const acceptedEntities: object[] = [];
        const rejectedEntities: RejectedEntity[] = [];
        const entityTypes: EntityTypeName[] = [];

        for (const entity of data.schemas) {
            const type = entity['@type'];

            // Check required fields
            const requiredError = checkRequiredFields(entity);
            if (requiredError) {
                // Track rejection with reason
                rejectedEntities.push({
                    '@type': type,
                    reason: requiredError
                });
                log.warn('Entity rejected', { type, reason: requiredError });
                continue; // Skip this entity, don't fail entire validation
            }

            // Build JSON-LD for this entity
            const jsonLd = buildEntityJsonLd(entity, pageUrl, repairs);
            acceptedEntities.push(jsonLd);
            entityTypes.push(type);
        }

        // Fail only if ZERO entities were accepted
        if (acceptedEntities.length === 0) {
            return {
                success: false,
                stage: 'validator',
                reason: 'No valid entities after validation'
            };
        }

        log.info('Multi-entity validation complete', {
            acceptedEntities: acceptedEntities.length,
            rejectedEntities: rejectedEntities.length,
            entityTypes,
            repairsCount: repairs.length
        });

        return {
            success: true,
            acceptedEntities,
            rejectedEntities,
            jsonLd: acceptedEntities, // Backward compatibility alias
            entityTypes,
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

// Keep legacy export for backwards compatibility during transition
export { validateMultiEntity as validate };
