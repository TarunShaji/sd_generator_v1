import { z } from 'zod';

// --- Shared Helpers ---
const numericString = z.union([z.number(), z.string()]).nullable().describe("Extract as-is. Repair logic will clean it later.");
const urlString = z.string().url().nullable().describe("Must be an absolute URL.");
const isoDate = z.string().nullable().describe("Prefer ISO 8601 format (YYYY-MM-DD).");
const personOrOrg = z.object({ type: z.enum(['Person', 'Organization']).nullable(), name: z.string().nullable(), url: urlString }).nullable();

// --- 1. Product (Enhanced) ---
// Covers Google Rich Results requirements + common real-world fields
const BrandSchema = z.object({
  name: z.string().nullable()
}).nullable();

const AggregateRatingSchema = z.object({
  ratingValue: numericString,
  reviewCount: numericString,
  bestRating: numericString,  // Usually 5
  worstRating: numericString  // Usually 1
}).nullable();

const OfferSchema = z.object({
  // REQUIRED fields
  price: numericString,
  priceCurrency: z.string().nullable(),
  availability: z.enum([
    'https://schema.org/InStock',
    'https://schema.org/OutOfStock',
    'https://schema.org/PreOrder',
    'https://schema.org/SoldOut',
    'https://schema.org/BackOrder',
    'https://schema.org/Discontinued',
    'https://schema.org/LimitedAvailability'
  ]).nullable(),

  // RECOMMENDED fields
  url: urlString,
  priceValidUntil: isoDate,
  itemCondition: z.enum([
    'https://schema.org/NewCondition',
    'https://schema.org/UsedCondition',
    'https://schema.org/RefurbishedCondition',
    'https://schema.org/DamagedCondition'
  ]).nullable(),

  // Additional useful fields
  sku: z.string().nullable(),
  seller: z.object({ name: z.string().nullable() }).nullable(),
  shippingDetails: z.object({
    shippingRate: z.object({
      value: numericString,
      currency: z.string().nullable()
    }).nullable(),
    deliveryTime: z.object({
      minValue: numericString,
      maxValue: numericString,
      unitCode: z.string().nullable()  // e.g., "DAY"
    }).nullable()
  }).nullable(),
  hasMerchantReturnPolicy: z.object({
    returnPolicyCategory: z.enum([
      'https://schema.org/MerchantReturnFiniteReturnWindow',
      'https://schema.org/MerchantReturnNotPermitted',
      'https://schema.org/MerchantReturnUnlimitedWindow'
    ]).nullable(),
    merchantReturnDays: numericString
  }).nullable()
}).nullable();

const ProductSchema = z.object({
  // REQUIRED
  name: z.string().nullable(),
  image: z.array(z.string()).nullable(),

  // RECOMMENDED  
  description: z.string().nullable(),
  brand: BrandSchema,
  offers: z.union([OfferSchema, z.array(OfferSchema)]).nullable(),
  aggregateRating: AggregateRatingSchema,

  // Identifiers (important for e-commerce)
  sku: z.string().nullable(),
  gtin: z.string().nullable(),        // GTIN-8, GTIN-12 (UPC), GTIN-13 (EAN), GTIN-14
  mpn: z.string().nullable(),         // Manufacturer Part Number
  productID: z.string().nullable(),   // Generic product ID

  // Product variants/attributes
  color: z.string().nullable(),
  size: z.string().nullable(),
  material: z.string().nullable(),
  pattern: z.string().nullable(),

  // Physical properties
  weight: z.object({
    value: numericString,
    unitCode: z.string().nullable()   // e.g., "KGM", "LBR"
  }).nullable(),

  // Category
  category: z.string().nullable(),     // Product category/type

  // Reviews
  review: z.array(z.object({
    author: z.object({ name: z.string().nullable() }).nullable(),
    reviewRating: z.object({
      ratingValue: numericString,
      bestRating: numericString
    }).nullable(),
    reviewBody: z.string().nullable(),
    datePublished: isoDate
  })).nullable()
});


// --- 2. Recipe ---
const RecipeSchema = z.object({
  name: z.string().nullable(),
  image: z.array(z.string()).nullable(),
  author: personOrOrg,
  datePublished: isoDate,
  prepTime: z.string().nullable(),
  cookTime: z.string().nullable(),
  totalTime: z.string().nullable(),
  recipeYield: z.string().nullable(),
  nutrition: z.object({ calories: z.string().nullable(), proteinContent: z.string().nullable() }).nullable(),
  recipeIngredient: z.array(z.string()).nullable(),
  recipeInstructions: z.array(z.object({ type: z.literal("HowToStep").default("HowToStep"), text: z.string().nullable() })).nullable()
});

