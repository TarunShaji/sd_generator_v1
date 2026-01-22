import { z } from 'zod';

// ============================================================================
// SCHEMA CONTRACTS (Extraction Stage)
// ============================================================================
// These define the "shape" of data we want the AI to look for.
// They are NOT validators. They are contracts.
//
// RULES:
// 1. All fields must be optional/nullable (never crash on missing data).
// 2. All schemas must be .passthrough() (never crash on extra fields).
// 3. Types should be loose (string | number for numbers, string for URLs).
// 4. Strict validation belongs in the Validator (Step 4), not here.

// --- Core Primitives (Loose) ---
const CoreString = z.string().nullable().optional();
const CoreNumber = z.union([z.number(), z.string()]).nullable().optional();
const CoreUrl = z.string().nullable().optional(); // Accepts relative URLs
const CoreDate = z.string().nullable().optional(); // Accepts any date string
const CoreBoolean = z.boolean().nullable().optional();

// --- Shared Helpers (Contracts) ---
const BrandContract = z.object({
  '@type': z.string().optional(),
  name: CoreString
}).passthrough().nullable().optional();

const OrganizationContract = z.object({
  '@type': z.string().optional(),
  name: CoreString,
  url: CoreUrl,
  logo: CoreUrl,
  sameAs: z.array(z.string()).nullable().optional()
}).passthrough().nullable().optional();

const PersonOrOrgContract = z.union([
  OrganizationContract,
  z.object({
    '@type': z.string().optional(),
    name: CoreString,
    url: CoreUrl
  }).passthrough()
]).nullable().optional();

const ImageContract = z.union([
  CoreUrl,
  z.array(z.string()),
  z.object({ url: CoreUrl }).passthrough()
]).nullable().optional();

const OfferContract = z.object({
  '@type': z.string().optional(),
  price: CoreNumber,
  priceCurrency: CoreString,
  availability: CoreString, // "InStock" or "https://schema.org/InStock"
  url: CoreUrl,
  priceValidUntil: CoreDate,
  itemCondition: CoreString,
  sku: CoreString,
  seller: OrganizationContract
}).passthrough().nullable().optional();

const AggregateRatingContract = z.object({
  '@type': z.string().optional(),
  ratingValue: CoreNumber,
  reviewCount: CoreNumber,
  bestRating: CoreNumber,
  worstRating: CoreNumber
}).passthrough().nullable().optional();

// ============================================================================
// ENTITY CONTRACTS
// ============================================================================

// 1. Product Contract
// We list fields to "hint" to the AI what we care about, but .passthrough() allows anything.
const ProductContract = z.object({
  '@type': z.literal('Product'),
  name: CoreString,
  description: CoreString,
  image: ImageContract,
  brand: BrandContract,
  offers: z.union([OfferContract, z.array(OfferContract)]).nullable().optional(),
  aggregateRating: AggregateRatingContract,
  sku: CoreString,
  gtin: CoreString,
  mpn: CoreString
}).passthrough();

// 2. Article / BlogPosting Contract
const ArticleContract = z.object({
  '@type': z.enum(['Article', 'BlogPosting', 'NewsArticle']),
  headline: CoreString,
  name: CoreString, // Alias for headline
  description: CoreString,
  image: ImageContract,
  author: PersonOrOrgContract,
  publisher: OrganizationContract,
  datePublished: CoreDate,
  dateModified: CoreDate,
  mainEntityOfPage: CoreUrl
}).passthrough();

// 3. Organization Contract (Top-level)
const OrganizationEntityContract = z.object({
  '@type': z.enum(['Organization', 'Corporation', 'LocalBusiness', 'Store', 'Restaurant']),
  name: CoreString,
  url: CoreUrl,
  logo: ImageContract,
  description: CoreString,
  sameAs: z.array(z.string()).nullable().optional(),
  contactPoint: z.any().optional(),
  address: z.any().optional()
}).passthrough();

