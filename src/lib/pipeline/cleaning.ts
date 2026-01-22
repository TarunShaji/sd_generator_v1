/**
 * Pipeline Step 2: Cleaning
 * 
 * Deterministic DOM cleaning to produce high-signal textual representation.
 * SINGLE SOURCE OF TRUTH for all text extraction.
 * NO inference, NO enrichment - just what is visibly there.
 */

import { JSDOM, VirtualConsole } from 'jsdom';
import { logger } from '../logger';

export interface HeadingElement {
    level: 1 | 2 | 3 | 4 | 5 | 6;
    text: string;
}

export interface ListElement {
    type: 'ordered' | 'unordered';
    items: string[];
}

export interface TableElement {
    headers: string[];
    rows: string[][];
}

export interface ImageElement {
    src: string;
    alt: string | null;
}

export interface LinkElement {
    text: string;
    href: string;
}

export interface ButtonElement {
    text: string;
}

export interface MetaElement {
    name: string | null;
    property: string | null;
    content: string;
}

export interface CleaningResult {
    cleanedHtml: string;
    visibleText: string;
    headings: HeadingElement[];
    lists: ListElement[];
    tables: TableElement[];
    images: ImageElement[];
    links: LinkElement[];
    buttons: ButtonElement[];
    meta: MetaElement[];
    // DISABLED: JSON-LD extraction temporarily disabled for evaluation
    // jsonLd: object[];
    stats: {
        originalLength: number;
        cleanedLength: number;
        elementsRemoved: number;
        tokenEstimate: number;
    };
}

export interface CleaningError {
    success: false;
    stage: 'cleaning';
    reason: string;
}

// Elements to completely remove
const REMOVE_ELEMENTS = [
    'script:not([type="application/ld+json"])', // Keep JSON-LD scripts
    'style', 'noscript', 'iframe', 'svg', 'canvas',
    'video', 'audio', 'object', 'embed', 'applet'
];

// Boilerplate selectors to remove
const BOILERPLATE_SELECTORS = [
    'nav', 'header', 'footer', 'aside',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '.nav', '.navigation', '.navbar', '.header', '.footer', '.sidebar',
    '.cookie-banner', '.cookie-notice', '.cookie-consent', '.gdpr',
    '.popup', '.modal', '.overlay', '.lightbox',
    '.advertisement', '.ad', '.ads', '.advert', '[class*="ad-"]',
    '.social-share', '.share-buttons', '.social-icons',
    '.newsletter', '.subscribe', '.signup',
    '.breadcrumb', '.breadcrumbs',
    '#comments', '.comments', '.comment-section'
];

// Hidden element selectors
const HIDDEN_SELECTORS = [
    '[aria-hidden="true"]',
    '[hidden]',
    '.hidden', '.hide', '.invisible',
    '.sr-only', '.visually-hidden', '.screen-reader-text',
    '[style*="display: none"]', '[style*="display:none"]',
    '[style*="visibility: hidden"]', '[style*="visibility:hidden"]'
];

/**
 * Extract all visible text from DOM in document order.
 * Includes: text nodes, aria-labels, title attributes, alt text.
 */
function extractVisibleText(document: Document): string {
    const textParts: string[] = [];
    const body = document.body;
    if (!body) return '';

    // TreeWalker to get all text nodes in DOM order
    const walker = document.createTreeWalker(
        body,
        // NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
        1 | 4, // SHOW_ELEMENT = 1, SHOW_TEXT = 4
        null
    );

    let node: Node | null = walker.currentNode;
    while (node) {
        if (node.nodeType === 3) { // Text node
            const text = node.textContent?.trim();
            if (text && text.length > 0) {
                textParts.push(text);
            }
        } else if (node.nodeType === 1) { // Element node
            const el = node as Element;

            // Extract aria-label
            const ariaLabel = el.getAttribute('aria-label');
            if (ariaLabel?.trim()) {
                textParts.push(ariaLabel.trim());
            }

            // Extract title attribute
            const title = el.getAttribute('title');
            if (title?.trim()) {
                textParts.push(title.trim());
            }

            // Extract alt text from images
            if (el.tagName === 'IMG') {
                const alt = el.getAttribute('alt');
                if (alt?.trim()) {
                    textParts.push(alt.trim());
                }
            }
        }
        node = walker.nextNode();
    }

    // Deduplicate consecutive identical strings and join
    const deduped: string[] = [];
    for (const text of textParts) {
        if (deduped.length === 0 || deduped[deduped.length - 1] !== text) {
            deduped.push(text);
        }
    }

    return deduped.join('\n');
}

/**
 * Clean the DOM and extract structured content.
 */
