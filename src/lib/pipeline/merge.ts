/**
 * Pipeline Step 2.6: Deterministic Merge
 * 
 * Concatenates visibility facts with existing visibleText.
 * NO AI, NO formatting, NO rewriting, NO inference.
 */

/**
 * Merge visibility facts with visible text deterministically.
 * 
 * @param facts - Array of short factual strings from Visibility Extractor
 * @param visibleText - Original visible text from Cleaning step
 * @returns Merged text with facts prepended
 */
export function mergeVisibleText(facts: string[], visibleText: string): string {
    // Guard: if no facts, return original
    if (!facts || facts.length === 0) {
        return visibleText;
    }

    // Deterministic concatenation: facts first, then original text
    return facts.join('\n') + '\n\n' + visibleText;
}

export interface MergeResult {
    visibleTextPlus: string;
    factCount: number;
    originalLength: number;
    mergedLength: number;
}

/**
 * Merge with metadata for logging/debugging
 */
export function mergeWithStats(facts: string[], visibleText: string): MergeResult {
    const visibleTextPlus = mergeVisibleText(facts, visibleText);

    return {
        visibleTextPlus,
        factCount: facts?.length ?? 0,
        originalLength: visibleText.length,
        mergedLength: visibleTextPlus.length
    };
}
