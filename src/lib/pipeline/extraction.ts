/**
 * Pipeline Step 3: Extraction
 * 
 * AI Semantic Mapping using Claude 3.5 Haiku.
 * Extracts MULTIPLE Schema.org entities per page.
 * AI is a schema field mapper ONLY - no inference, no invention.
 */

import { generateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { logger } from '../logger';
import { MultiEntityExtractionSchema, type MultiEntityResult } from '../schemas/definitions';
import type { CleaningResult } from './cleaning';

export interface ExtractionSuccess {
    success: true;
    data: MultiEntityResult;  // Array of entities via schemas[]
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

// SYSTEM PROMPT - Multi-entity extraction
const SYSTEM_PROMPT = `You are a Schema.org entity extraction engine.

Your task is to identify and extract ALL DISTINCT Schema.org entities that are explicitly present in the provided content.

A single page may contain multiple valid entities.
Examples:
- WebSite + Organization (homepages)
- ItemList + Organization (collection pages)
- Article + Organization (blogs)
- Product + Organization (product pages)

RULES (STRICT):
- Do NOT guess or infer missing data.
- Do NOT invent facts (prices, ratings, dates, authors).
- Do NOT merge unrelated entities into one.
- Do NOT rewrite or enhance text.
- Extract ONLY what is explicitly present in the visible content.
- Return null for missing fields.
- Use ONLY the provided schema definitions.
- Output VALID JSON only. No explanations.

SCHEMA-SPECIFIC RULES:
- Product: prices must be explicitly numeric, offers must be present
- Article: author must be explicitly named
- Organization: extract if company/brand info is visible
- ItemList: use for collection/category pages with multiple items
- WebSite: use for homepages with site-level info
- VideoObject: use for pages centered around a video

Each detected entity must be returned as a SEPARATE schema type.`;

/**
 * Build the user prompt with cleaned content
 * 
 * Order follows SEO signal priority:
 * 1. URL
 * 2. META (description, og tags, etc.)
 * 3. HEADINGS
 * 4. MAIN CONTENT (visibleText)
 * 5. TABLES
 * 6. IMAGES
 * 7. LISTS
 * 8. LINKS
 * 
 * NOTE: JSON-LD extraction is DISABLED - AI must generate from visible content only
 */
function buildUserPrompt(cleaningResult: CleaningResult, pageUrl: string): string {
    const parts: string[] = [];

    // 1. URL
    parts.push(`URL: ${pageUrl}`);
    parts.push('');

    // 2. META - authoritative SEO signals
    if (cleaningResult.meta && cleaningResult.meta.length > 0) {
        parts.push('## META');
        cleaningResult.meta.forEach(m => {
            if (m.name) {
                parts.push(`name=${m.name}: ${m.content}`);
            } else if (m.property) {
                parts.push(`property=${m.property}: ${m.content}`);
            }
        });
        parts.push('');
    }

    // DISABLED: JSON-LD extraction is disabled for evaluation
    // 3. EXISTING JSON-LD - already structured data on page
    // if (cleaningResult.jsonLd && cleaningResult.jsonLd.length > 0) {
    //     parts.push('## EXISTING JSON-LD');
    //     parts.push('(Use this as authoritative source, repair if needed)');
    //     cleaningResult.jsonLd.forEach(ld => {
    //         parts.push(JSON.stringify(ld, null, 2));
    //     });
    //     parts.push('');
    // }

    // 3. HEADINGS (was 4)
    if (cleaningResult.headings.length > 0) {
        parts.push('## HEADINGS');
        cleaningResult.headings.forEach(h => {
            parts.push(`${'#'.repeat(h.level)} ${h.text}`);
        });
        parts.push('');
    }

    // 4. MAIN CONTENT (was 5)
    parts.push('## MAIN CONTENT');
    parts.push(cleaningResult.visibleText);
    parts.push('');

    // 6. TABLES
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

    // 7. IMAGES
    if (cleaningResult.images.length > 0) {
        parts.push('## IMAGES');
        cleaningResult.images.forEach(img => {
            parts.push(`- ${img.src}${img.alt ? ` (alt: ${img.alt})` : ''}`);
        });
        parts.push('');
    }

    // 8. LISTS
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

    // 9. LINKS
    if (cleaningResult.links && cleaningResult.links.length > 0) {
        parts.push('## LINKS');
        // Limit to first 30 links to avoid token bloat
        cleaningResult.links.slice(0, 30).forEach(link => {
            parts.push(`${link.text} → ${link.href}`);
        });
        parts.push('');
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
    pageUrl: string,
    savePrompt?: (filename: string, content: string | object) => void
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

        // Save the prompt for debugging (if save function provided)
        if (savePrompt) {
            savePrompt('step3_prompt.txt', userPrompt);
            savePrompt('step3_system_prompt.txt', SYSTEM_PROMPT);
        }

        log.info('Sending request to Claude 3.5 Haiku');

        const { object, usage } = await generateObject({
            model: anthropic('claude-3-5-haiku-20241022'),
            schema: MultiEntityExtractionSchema,
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
            entityCount: object.schemas.length,
            entityTypes: object.schemas.map(s => s['@type']),
            tokenUsage
        });

        return {
            success: true,
            data: object,
            tokenUsage
        };

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';

        // Capture detailed error info for debugging
        const errorDetails: Record<string, unknown> = {
            message,
            name: error instanceof Error ? error.name : 'Unknown',
            timestamp: new Date().toISOString()
        };

        // Enhanced Zod validation error handling
        if (error && typeof error === 'object') {
            const errObj = error as Record<string, unknown>;

            // Extract cause (often contains Zod validation details)
            if ('cause' in errObj && errObj.cause) {
                const cause = errObj.cause as any;
                errorDetails.cause = String(cause);

                // Try to extract Zod issues from cause
                if (cause && typeof cause === 'object' && 'message' in cause) {
                    errorDetails.causeMessage = cause.message;

                    // Parse Zod error message if present
                    if (typeof cause.message === 'string' && cause.message.includes('Error message:')) {
                        try {
                            const errorMsgMatch = cause.message.match(/Error message: (\[[\s\S]*\])/);
                            if (errorMsgMatch) {
                                const zodIssues = JSON.parse(errorMsgMatch[1]);
                                errorDetails.zodIssues = zodIssues;

                                // Create human-readable summary
                                const summary = zodIssues.map((issue: any) => {
                                    const path = issue.path ? issue.path.join('.') : 'root';
                                    return `  • ${path}: ${issue.message} (expected: ${issue.expected || 'N/A'}, got: ${issue.received || 'N/A'})`;
                                }).join('\n');
                                errorDetails.validationSummary = summary;
                            }
                        } catch {
                            // Parsing failed, keep raw message
                        }
                    }
                }
            }

            // Direct Zod issues array (some SDK versions)
            if ('issues' in errObj && Array.isArray(errObj.issues)) {
                errorDetails.zodIssues = errObj.issues;
            }

            // AI SDK response data
            if ('text' in errObj) {
                errorDetails.rawResponse = errObj.text;
            }
            if ('rawMessage' in errObj) {
                errorDetails.rawMessage = errObj.rawMessage;
            }
            if ('value' in errObj) {
                errorDetails.failedValue = errObj.value;
            }

            // Stack trace (limited for readability)
            if (error instanceof Error && error.stack) {
                errorDetails.stack = error.stack.split('\n').slice(0, 5).join('\n');
            }
        }

        // Enhanced console logging for immediate visibility
        log.error('❌ EXTRACTION FAILED - Zod Schema Validation Error');
        log.error('Error Type', { name: errorDetails.name });
        log.error('Error Message', { message: errorDetails.message });

        if (errorDetails.validationSummary) {
            log.error('Validation Failures', { summary: '\n' + errorDetails.validationSummary });
        }

        if (errorDetails.zodIssues) {
            log.error('Zod Issues Count', { count: (errorDetails.zodIssues as any[]).length });
        }

        // Save comprehensive error details for debugging
        if (savePrompt) {
            savePrompt('step3_error_details.json', errorDetails);

            // Save raw AI response separately for easy viewing
            const rawResponse = errorDetails.rawResponse || errorDetails.failedValue;
            if (rawResponse) {
                try {
                    const parsed = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
                    savePrompt('step3_ai_response.json', parsed);
                    log.info('Saved AI response', { file: 'step3_ai_response.json' });
                } catch {
                    savePrompt('step3_ai_response.txt', String(rawResponse));
                    log.info('Saved AI response', { file: 'step3_ai_response.txt' });
                }
            }

            // Create human-readable validation report
            if (errorDetails.zodIssues) {
                const report = {
                    summary: 'Zod Schema Validation Failed',
                    timestamp: errorDetails.timestamp,
                    totalIssues: (errorDetails.zodIssues as any[]).length,
                    issues: (errorDetails.zodIssues as any[]).map((issue: any, idx: number) => ({
                        issue: idx + 1,
                        field: issue.path ? issue.path.join('.') : 'root',
                        problem: issue.message,
                        expected: issue.expected || issue.code,
                        received: issue.received || 'N/A',
                        code: issue.code
                    })),
                    recommendation: 'Check step3_ai_response.json to see what the AI generated, then compare with the schema definition in src/lib/schemas/definitions.ts'
                };
                savePrompt('step3_validation_report.json', report);
                log.warn('Created validation report', { file: 'step3_validation_report.json' });
            }
        }

        return {
            success: false,
            stage: 'extraction',
            reason: message
        };
    }
}



