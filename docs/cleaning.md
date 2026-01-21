# Pipeline Deep Dive: From HTML to AI Extraction

This document explains in detail what happens from raw HTML through cleaning to what the AI extraction agent receives.

---

## 🔄 High-Level Flow

```
URL → Ingestion → Raw HTML → Cleaning → Multiple Outputs → Flatten → Visibility AI → Merge → Extraction AI
```

---

## Step 1: Ingestion (`ingestion.ts`)

**Input:** URL (e.g., `https://addjoi.com/products/organic-almond-base-2-pack`)

**Process:**
1. Launches headless Chromium browser with stealth mode
2. Blocks images, fonts, CSS for faster loading
3. Navigates to URL, waits for DOM content
4. Auto-scrolls to trigger lazy-loaded content
5. Captures full HTML with `page.content()`

**Output:** `step1_raw_html_*.html` (~1.6MB for Addjoi)

---

## Step 2: Cleaning (`cleaning.ts`)

This is where the HTML is processed to create **multiple outputs**. Let me explain each part:

### 📥 Input
- `rawHtml`: The complete HTML from Step 1 (1.6MB)

### 🔧 Processing Steps

#### Step 2.1: Parse HTML into DOM
```typescript
const dom = new JSDOM(rawHtml, { virtualConsole });
const document = dom.window.document;
```
Creates a server-side DOM tree we can query with `querySelectorAll`.

#### Step 2.2: Remove Dangerous Elements
```typescript
['script', 'style', 'noscript', 'iframe', 'svg', 'canvas', 'video', 'audio'].forEach(tag => {
    document.querySelectorAll(tag).forEach(el => el.remove());
});
```
Removes ~650 elements that are JavaScript, CSS, or media — not content.

#### Step 2.3: Remove Hidden Elements
```typescript
['[aria-hidden="true"]', '[hidden]', '.hidden', '.sr-only', '[style*="display: none"]'].forEach(selector => {
    document.querySelectorAll(selector).forEach(el => el.remove());
});
```
Removes ~145 elements that users can't see.

#### Step 2.4: Remove Boilerplate
```typescript
['nav', 'header', 'footer', 'aside', '.cookie-banner', '.ads', '.social-share'].forEach(selector => {
    document.querySelectorAll(selector).forEach(el => el.remove());
});
```
Removes ~14 navigation, footer, cookie banners — page chrome, not content.

#### Step 2.5: Extract Structured Data

**Headings:**
```typescript
for (let i = 1; i <= 6; i++) {
    document.querySelectorAll(`h${i}`).forEach(el => {
        headings.push({ level: i, text: el.textContent.trim() });
    });
}
```
Result: 36 heading objects like `{ level: 1, text: "Organic Almond Milk Base 2-Pack" }`

**Lists:**
```typescript
document.querySelectorAll('ul, ol').forEach(list => {
    const items = Array.from(list.querySelectorAll('li')).map(li => li.textContent.trim());
    lists.push({ type: 'ordered' | 'unordered', items });
});
```
Result: 6 list objects

**Images:**
```typescript
document.querySelectorAll('img').forEach(img => {
    images.push({ src: img.getAttribute('src'), alt: img.getAttribute('alt') });
});
```
Result: 46 image objects

