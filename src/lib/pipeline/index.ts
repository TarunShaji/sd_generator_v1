/**
 * Pipeline Index
 * 
 * Exports all pipeline modules and the main pipeline runner.
 */

import fs from 'fs';
import path from 'path';

export { ingest, type IngestionResult, type IngestionError } from './ingestion';
export { clean, type CleaningResult, type CleaningError } from './cleaning';
export { flattenHtml, type FlattenResult } from './flatten';
export { extractVisibility, type VisibilitySuccess, type VisibilityError } from './visibility-extractor';
export { mergeVisibleText, mergeWithStats, type MergeResult } from './merge';
export { extract, type ExtractionSuccess, type ExtractionError } from './extraction';
export { validate, type ValidationSuccess, type ValidationError } from './validator';

import { ingest } from './ingestion';
import { clean } from './cleaning';
import { flattenHtml } from './flatten';
import { extractVisibility } from './visibility-extractor';
import { mergeVisibleText } from './merge';
import { extract } from './extraction';
import { validate } from './validator';
import { logger, type LogEntry } from '../logger';

export interface PipelineSuccess {
    success: true;
    jsonLd: object;
    detectedType: string;
    repairs: string[];
    logs: LogEntry[];
    stats: {
        ingestionTimeMs: number;
        cleaningTimeMs: number;
        visibilityTimeMs: number;
        extractionTimeMs: number;
        validationTimeMs: number;
        totalTimeMs: number;
        tokenUsage: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
        };
        visibilityTokenUsage?: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
        };
    };
}

export interface PipelineError {
    success: false;
    stage: 'ingestion' | 'cleaning' | 'visibility' | 'extraction' | 'validator';
    reason: string;
    logs: LogEntry[];
}

// Output directory for debug files
const OUTPUT_DIR = path.join(process.cwd(), 'outputs');

/**
 * Pretty-print HTML with proper indentation
 */
function prettyPrintHtml(html: string): string {
    let formatted = '';
    let indent = 0;
    const tab = '  '; // 2 spaces

    // Split by tags while keeping the tags
    const parts = html.split(/(<[^>]+>)/g).filter(Boolean);

    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;

        // Check if it's a closing tag
        if (trimmed.startsWith('</')) {
            indent = Math.max(0, indent - 1);
            formatted += tab.repeat(indent) + trimmed + '\n';
        }
        // Check if it's a self-closing tag or void element
        else if (trimmed.match(/^<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr|!)[^>]*>$/i) ||
            trimmed.endsWith('/>')) {
            formatted += tab.repeat(indent) + trimmed + '\n';
        }
        // Check if it's an opening tag
        else if (trimmed.startsWith('<')) {
            formatted += tab.repeat(indent) + trimmed + '\n';
            // Don't increase indent for inline elements
            if (!trimmed.match(/^<(a|abbr|b|bdi|bdo|cite|code|data|dfn|em|i|kbd|mark|q|rp|rt|ruby|s|samp|small|span|strong|sub|sup|time|u|var|wbr)\b/i)) {
                indent++;
            }
        }
        // It's text content
        else {
            // Only add if it's meaningful text (not just whitespace)
            if (trimmed.length > 0) {
                formatted += tab.repeat(indent) + trimmed + '\n';
            }
        }
    }

    return formatted;
}

/**
 * Save debug output to file
 */
