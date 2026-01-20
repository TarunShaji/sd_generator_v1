/**
 * Pipeline Step 3: Extraction
 * 
 * AI Semantic Mapping using Claude 3.5 Haiku.
 * AI is a schema field mapper ONLY - no inference, no invention.
 */

import { generateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { logger } from '../logger';
import { ExtractionSchema, type ExtractionResult } from '../schemas/definitions';
import type { CleaningResult } from './cleaning';

export interface ExtractionSuccess {
    success: true;
    data: ExtractionResult;
    tokenUsage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

export interface ExtractionError {
    success: false;
    stage: 'extraction';
    reason: string;
}

// SYSTEM PROMPT - USE VERBATIM AS SPECIFIED
const SYSTEM_PROMPT = `You are a Schema.org extraction engine, not a content generator. Your task is to map **explicitly stated information** from the provided content into the given JSON schema.

STRICT RULES:
- Do NOT guess or infer.
- Do NOT invent facts (prices, ratings, authors, brands, dates).
- Do NOT rewrite or improve text.
- Return null if data is missing.
- Use ONLY the provided schema fields.
- Return valid JSON only. No explanations.
- Choose the SINGLE MOST SPECIFIC schema type.

SCHEMA-SPECIFIC RULES:
- Product: prices must be explicitly numeric
- Article: author must be explicitly named
- FAQPage: only visible Q&A pairs
- Recipe: ingredients must be listed as ingredients
- HowTo: steps must be procedural`;

/**
 * Build the user prompt with cleaned content
 */
function buildUserPrompt(cleaningResult: CleaningResult, pageUrl: string): string {
    const parts: string[] = [];

    parts.push(`URL: ${pageUrl}`);
    parts.push('');

    // Add headings
    if (cleaningResult.headings.length > 0) {
        parts.push('## HEADINGS');
        cleaningResult.headings.forEach(h => {
            parts.push(`${'#'.repeat(h.level)} ${h.text}`);
        });
        parts.push('');
    }

    // Add main text content
    parts.push('## MAIN CONTENT');
    parts.push(cleaningResult.visibleText);
    parts.push('');

    // Add tables if present
    if (cleaningResult.tables.length > 0) {
        parts.push('## TABLES');
        cleaningResult.tables.forEach((table, i) => {
            parts.push(`Table ${i + 1}:`);
            if (table.headers.length > 0) {
                parts.push(`Headers: ${table.headers.join(' | ')}`);
            }
            table.rows.forEach(row => {
                parts.push(`Row: ${row.join(' | ')}`);
            });
            parts.push('');
        });
    }

    // Add images if present
    if (cleaningResult.images.length > 0) {
        parts.push('## IMAGES');
        cleaningResult.images.forEach(img => {
            parts.push(`- ${img.src}${img.alt ? ` (alt: ${img.alt})` : ''}`);
        });
        parts.push('');
    }

    // Add lists if present
    if (cleaningResult.lists.length > 0) {
        parts.push('## LISTS');
        cleaningResult.lists.forEach((list, i) => {
            parts.push(`List ${i + 1} (${list.type}):`);
            list.items.forEach((item, j) => {
                parts.push(`${list.type === 'ordered' ? `${j + 1}.` : '-'} ${item}`);
            });
            parts.push('');
        });
    }

    parts.push('');
    parts.push('Extract the structured data from the above content. Choose the most specific schema type. Return null for any fields where data is not explicitly present.');

    return parts.join('\n');
}

/**
 * Extract structured data using AI
 */
export async function extract(
    cleaningResult: CleaningResult,
    pageUrl: string
): Promise<ExtractionSuccess | ExtractionError> {
    const log = logger.scoped('Extraction');

    try {
        log.info('Starting AI extraction', {
            contentLength: cleaningResult.visibleText.length,
            tokenEstimate: cleaningResult.stats.tokenEstimate,
            url: pageUrl
        });

        const userPrompt = buildUserPrompt(cleaningResult, pageUrl);

        log.debug('Prompt built', {
            promptLength: userPrompt.length
        });

        log.info('Sending request to Claude 3.5 Haiku');

        const { object, usage } = await generateObject({
            model: anthropic('claude-3-5-haiku-20241022'),
            schema: ExtractionSchema,
            system: SYSTEM_PROMPT,
            prompt: userPrompt,
            temperature: 0, // Deterministic output
        });

        // Cast usage to access properties (SDK types may vary between versions)
        const usageAny = usage as unknown as Record<string, number | undefined>;
        const tokenUsage = {
            promptTokens: usageAny.promptTokens ?? usageAny.inputTokens ?? 0,
            completionTokens: usageAny.completionTokens ?? usageAny.outputTokens ?? 0,
            totalTokens: usageAny.totalTokens ?? 0
        };

        log.info('AI response received', {
            detectedType: object.detectedType,
            tokenUsage
        });

        return {
            success: true,
            data: object,
            tokenUsage
        };

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error('Extraction failed', { error: message });

        return {
            success: false,
            stage: 'extraction',
            reason: message
        };
    }
}
