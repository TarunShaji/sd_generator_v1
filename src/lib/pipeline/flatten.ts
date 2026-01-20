/**
 * Pipeline Step 2.4: HTML Flattening
 * 
 * Deterministic conversion of cleaned HTML to plain text.
 * Extracts ONLY human-visible text - no tags, no attributes, no structure.
 * 
 * This dramatically reduces token usage for downstream AI steps.
 */

import { JSDOM, VirtualConsole } from 'jsdom';
import { logger } from '../logger';

export interface FlattenResult {
    flattenedText: string;
    stats: {
        originalLength: number;
        flattenedLength: number;
        lineCount: number;
        reductionPercent: number;
    };
}

/**
 * Extract text content from a DOM node recursively
 */
function extractTextContent(node: Node, texts: Set<string>): void {
    // Skip non-element nodes except text nodes
    if (node.nodeType === 3) { // Text node
        const text = node.textContent?.trim();
        if (text && text.length > 0) {
            texts.add(text);
        }
        return;
    }

    if (node.nodeType !== 1) return; // Not an element

    const element = node as Element;
    const tagName = element.tagName?.toLowerCase();

    // Skip non-textual elements
    if (['script', 'style', 'svg', 'canvas', 'video', 'audio', 'iframe', 'noscript'].includes(tagName)) {
        return;
    }

    // Skip icon elements (common patterns)
    if (tagName === 'i' && element.className?.includes('icon')) {
        return;
    }

    // Extract accessibility text (aria-label, title, alt)
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel?.trim()) {
        texts.add(ariaLabel.trim());
    }

    const title = element.getAttribute('title');
    if (title?.trim()) {
        texts.add(title.trim());
    }

    const alt = element.getAttribute('alt');
    if (alt?.trim()) {
        texts.add(alt.trim());
    }

    // Recurse into children
    for (const child of Array.from(node.childNodes)) {
        extractTextContent(child, texts);
    }
}

/**
 * Flatten cleaned HTML to plain text
 * 
 * Removes all HTML structure, keeps only human-visible text.
 * Extracts accessibility text (aria-label, title, alt).
 * 
 * @param cleanedHtml - HTML after deterministic cleaning
 * @returns Plain text with each fact on its own line
 */
export function flattenHtml(cleanedHtml: string): FlattenResult {
    const log = logger.scoped('Flatten');
    const originalLength = cleanedHtml.length;

    try {
        log.info('Starting HTML flattening', { originalLength });

        // Parse HTML with virtual console to suppress errors
        const virtualConsole = new VirtualConsole();
        virtualConsole.on('error', () => { /* suppress */ });

        const dom = new JSDOM(cleanedHtml, { virtualConsole });
        const document = dom.window.document;

        // Use Set to collect unique text fragments
        const texts = new Set<string>();

        // Extract text from body
        const body = document.body;
        if (body) {
            extractTextContent(body, texts);
        }

        // Convert to array, normalize whitespace, filter empty
        const lines = Array.from(texts)
            .map(text => text.replace(/\s+/g, ' ').trim())
            .filter(text => text.length > 0);

        // Join with newlines
        const flattenedText = lines.join('\n');

        const stats = {
            originalLength,
            flattenedLength: flattenedText.length,
            lineCount: lines.length,
            reductionPercent: Math.round((1 - flattenedText.length / originalLength) * 100)
        };

        log.info('Flattening complete', stats);

        return {
            flattenedText,
            stats
        };

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error('Flattening failed', { error: message });

        // Fallback: basic text extraction via regex
        const fallbackText = cleanedHtml
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        return {
            flattenedText: fallbackText,
            stats: {
                originalLength,
                flattenedLength: fallbackText.length,
                lineCount: fallbackText.split('\n').length,
                reductionPercent: Math.round((1 - fallbackText.length / originalLength) * 100)
            }
        };
    }
}