// 4. ItemList Contract (Collections)
const ItemListContract = z.object({
  '@type': z.literal('ItemList'),
  name: CoreString,
  description: CoreString,
  numberOfItems: CoreNumber,
  itemListElement: z.array(
    z.object({
      '@type': z.literal('ListItem').optional(),
      position: CoreNumber,
      url: CoreUrl, // Allows relative
      name: CoreString,
      image: ImageContract
    }).passthrough()
  ).nullable().optional()
}).passthrough();

// 5. Recipe Contract
const RecipeContract = z.object({
  '@type': z.literal('Recipe'),
  name: CoreString,
  description: CoreString,
  image: ImageContract,
  author: PersonOrOrgContract,
  cookTime: CoreString,
  prepTime: CoreString,
  totalTime: CoreString,
  recipeYield: CoreString,
  recipeIngredient: z.array(z.string()).nullable().optional(),
  recipeInstructions: z.array(z.any()).nullable().optional(),
  aggregateRating: AggregateRatingContract,
  nutrition: z.any().optional()
}).passthrough();

// 6. Review Contract
const ReviewContract = z.object({
  '@type': z.literal('Review'),
  author: PersonOrOrgContract,
  reviewRating: AggregateRatingContract,
  reviewBody: CoreString,
  datePublished: CoreDate
}).passthrough();

// 7. VideoObject Contract
const VideoObjectContract = z.object({
  '@type': z.literal('VideoObject'),
  name: CoreString,
  description: CoreString,
  thumbnailUrl: ImageContract,
  uploadDate: CoreDate,
  duration: CoreString,
  contentUrl: CoreUrl,
  embedUrl: CoreUrl
}).passthrough();

// 8. FAQPage Contract
const FAQPageContract = z.object({
  '@type': z.literal('FAQPage'),
  mainEntity: z.array(
    z.object({
      '@type': z.literal('Question'),
      name: CoreString,
      acceptedAnswer: z.object({
        '@type': z.literal('Answer'),
        text: CoreString
      }).passthrough().nullable().optional()
    }).passthrough()
  ).nullable().optional()
}).passthrough();

// 9. WebSite Contract (Search Action)
const WebSiteContract = z.object({
  '@type': z.literal('WebSite'),
  name: CoreString,
  url: CoreUrl,
  potentialAction: z.any().optional() // Allow any search action structure
}).passthrough();

// 10. BreadcrumbList Contract
const BreadcrumbListContract = z.object({
  '@type': z.literal('BreadcrumbList'),
  itemListElement: z.array(z.any()).nullable().optional()
}).passthrough();


// ============================================================================
// MASTER EXTRACTOR SCHEMA
// ============================================================================

// This is the container we ask the AI to fill.
// It allows a list of ANY of our contracts.
export const MultiEntityExtractionSchema = z.object({
  schemas: z.array(
    z.union([
      ProductContract,
      ArticleContract,
      OrganizationEntityContract,
      ItemListContract,
      RecipeContract,
      ReviewContract,
      VideoObjectContract,
      FAQPageContract,
      WebSiteContract,
      BreadcrumbListContract,
      // Fallback for any other valid Schema.org type
      z.object({
        '@type': z.string()
      }).passthrough()
    ])
  )
});


// ============================================================================
// EXPORTED TYPES (For internal use in Pipeline)
// ============================================================================

export type MultiEntityResult = z.infer<typeof MultiEntityExtractionSchema>;
// export type EntityTypeName = MultiEntityResult['schemas'][number]['@type']; 
// Use a broader string type since we allow passthrough
export type EntityTypeName = string;

// Re-export specific schemas if needed by other components (e.g. Validator)
// Note: Validator should ideally use its own strict schemas, but can use these for loose typing.
export {
  ProductContract as ProductSchema,
  ArticleContract as ArticleSchema,
  OrganizationEntityContract as OrganizationSchema,
  ItemListContract as ItemListSchema,
  RecipeContract as RecipeSchema,
  FAQPageContract as FAQSchema,
  WebSiteContract as WebSiteSchema,
  VideoObjectContract as VideoObjectSchema,
  BrandContract as BrandSchema,
  OfferContract as OfferSchema,
  AggregateRatingContract as AggregateRatingSchema
};