// --- 3. Event ---
const EventSchema = z.object({
  name: z.string().nullable(),
  startDate: isoDate,
  endDate: isoDate,
  eventStatus: z.enum(['https://schema.org/EventScheduled', 'https://schema.org/EventCancelled', 'https://schema.org/EventMovedOnline', 'https://schema.org/EventPostponed']).nullable(),
  location: z.object({ name: z.string().nullable(), address: z.object({ streetAddress: z.string().nullable(), addressLocality: z.string().nullable(), addressCountry: z.string().nullable() }).nullable() }).nullable(),
  offers: z.object({ price: numericString, priceCurrency: z.string().nullable(), url: urlString }).nullable()
});

// --- 4. Local Business ---
const LocalBusinessSchema = z.object({
  name: z.string().nullable(),
  image: z.array(z.string()).nullable(),
  telephone: z.string().nullable(),
  address: z.object({ streetAddress: z.string().nullable(), addressLocality: z.string().nullable(), addressRegion: z.string().nullable(), postalCode: z.string().nullable() }).nullable(),
  geo: z.object({ latitude: numericString, longitude: numericString }).nullable(),
  openingHours: z.array(z.string()).nullable(),
  priceRange: z.string().nullable()
});

// --- 5. Article (Enhanced) ---
// Supports E-E-A-T requirements, Google News, and rich snippets
// Simplified for AI compatibility while keeping all enhanced fields

const ArticleSchema = z.object({
  // HEADLINES & DESCRIPTION
  headline: z.string().nullable(),
  alternativeHeadline: z.string().nullable(),
  description: z.string().nullable(),

  // IMAGES (simplified - array of URLs)
  image: z.array(z.string()).nullable(),

  // E-E-A-T: AUTHORSHIP (simplified - single author or first author for multi-author)
  author: z.object({
    type: z.enum(['Person', 'Organization']).nullable(),
    name: z.string().nullable(),
    url: urlString
  }).nullable(),

  // Additional authors for co-authored articles
  additionalAuthors: z.array(z.object({
    type: z.enum(['Person', 'Organization']).nullable(),
    name: z.string().nullable(),
    url: urlString
  })).nullable(),

  // PUBLISHER
  publisher: z.object({
    name: z.string().nullable(),
    logoUrl: urlString,
    logoWidth: numericString,
    logoHeight: numericString
  }).nullable(),

  // DATES
  datePublished: isoDate,
  dateModified: isoDate,

  // CONTENT METRICS & CATEGORIES
  articleSection: z.string().nullable(),  // Primary category
  keywords: z.array(z.string()).nullable(),
  wordCount: numericString,

  // PAYWALL / ACCESS
  isAccessibleForFree: z.boolean().nullable(),

  // SEO TECHNICALS
  mainEntityOfPage: urlString,

  // ADDITIONAL USEFUL FIELDS
  inLanguage: z.string().nullable(),
  copyrightHolder: z.string().nullable(),
  copyrightYear: numericString,
  thumbnailUrl: urlString
});

// --- 6. FAQ Page ---
const FAQSchema = z.object({
  mainEntity: z.array(z.object({ type: z.literal("Question").default("Question"), name: z.string().nullable(), acceptedAnswer: z.object({ type: z.literal("Answer").default("Answer"), text: z.string().nullable() }).nullable() })).nullable()
});

// --- 7. How-To ---
const HowToSchema = z.object({
  name: z.string().nullable(),
  step: z.array(z.object({ type: z.literal("HowToStep").default("HowToStep"), url: urlString, name: z.string().nullable(), text: z.string().nullable(), image: urlString })).nullable(),
  totalTime: z.string().nullable(),
  tool: z.array(z.object({ name: z.string().nullable() })).nullable(),
  supply: z.array(z.object({ name: z.string().nullable() })).nullable()
});

// --- 8. Fallback: WebPage ---
const WebPageSchema = z.object({
  name: z.string().nullable(),
  description: z.string().nullable(),
  datePublished: isoDate,
  dateModified: isoDate,
  breadcrumb: z.array(z.string()).nullable()
});

// --- MASTER CONTAINER ---
export const ExtractionSchema = z.object({
  detectedType: z.enum(['Product', 'Recipe', 'Event', 'LocalBusiness', 'FAQPage', 'Article', 'BlogPosting', 'HowTo', 'WebPage']),
  product: ProductSchema.nullable(),
  recipe: RecipeSchema.nullable(),
  event: EventSchema.nullable(),
  localBusiness: LocalBusinessSchema.nullable(),
  faq: FAQSchema.nullable(),
  article: ArticleSchema.nullable(),
  blogPosting: ArticleSchema.nullable(),
  howto: HowToSchema.nullable(),
  webPage: WebPageSchema.nullable()
});

// Export types for use in other modules
export type ExtractionResult = z.infer<typeof ExtractionSchema>;
export type Product = z.infer<typeof ProductSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
export type Event = z.infer<typeof EventSchema>;
export type LocalBusiness = z.infer<typeof LocalBusinessSchema>;
export type Article = z.infer<typeof ArticleSchema>;
export type FAQ = z.infer<typeof FAQSchema>;
export type HowTo = z.infer<typeof HowToSchema>;
export type WebPage = z.infer<typeof WebPageSchema>;
export type DetectedType = ExtractionResult['detectedType'];
