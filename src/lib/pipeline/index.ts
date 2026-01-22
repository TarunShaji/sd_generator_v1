/**
 * Pipeline Index
 * 
 * Exports all pipeline modules and the main pipeline runner.
 * 
 * Simplified Pipeline:
 * Ingestion → Cleaning → Extraction AI → Validator
 */

import fs from 'fs';
import path from 'path';

export { ingest, type IngestionResult, type IngestionError } from './ingestion';
export { clean, type CleaningResult, type CleaningError, type LinkElement, type MetaElement } from './cleaning';
export { extract, type ExtractionSuccess, type ExtractionError } from './extraction';
export { validateMultiEntity, type ValidationSuccess, type ValidationError, type RejectedEntity } from './validator';

import { ingest } from './ingestion';
import { clean } from './cleaning';
import { extract } from './extraction';
import { validateMultiEntity } from './validator';
import { logger, type LogEntry } from '../logger';

export interface PipelineSuccess {
    success: true;
    acceptedEntities: object[];  // Array of valid JSON-LD objects
    rejectedEntities: import('./validator').RejectedEntity[];  // Array of rejected entities with reasons
    jsonLd: object[];  // Backward compatibility alias for acceptedEntities
    entityTypes: string[];  // Types of accepted entities only
    repairs: string[];
    logs: LogEntry[];
    stats: {
        ingestionTimeMs: number;
        cleaningTimeMs: number;
        extractionTimeMs: number;
        validationTimeMs: number;
        totalTimeMs: number;
        tokenUsage: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
        };
    };
}

export interface PipelineError {
    success: false;
    stage: 'ingestion' | 'cleaning' | 'extraction' | 'validator';
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
 * 
 * Simplified flow:
 * 1. Ingestion: Fetch HTML via Playwright
 * 2. Cleaning: DOM cleanup + comprehensive text extraction (single source of truth)
 * 3. Extraction: AI maps content to Schema.org types
 * 4. Validation: Zod validation + repairs → Final JSON-LD
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

    // Step 2: Cleaning (single source of truth for text extraction)
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

    // Save Step 2 outputs
    saveOutput(`step2_cleaned_html_${timestamp}.html`, successCleaning.cleanedHtml, true);
    saveOutput(`step2_visible_text_${timestamp}.txt`, successCleaning.visibleText);
    saveOutput(`step2_structured_data_${timestamp}.json`, {
        headings: successCleaning.headings,
        lists: successCleaning.lists,
        tables: successCleaning.tables,
        images: successCleaning.images.slice(0, 10), // Limit images for readability
        links: successCleaning.links.slice(0, 20),   // Limit links for readability
        buttons: successCleaning.buttons,
        meta: successCleaning.meta,
        // jsonLd: successCleaning.jsonLd,  // DISABLED
        stats: successCleaning.stats
    });

    logger.info('Pipeline', 'Cleaning complete', {
        visibleTextLength: successCleaning.visibleText.length,
        headingsCount: successCleaning.headings.length,
        linksCount: successCleaning.links.length,
        metaCount: successCleaning.meta.length,
        // jsonLdCount: successCleaning.jsonLd.length,  // DISABLED
        tokenEstimate: successCleaning.stats.tokenEstimate
    });

    // Step 3: Extraction (AI maps content to Schema.org)
    const extractionStart = Date.now();
    // Create a timestamped save function for extraction debugging
    const saveExtractionDebug = (filename: string, content: string | object) => {
        const name = filename.replace('.', `_${timestamp}.`);
        saveOutput(name, content);
    };
    const extractionResult = await extract(successCleaning, successIngestion.finalUrl, saveExtractionDebug);
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

    // Step 4: Validation (Multi-Entity)
    const validationStart = Date.now();
    const validationResult = validateMultiEntity(extractionResult.data, successIngestion.finalUrl);
    const validationTimeMs = Date.now() - validationStart;

    // Save Step 4 output: Final JSON-LD array
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
        acceptedEntities: validationResult.acceptedEntities.length,
        rejectedEntities: validationResult.rejectedEntities.length,
        entityTypes: validationResult.entityTypes,
        totalTimeMs,
        outputDir: OUTPUT_DIR
    });

    // Log rejected entities for transparency
    if (validationResult.rejectedEntities.length > 0) {
        logger.warn('Pipeline', 'Some entities were rejected during validation', {
            rejectedCount: validationResult.rejectedEntities.length,
            rejectedTypes: validationResult.rejectedEntities.map(e => e['@type'])
        });
    }

    return {
        success: true,
        acceptedEntities: validationResult.acceptedEntities,
        rejectedEntities: validationResult.rejectedEntities,
        jsonLd: validationResult.jsonLd,  // Backward compatibility alias
        entityTypes: validationResult.entityTypes,
        repairs: validationResult.repairs,
        logs: logger.getLogs(),
        stats: {
            ingestionTimeMs,
            cleaningTimeMs,
            extractionTimeMs,
            validationTimeMs,
            totalTimeMs,
            tokenUsage: extractionResult.tokenUsage
        }
    };
}