function saveOutput(filename: string, content: string | object, prettyHtml = false): void {
    try {
        // Ensure output directory exists
        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }

        const filePath = path.join(OUTPUT_DIR, filename);
        let data: string;

        if (typeof content === 'string') {
            // Pretty-print HTML if requested
            data = prettyHtml ? prettyPrintHtml(content) : content;
        } else {
            data = JSON.stringify(content, null, 2);
        }

        fs.writeFileSync(filePath, data, 'utf-8');
        logger.debug('Pipeline', `Saved output to ${filename}`);
    } catch (error) {
        logger.warn('Pipeline', `Failed to save output: ${filename}`, {
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}

/**
 * Run the full pipeline: Ingest → Clean → Extract → Validate
 */
export async function runPipeline(url: string): Promise<PipelineSuccess | PipelineError> {
    // Clear logs from previous runs
    logger.clear();
    logger.info('Pipeline', 'Starting pipeline', { url });

    const pipelineStart = Date.now();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // Step 1: Ingestion
    const ingestionStart = Date.now();
    const ingestionResult = await ingest(url);
    const ingestionTimeMs = Date.now() - ingestionStart;

    if ('success' in ingestionResult && ingestionResult.success === false) {
        return {
            success: false,
            stage: 'ingestion',
            reason: ingestionResult.reason,
            logs: logger.getLogs()
        };
    }

    // At this point, ingestionResult is IngestionResult (success case)
    const successIngestion = ingestionResult as Exclude<typeof ingestionResult, { success: false }>;

    // Save Step 1 output: Raw HTML
    saveOutput(`step1_raw_html_${timestamp}.html`, successIngestion.rawHtml, true);

    // Step 2: Cleaning
    const cleaningStart = Date.now();
    const cleaningResult = clean(successIngestion.rawHtml);
    const cleaningTimeMs = Date.now() - cleaningStart;

    if ('success' in cleaningResult && cleaningResult.success === false) {
        return {
            success: false,
            stage: 'cleaning',
            reason: cleaningResult.reason,
            logs: logger.getLogs()
        };
    }

    // At this point, cleaningResult is CleaningResult (success case)
    const successCleaning = cleaningResult as Exclude<typeof cleaningResult, { success: false }>;

    // Save Step 2 outputs: Cleaned HTML and Visible Text
    saveOutput(`step2_cleaned_html_${timestamp}.html`, successCleaning.cleanedHtml, true);
    saveOutput(`step2_visible_text_${timestamp}.txt`, successCleaning.visibleText);
    saveOutput(`step2_structured_data_${timestamp}.json`, {
        headings: successCleaning.headings,
        lists: successCleaning.lists,
        tables: successCleaning.tables,
        images: successCleaning.images.slice(0, 10), // Limit images for readability
        buttons: successCleaning.buttons,
        stats: successCleaning.stats
    });

    // Step 2.4: Flatten HTML (deterministic)
    const flattenResult = flattenHtml(successCleaning.cleanedHtml);
    saveOutput(`step2.4_flattened_${timestamp}.txt`, flattenResult.flattenedText);

    logger.info('Pipeline', 'HTML flattening complete', {
        originalLength: flattenResult.stats.originalLength,
        flattenedLength: flattenResult.stats.flattenedLength,
        reductionPercent: flattenResult.stats.reductionPercent,
        lineCount: flattenResult.stats.lineCount
    });

    // Step 2.5: Visibility Extraction (graceful failure)
    const visibilityStart = Date.now();
    let visibleTextPlus = successCleaning.visibleText;
    let visibilityTokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
    let visibilityFacts: string[] = [];

    try {
        // Use flattened text instead of cleanedHtml to reduce tokens
        const visibilityResult = await extractVisibility(flattenResult.flattenedText);

        if (visibilityResult.success) {
            visibilityFacts = visibilityResult.facts;
            visibilityTokenUsage = visibilityResult.tokenUsage;

            // Step 2.6: Deterministic Merge
            visibleTextPlus = mergeVisibleText(visibilityFacts, successCleaning.visibleText);

            // Save visibility output
            saveOutput(`step2.5_visibility_${timestamp}.json`, {
                facts: visibilityFacts,
                tokenUsage: visibilityTokenUsage,
                durationMs: visibilityResult.durationMs
            });

            logger.info('Pipeline', 'Visibility extraction complete', {
                factCount: visibilityFacts.length,
                sampleFacts: visibilityFacts.slice(0, 5)
            });
        } else {
            logger.warn('Pipeline', 'Visibility extraction failed, continuing with original visibleText', {
                reason: visibilityResult.reason
            });
        }
    } catch (error) {
        logger.warn('Pipeline', 'Visibility extraction error, continuing with original visibleText', {
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
    const visibilityTimeMs = Date.now() - visibilityStart;

    // Save enhanced visible text
    saveOutput(`step2_visible_text_${timestamp}.txt`, visibleTextPlus);

    // Create enhanced cleaning result with merged text
    const enhancedCleaning = {
        ...successCleaning,
        visibleText: visibleTextPlus
    };

    // Step 3: Extraction
    const extractionStart = Date.now();
    const extractionResult = await extract(enhancedCleaning, successIngestion.finalUrl);
    const extractionTimeMs = Date.now() - extractionStart;

    // Save Step 3 output: AI extraction result
    saveOutput(`step3_extraction_${timestamp}.json`, extractionResult);

    if (!extractionResult.success) {
        return {
            success: false,
            stage: 'extraction',
            reason: extractionResult.reason,
            logs: logger.getLogs()
        };
    }

    // Step 4: Validation
    const validationStart = Date.now();
    const validationResult = validate(extractionResult.data);
    const validationTimeMs = Date.now() - validationStart;

    // Save Step 4 output: Final JSON-LD
    saveOutput(`step4_jsonld_${timestamp}.json`, validationResult);

    if (!validationResult.success) {
        return {
            success: false,
            stage: 'validator',
            reason: validationResult.reason,
            logs: logger.getLogs()
        };
    }

    const totalTimeMs = Date.now() - pipelineStart;

    logger.info('Pipeline', 'Pipeline complete', {
        detectedType: validationResult.detectedType,
        totalTimeMs,
        outputDir: OUTPUT_DIR
    });

    return {
        success: true,
        jsonLd: validationResult.jsonLd,
        detectedType: validationResult.detectedType,
        repairs: validationResult.repairs,
        logs: logger.getLogs(),
        stats: {
            ingestionTimeMs,
            cleaningTimeMs,
            visibilityTimeMs,
            extractionTimeMs,
            validationTimeMs,
            totalTimeMs,
            tokenUsage: extractionResult.tokenUsage,
            visibilityTokenUsage
        }
    };
}
