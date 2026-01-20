import { z } from 'zod';

// --- Shared Helpers ---
const numericString = z.union([z.number(), z.string()]).nullable().describe("Extract as-is. Repair logic will clean it later.");
const urlString = z.string().url().nullable().describe("Must be an absolute URL.");
const isoDate = z.string().nullable().describe("Prefer ISO 8601 format (YYYY-MM-DD).");
const personOrOrg = z.object({ type: z.enum(['Person', 'Organization']).nullable(), name: z.string().nullable(), url: urlString }).nullable();

// --- 1. Product ---
const ProductSchema = z.object({
  name: z.string().nullable(),
  description: z.string().nullable(),
  image: z.array(z.string()).nullable(),
  sku: z.string().nullable(),
  gtin: z.string().nullable(),
  brand: z.object({ name: z.string().nullable() }).nullable(),
  offers: z.object({
    price: numericString,
    priceCurrency: z.string().nullable(),
    availability: z.enum(['https://schema.org/InStock', 'https://schema.org/OutOfStock', 'https://schema.org/PreOrder', 'https://schema.org/SoldOut']).nullable(),
    url: urlString
  }).nullable(),
  aggregateRating: z.object({ ratingValue: numericString, reviewCount: numericString }).nullable()
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

// --- 5. Article ---
const ArticleSchema = z.object({
  headline: z.string().nullable(),
  image: z.array(z.string()).nullable(),
  author: personOrOrg,
  publisher: personOrOrg,
  datePublished: isoDate,
  dateModified: isoDate,
  description: z.string().nullable()
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