export function clean(rawHtml: string): CleaningResult | CleaningError {
    const log = logger.scoped('Cleaning');

    try {
        log.info('Starting DOM cleaning', {
            inputLength: rawHtml.length
        });

        const originalLength = rawHtml.length;
        let elementsRemoved = 0;

        // Parse HTML with virtual console to suppress CSS parsing warnings
        const virtualConsole = new VirtualConsole();
        virtualConsole.on('error', () => { /* suppress CSS parsing errors */ });

        const dom = new JSDOM(rawHtml, { virtualConsole });
        const document = dom.window.document;

        // DISABLED: JSON-LD extraction temporarily disabled for evaluation
        // This forces the pipeline to generate Schema.org data solely from visible content
        // const jsonLd: object[] = [];
        // document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
        //     try {
        //         const content = script.textContent?.trim();
        //         if (content) {
        //             const parsed = JSON.parse(content);
        //             jsonLd.push(parsed);
        //         }
        //     } catch {
        //         // Invalid JSON, skip
        //     }
        // });
        // log.debug('Extracted JSON-LD', { count: jsonLd.length });

        // 0.1 Extract meta tags BEFORE cleanup
        const meta: MetaElement[] = [];
        document.querySelectorAll('meta[name], meta[property]').forEach(metaEl => {
            const name = metaEl.getAttribute('name');
            const property = metaEl.getAttribute('property');
            const content = metaEl.getAttribute('content');
            if (content) {
                meta.push({ name, property, content });
            }
        });
        log.debug('Extracted meta tags', { count: meta.length });

        // 1. Remove script (except JSON-LD), style, noscript, etc.
        REMOVE_ELEMENTS.forEach(selector => {
            try {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => el.remove());
                elementsRemoved += elements.length;
            } catch {
                // Invalid selector, skip
            }
        });
        // Now remove JSON-LD scripts too (we already extracted them)
        document.querySelectorAll('script[type="application/ld+json"]').forEach(el => el.remove());
        log.debug('Removed dangerous elements', { count: elementsRemoved });

        // 2. Remove hidden elements
        let hiddenCount = 0;
        HIDDEN_SELECTORS.forEach(selector => {
            try {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => el.remove());
                hiddenCount += elements.length;
            } catch {
                // Invalid selector, skip
            }
        });
        elementsRemoved += hiddenCount;
        log.debug('Removed hidden elements', { count: hiddenCount });

        // 3. Remove boilerplate
        let boilerplateCount = 0;
        BOILERPLATE_SELECTORS.forEach(selector => {
            try {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => el.remove());
                boilerplateCount += elements.length;
            } catch {
                // Invalid selector, skip
            }
        });
        elementsRemoved += boilerplateCount;
        log.debug('Removed boilerplate elements', { count: boilerplateCount });

        // 4. Extract headings
        const headings: HeadingElement[] = [];
        for (let i = 1; i <= 6; i++) {
            const elements = document.querySelectorAll(`h${i}`);
            elements.forEach(el => {
                const text = el.textContent?.trim();
                if (text) {
                    headings.push({ level: i as 1 | 2 | 3 | 4 | 5 | 6, text });
                }
            });
        }
        log.debug('Extracted headings', { count: headings.length });

        // 5. Extract lists
        const lists: ListElement[] = [];
        document.querySelectorAll('ul, ol').forEach(list => {
            const items: string[] = [];
            list.querySelectorAll('li').forEach(li => {
                const text = li.textContent?.trim();
                if (text) items.push(text);
            });
            if (items.length > 0) {
                lists.push({
                    type: list.tagName.toLowerCase() === 'ol' ? 'ordered' : 'unordered',
                    items
                });
            }
        });
        log.debug('Extracted lists', { count: lists.length });

        // 6. Extract tables
        const tables: TableElement[] = [];
        document.querySelectorAll('table').forEach(table => {
            const headers: string[] = [];
            const rows: string[][] = [];

            table.querySelectorAll('th').forEach(th => {
                const text = th.textContent?.trim();
                if (text) headers.push(text);
            });

            table.querySelectorAll('tbody tr, tr').forEach(tr => {
                const cells: string[] = [];
                tr.querySelectorAll('td').forEach(td => {
                    cells.push(td.textContent?.trim() || '');
                });
                if (cells.length > 0 && cells.some(c => c)) {
                    rows.push(cells);
                }
            });

            if (headers.length > 0 || rows.length > 0) {
                tables.push({ headers, rows });
            }
        });
        log.debug('Extracted tables', { count: tables.length });

        // 7. Extract images
        const images: ImageElement[] = [];
        document.querySelectorAll('img').forEach(img => {
            const src = img.getAttribute('src');
            if (src && !src.startsWith('data:')) {
                images.push({
                    src,
                    alt: img.getAttribute('alt')
                });
            }
        });
        log.debug('Extracted images', { count: images.length });

        // 8. Extract links
        const links: LinkElement[] = [];
        document.querySelectorAll('a[href]').forEach(a => {
            const text = a.textContent?.trim();
            const href = a.getAttribute('href');
            if (text && href && !href.startsWith('#') && !href.startsWith('javascript:')) {
                links.push({ text, href });
            }
        });
        log.debug('Extracted links', { count: links.length });

        // 9. Extract buttons/CTAs
        const buttons: ButtonElement[] = [];
        document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], .btn, .button').forEach(btn => {
            const text = btn.textContent?.trim() || (btn as HTMLInputElement).value;
            if (text) {
                buttons.push({ text });
            }
        });
        log.debug('Extracted buttons', { count: buttons.length });

        // 10. Get cleaned HTML
        const body = document.body;
        const cleanedHtml = body ? body.innerHTML : '';

        // 11. Extract ALL visible text (comprehensive, unfiltered)
        const visibleText = extractVisibleText(document);
        const cleanedLength = cleanedHtml.length;

        // Rough token estimate (1 token ≈ 4 chars for English)
        const tokenEstimate = Math.ceil(visibleText.length / 4);

        log.info('Cleaning complete', {
            originalLength,
            cleanedLength,
            elementsRemoved,
            tokenEstimate,
            headingsCount: headings.length,
            listsCount: lists.length,
            tablesCount: tables.length,
            imagesCount: images.length,
            linksCount: links.length,
            metaCount: meta.length
            // jsonLdCount: jsonLd.length  // DISABLED
        });

        return {
            cleanedHtml,
            visibleText,
            headings,
            lists,
            tables,
            images,
            links,
            buttons,
            meta,
            // jsonLd,  // DISABLED: JSON-LD extraction temporarily disabled
            stats: {
                originalLength,
                cleanedLength,
                elementsRemoved,
                tokenEstimate
            }
        };

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error('Cleaning failed', { error: message });

        return {
            success: false,
            stage: 'cleaning',
            reason: message
        };
    }
}
