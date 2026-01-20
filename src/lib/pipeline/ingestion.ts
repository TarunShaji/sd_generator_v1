/**
 * Pipeline Step 1: Ingestion
 * 
 * Deterministic scraping using Playwright with stealth mode.
 * Blocks images, fonts, stylesheets for faster loading.
 * Implements autoScroll for lazy-loaded content.
 */

import { chromium, Browser, Page } from 'playwright';
import { logger } from '../logger';

export interface IngestionResult {
    url: string;
    rawHtml: string;
    finalUrl: string;
    scrollDepth: number;
    htmlSize: number;
    loadTimeMs: number;
}

export interface IngestionError {
    success: false;
    stage: 'ingestion';
    reason: string;
    url: string;
}

/**
 * Auto-scroll the page to trigger lazy loading.
 * Scrolls every 500ms until network idle or 2s timeout.
 */
async function autoScroll(page: Page, log: ReturnType<typeof logger.scoped>): Promise<number> {
    log.info('Starting auto-scroll');

    const startTime = Date.now();
    const maxDuration = 2000; // 2 seconds max
    const scrollInterval = 500; // 500ms between scrolls
    let lastScrollY = 0;
    let scrollDepth = 0;

    while (Date.now() - startTime < maxDuration) {
        // Scroll down
        scrollDepth = await page.evaluate(() => {
            window.scrollBy(0, window.innerHeight);
            return window.scrollY;
        });

        // Check if we've reached the bottom (scroll position hasn't changed)
        if (scrollDepth === lastScrollY) {
            log.debug('Reached page bottom', { scrollDepth });
            break;
        }
        lastScrollY = scrollDepth;

        // Wait for scroll interval
        await new Promise(resolve => setTimeout(resolve, scrollInterval));
    }

    // Scroll back to top
    await page.evaluate(() => window.scrollTo(0, 0));

    log.info('Auto-scroll complete', {
        scrollDepth,
        durationMs: Date.now() - startTime
    });

    return scrollDepth;
}

/**
 * Ingest a URL and return the raw HTML content.
 */
export async function ingest(url: string): Promise<IngestionResult | IngestionError> {
    const log = logger.scoped('Ingestion');
    const startTime = Date.now();
    let browser: Browser | null = null;

    try {
        log.info('Starting ingestion', { url });

        // Validate URL
        try {
            new URL(url);
        } catch {
            log.error('Invalid URL provided', { url });
            return {
                success: false,
                stage: 'ingestion',
                reason: 'Invalid URL format',
                url
            };
        }

        // Launch browser
        log.info('Launching browser');
        browser = await chromium.launch({
            headless: true,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });

        // Create context with stealth-like settings
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 },
            locale: 'en-US',
            timezoneId: 'America/New_York'
        });

        // Block unnecessary resources
        await context.route('**/*', (route) => {
            const resourceType = route.request().resourceType();
            if (['image', 'font', 'stylesheet', 'media'].includes(resourceType)) {
                route.abort();
            } else {
                route.continue();
            }
        });

        log.info('Browser launched, creating page');

        const page = await context.newPage();

        // Navigate to URL
        log.info('Navigating to URL');
        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        if (!response) {
            throw new Error('No response received from page');
        }

        const status = response.status();
        if (status >= 400) {
            log.error('HTTP error response', { status });
            return {
                success: false,
                stage: 'ingestion',
                reason: `HTTP error: ${status}`,
                url
            };
        }

        log.info('Page loaded', {
            status,
            finalUrl: page.url()
        });

        // Wait for network to settle
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
            log.warn('Network idle timeout, continuing anyway');
        });

        // Auto-scroll to trigger lazy loading
        const scrollDepth = await autoScroll(page, log);

        // Wait a bit for any final content to load
        await new Promise(resolve => setTimeout(resolve, 500));

        // Get the final HTML
        const rawHtml = await page.content();
        const htmlSize = Buffer.byteLength(rawHtml, 'utf-8');
        const loadTimeMs = Date.now() - startTime;

        log.info('Ingestion complete', {
            htmlSize,
            scrollDepth,
            loadTimeMs,
            finalUrl: page.url()
        });

        return {
            url,
            rawHtml,
            finalUrl: page.url(),
            scrollDepth,
            htmlSize,
            loadTimeMs
        };

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error('Ingestion failed', { error: message });

        return {
            success: false,
            stage: 'ingestion',
            reason: message,
            url
        };
    } finally {
        if (browser) {
            await browser.close();
            log.debug('Browser closed');
        }
    }
}