**Tables:**
```typescript
document.querySelectorAll('table').forEach(table => { ... });
```
Result: 0 tables (Addjoi doesn't use tables)

**Buttons:**
```typescript
document.querySelectorAll('button, [role="button"], .btn').forEach(btn => {
    buttons.push({ text: btn.textContent.trim() });
});
```
Result: 26 button objects

#### Step 2.6: Generate `cleanedHtml`
```typescript
const cleanedHtml = document.body.innerHTML;
```
The remaining HTML after all removals. Saved as `step2_cleaned_html_*.html` (~162KB, down from 1.6MB).

#### Step 2.7: Generate `visibleText` ⚠️ CRITICAL
```typescript
const MIN_PARAGRAPH_LENGTH = 20;
const visibleTextParts = [];

// Add headings
headings.forEach(h => visibleTextParts.push(h.text));

// Add paragraphs (only if ≥20 characters)
document.querySelectorAll('p').forEach(p => {
    const text = p.textContent.trim();
    if (text && text.length >= MIN_PARAGRAPH_LENGTH) {
        visibleTextParts.push(text);
    }
});

// Add list items (only if ≥20 characters)
lists.forEach(list => {
    list.items.forEach(item => {
        if (item.length >= MIN_PARAGRAPH_LENGTH) {
            visibleTextParts.push(item);
        }
    });
});

const visibleText = visibleTextParts.join('\n\n');
```

**This is why short content gets lost!**
- `"$26.24"` (6 chars) → ❌ Filtered out
- `"4.7 out of 5 stars"` (18 chars) → ❌ Filtered out
- `"Organic Almond Milk Base 2-Pack"` (32 chars) → ✅ Included

### 📤 Outputs from Cleaning

| Output File | Contents | Size |
|-------------|----------|------|
| `step2_cleaned_html_*.html` | HTML with junk removed | ~162KB |
| `step2_visible_text_*.txt` | Plain text (headings + paragraphs ≥20 chars) | ~10KB |
| `step2_structured_data_*.json` | `{ headings, lists, tables, images, buttons }` | ~8KB |

---

## Step 2.4: Flatten (`flatten.ts`)

**Purpose:** Reduce token usage by converting HTML to plain text.

**Input:** `cleanedHtml` (162KB)

**Process:**
```typescript
// Walk through all text nodes
const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
while (walker.nextNode()) {
    const text = walker.currentNode.textContent.trim();
    if (text) textParts.push(text);
}
// Also extract aria-label, title, alt attributes
```

**Output:** `step2.4_flattened_*.txt` (~11KB, 93% reduction)

This is **NOT** what goes to the extraction AI — it goes to the visibility extractor.

---

## Step 2.5: Visibility Extraction (`visibility-extractor.ts`)

**Purpose:** Find short, factual strings that the cleaning step missed (prices, ratings, etc.).

**Input:** Flattened text (11KB)

**Process:** Sends to Claude 3.5 Haiku with this prompt:
```
Extract short, factual, user-visible strings from the content.
Focus on: prices, ratings, dates, numbers, names, brands...
Return as JSON array of strings.
```

**Output:** `step2.5_visibility_*.json`
```json
{
  "facts": [
    "Organic Almond Milk Base 2-Pack",
    "4.7 out 5 stars rating in total 2064 reviews",
    "$26.24",
    "$42.61",
    "15 oz ea / Makes 14 quarts",
    "54 servings",
    ...
  ]
}
```

Notice: **The price `$26.24` that was filtered out in cleaning is now captured!**

---

## Step 2.6: Merge (`merge.ts`)

**Purpose:** Combine visibility facts with original visibleText.

**Input:** 
- `facts[]` from visibility extractor
- `visibleText` from cleaning

**Process:**
```typescript
const visibleTextPlus = facts.join('\n') + '\n\n' + visibleText;
```

**Output:** Enhanced `visibleTextPlus` saved as `step2_visible_text_*.txt`

The file now looks like:
```
UP TO 18% OFF & FREE SHIPPING ON SUBSCRIPTIONS
Organic Almond Milk Base 2-Pack
4.7 out 5 stars rating in total 2064 reviews
$26.24
$42.61
54 servings
...

[Original visibleText from cleaning starts here]
Organic Almond Milk Base 2-Pack
...
```

---

## What Gets Sent to Extraction AI

The extraction AI (`extraction.ts`) receives an **enhanced CleaningResult** object:

```typescript
const enhancedCleaning = {
    cleanedHtml: "...",        // Not used in prompt
    visibleText: visibleTextPlus,  // ← The merged text with visibility facts!
    headings: [...],           // Array of heading objects
    lists: [...],              // Array of list objects
    tables: [...],             // Array of table objects
    images: [...],             // Array of image objects
    buttons: [...],            // Array of button objects
    stats: { ... }
};
```

### The Actual Prompt Built

```typescript
function buildUserPrompt(cleaningResult, pageUrl) {
    const parts = [];
    
    parts.push(`URL: ${pageUrl}`);
    
    // Add headings
    parts.push('## HEADINGS');
    cleaningResult.headings.forEach(h => {
        parts.push(`${'#'.repeat(h.level)} ${h.text}`);
    });
    
    // Add main text content ← THIS IS visibleTextPlus!
    parts.push('## MAIN CONTENT');
    parts.push(cleaningResult.visibleText);
    
    // Add tables
    if (cleaningResult.tables.length > 0) { ... }
    
    // Add images
    parts.push('## IMAGES');
    cleaningResult.images.forEach(img => {
        parts.push(`- ${img.src}${img.alt ? ` (alt: ${img.alt})` : ''}`);
    });
    
    // Add lists
    parts.push('## LISTS');
    cleaningResult.lists.forEach(list => { ... });
    
    parts.push('Extract the structured data from the above content...');
    
    return parts.join('\n');
}
```

### Example Prompt Sent to Claude

```
URL: https://addjoi.com/products/organic-almond-base-2-pack

## HEADINGS
# Organic Almond Milk Base 2-Pack
## Just Almonds — That's It
## Customer Reviews
...

## MAIN CONTENT
UP TO 18% OFF & FREE SHIPPING ON SUBSCRIPTIONS
Organic Almond Milk Base 2-Pack
4.7 out 5 stars rating in total 2064 reviews
$26.24
$42.61
15 oz ea / Makes 14 quarts
54 servings
Estimated delivery January 24 - 26
100% money-back guarantee
...

## IMAGES
- //addjoi.com/cdn/shop/files/2P_OG-ALM_1024x1024.png?v=1762530817
- //addjoi.com/cdn/shop/files/OGALMOND4_200x200.png?v=1749489902
...

## LISTS
List 1 (unordered):
- Just Almonds
- That's It
...

Extract the structured data from the above content. Choose the most specific schema type.
```

---

## Why Extraction Sometimes Fails

The error `"No object generated: response did not match schema"` happens when:

1. **Claude returns invalid JSON** — malformed or missing required fields
2. **Enum mismatch** — AI uses a value not in the allowed list
3. **Complex union types** — AI gets confused by `offers` being single or array
4. **Rate limiting** — Response gets truncated

The Zod schema is strict — if even one field doesn't match exactly, validation fails.

---

## Summary Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         STEP 1: INGESTION                                   │
│  URL → Playwright Browser → Raw HTML (1.6MB)                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         STEP 2: CLEANING                                    │
│  Raw HTML (1.6MB)                                                          │
│       │                                                                     │
│       ├── Remove scripts, styles, hidden, boilerplate                      │
│       │                                                                     │
│       ├──► cleanedHtml (162KB) ──────► step2_cleaned_html_*.html           │
│       │                                                                     │
│       ├──► Extract headings, lists, tables, images, buttons                │
│       │          │                                                          │
│       │          └──► step2_structured_data_*.json                         │
│       │                                                                     │
│       └──► visibleText (headings + paragraphs ≥20 chars)                   │
│                 │                                                           │
│                 └──► step2_visible_text_*.txt (initial)                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       STEP 2.4: FLATTEN                                     │
│  cleanedHtml (162KB) → Plain text (11KB, 93% reduction)                    │
│       │                                                                     │
│       └──► step2.4_flattened_*.txt                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STEP 2.5: VISIBILITY AI                                  │
│  Flattened text → Claude 3.5 Haiku → facts[]                               │
│       │                                                                     │
│       ├── ["$26.24", "4.7 stars", "2064 reviews", ...]                     │
│       │                                                                     │
│       └──► step2.5_visibility_*.json                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       STEP 2.6: MERGE                                       │
│  facts[] + original visibleText = visibleTextPlus                          │
│       │                                                                     │
│       └──► step2_visible_text_*.txt (updated)                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     STEP 3: EXTRACTION AI                                   │
│                                                                             │
│  PROMPT COMPONENTS:                                                         │
│  ┌─────────────────┐                                                       │
│  │ URL             │  → "https://addjoi.com/products/..."                  │
│  ├─────────────────┤                                                       │
│  │ ## HEADINGS     │  → From cleaning result (36 items)                    │
│  ├─────────────────┤                                                       │
│  │ ## MAIN CONTENT │  → visibleTextPlus (merged text with prices!)        │
│  ├─────────────────┤                                                       │
│  │ ## IMAGES       │  → From cleaning result (46 items)                    │
│  ├─────────────────┤                                                       │
│  │ ## LISTS        │  → From cleaning result (6 items)                     │
│  └─────────────────┘                                                       │
│                                                                             │
│  → Sent to Claude 3.5 Haiku with ExtractionSchema                          │
│  → Returns structured JSON matching Product/Article/etc schema             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       STEP 4: VALIDATOR                                     │
│  AI output → Zod validation → Repairs → Final JSON-LD                      │
│       │                                                                     │
│       ├── repairPrice("$26.24") → 26.24                                    │
│       ├── repairUrl("//domain.com/...") → "https://domain.com/..."         │
│       ├── repairDate("Jan 21, 2026") → "2026-01-21"                        │
│       │                                                                     │
│       └──► step4_jsonld_*.json (Final output!)                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
