/**
 * Pipeline Step 2: Cleaning
 * 
 * Deterministic DOM cleaning to produce high-signal textual representation.
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

export interface ButtonElement {
    text: string;
}

export interface CleaningResult {
    cleanedHtml: string;
    visibleText: string;
    headings: HeadingElement[];
    lists: ListElement[];
    tables: TableElement[];
    images: ImageElement[];
    buttons: ButtonElement[];
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
    'script', 'style', 'noscript', 'iframe', 'svg', 'canvas',
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

// Minimum text length for paragraphs (low threshold to capture prices like "$24")
const MIN_PARAGRAPH_LENGTH = 2;

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
        // jsdom doesn't fully support modern CSS (nested selectors, CSS variables)
        // but we remove style elements anyway, so these warnings are safe to ignore
        const virtualConsole = new VirtualConsole();
        virtualConsole.on('error', () => { /* suppress CSS parsing errors */ });

        const dom = new JSDOM(rawHtml, { virtualConsole });
        const document = dom.window.document;

        // 1. Remove script, style, noscript, etc.
        REMOVE_ELEMENTS.forEach(tag => {
            const elements = document.querySelectorAll(tag);
            elements.forEach(el => el.remove());
            elementsRemoved += elements.length;
        });
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

            // Get headers
            table.querySelectorAll('th').forEach(th => {
                const text = th.textContent?.trim();
                if (text) headers.push(text);
            });

            // Get rows
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

        // 8. Extract buttons/CTAs
        const buttons: ButtonElement[] = [];
        document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], .btn, .button').forEach(btn => {
            const text = btn.textContent?.trim() || (btn as HTMLInputElement).value;
            if (text) {
                buttons.push({ text });
            }
        });
        log.debug('Extracted buttons', { count: buttons.length });

        // 9. Get cleaned HTML
        const body = document.body;
        const cleanedHtml = body ? body.innerHTML : '';

        // 10. Extract visible text (filter short paragraphs)
        const visibleTextParts: string[] = [];

        // Add headings
        headings.forEach(h => visibleTextParts.push(h.text));

        // Add paragraphs
        document.querySelectorAll('p').forEach(p => {
            const text = p.textContent?.trim();
            if (text && text.length >= MIN_PARAGRAPH_LENGTH) {
                visibleTextParts.push(text);
            }
        });

        // Add list items
        lists.forEach(list => {
            list.items.forEach(item => {
                if (item.length >= MIN_PARAGRAPH_LENGTH) {
                    visibleTextParts.push(item);
                }
            });
        });

        const visibleText = visibleTextParts.join('\n\n');
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
            imagesCount: images.length
        });

        return {
            cleanedHtml,
            visibleText,
            headings,
            lists,
            tables,
            images,
            buttons,
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
