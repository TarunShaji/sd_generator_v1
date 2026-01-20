# SEO Structured Data Generator

AI-powered pipeline that extracts Schema.org structured data (JSON-LD) from any webpage URL. Generates Google Rich Results-compliant markup for products, articles, recipes, events, and more.

## Features

- **Deterministic HTML Cleaning** — Removes scripts, ads, trackers, and boilerplate
- **Visibility Extraction** — AI surfaces short factual text (prices, ratings, SKUs)
- **Schema Extraction** — Maps visible content to Schema.org types
- **Auto-Validation** — Ensures required fields, repairs malformed values
- **Multi-Schema Support** — Product, Recipe, Article, Event, FAQ, HowTo, LocalBusiness

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PIPELINE FLOW                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  URL Input                                                          │
│      ↓                                                              │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Step 1: INGESTION (Playwright)                              │   │
│  │ • Stealth mode browsing                                     │   │
│  │ • Blocks images/fonts/CSS                                   │   │
│  │ • Auto-scroll for lazy content                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│      ↓ rawHtml                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Step 2: CLEANING (JSDOM)                                    │   │
│  │ • Remove <script>, <style>, hidden elements                 │   │
│  │ • Remove boilerplate (nav, footer, ads)                     │   │
│  │ • Extract headings, lists, tables, images, buttons          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│      ↓ cleanedHtml, visibleText                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Step 2.5: VISIBILITY EXTRACTION (AI)                        │   │
│  │ • Surfaces short factual text from cleanedHtml              │   │
│  │ • Prices, ratings, SKUs, availability, sizes                │   │
│  │ • Verbatim only — no inference                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│      ↓ facts[]                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Step 2.6: MERGE (Deterministic)                             │   │
│  │ • visibleTextPlus = facts + visibleText                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│      ↓ visibleTextPlus                                              │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Step 3: SCHEMA EXTRACTION (AI)                              │   │
│  │ • Claude 3.5 Haiku maps content to Schema.org               │   │
│  │ • Strict: no guessing, no inference                         │   │
│  │ • Returns structured object per detected type               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│      ↓ ExtractionResult                                             │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Step 4: VALIDATION                                          │   │
│  │ • Zod schema validation                                     │   │
│  │ • Required field checks                                     │   │
│  │ • Price/date/URL repairs                                    │   │
│  │ • Builds final JSON-LD                                      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│      ↓                                                              │
│  JSON-LD Output                                                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Supported Schema Types

| Type | Required Fields | Example URL |
|------|-----------------|-------------|
| **Product** | name | E-commerce product pages |
| **Recipe** | name | Cooking/recipe blogs |
| **Article** | headline | News, blog posts |
| **BlogPosting** | headline | Blog articles |
| **Event** | name, startDate | Event listings |
| **LocalBusiness** | name | Business/store pages |
| **FAQPage** | mainEntity | FAQ sections |
| **HowTo** | name | Tutorial/guide pages |
| **WebPage** | name | Generic fallback |

---

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **AI**: Claude 3.5 Haiku via Vercel AI SDK
- **Scraping**: Playwright with stealth mode
- **DOM Parsing**: JSDOM
- **Validation**: Zod schemas
- **Language**: TypeScript

---

## Getting Started

### Prerequisites

- Node.js 18+
- Anthropic API key

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd structured_data_fin

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env

# Install Playwright browsers
npx playwright install chromium
```

### Running

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and submit a URL.

---

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── page.tsx            # Main UI
│   └── api/generate/       # API endpoint
│
└── lib/
    ├── pipeline/           # Core pipeline modules
    │   ├── index.ts        # Pipeline orchestration
    │   ├── ingestion.ts    # Step 1: Playwright scraping
    │   ├── cleaning.ts     # Step 2: DOM cleaning
    │   ├── visibility-extractor.ts  # Step 2.5: Fact extraction
    │   ├── merge.ts        # Step 2.6: Text merge
    │   ├── extraction.ts   # Step 3: AI schema mapping
    │   └── validator.ts    # Step 4: Validation + JSON-LD
    │
    ├── schemas/
    │   └── definitions.ts  # Zod schemas for all types
    │
    └── logger.ts           # Structured logging

outputs/                    # Debug outputs (gitignored)
├── step1_raw_html_*.html
├── step2_cleaned_html_*.html
├── step2_visible_text_*.txt
├── step2_structured_data_*.json
├── step2.5_visibility_*.json
├── step3_extraction_*.json
└── step4_jsonld_*.json
```

---

## Output Example

```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Gymshark Critical Drop Arm Tank",
  "description": "Critical Drop Arm Tank for weight/strength training",
  "brand": {
    "@type": "Brand",
    "name": "Gymshark"
  },
  "offers": {
    "@type": "Offer",
    "price": 24,
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock"
  },
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": 4.2,
    "reviewCount": 187
  }
}
```

---

## API Usage

### POST `/api/generate`

```typescript
// Request
{
  "url": "https://example.com/product"
}

// Response
{
  "success": true,
  "jsonLd": { ... },
  "detectedType": "Product",
  "repairs": ["Repaired price: $24 → 24"],
  "stats": {
    "ingestionTimeMs": 2500,
    "cleaningTimeMs": 45,
    "visibilityTimeMs": 1200,
    "extractionTimeMs": 1800,
    "validationTimeMs": 5,
    "totalTimeMs": 5550
  }
}
```

---

## License

MIT
