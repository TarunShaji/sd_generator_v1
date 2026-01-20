/**
 * Pipeline Step 2.5: Visibility Extraction
 * 
 * AI agent that surfaces short, factual, user-visible text from cleaned HTML.
 * This agent does NOT generate schema - only extracts verbatim visible facts.
 */

import { generateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { logger } from '../logger';

// --- Output Schema ---
const VisibilitySchema = z.object({
    facts: z.array(z.string())
});

export type VisibilityResult = z.infer<typeof VisibilitySchema>;

export interface VisibilitySuccess {
    success: true;
    facts: string[];
    tokenUsage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    durationMs: number;
}

export interface VisibilityError {
    success: false;
    stage: 'visibility';
    reason: string;
}

// --- System Prompt (Verbatim as specified) ---
const SYSTEM_PROMPT = `ROLE

You are a Visibility Extraction Agent in a multi-stage structured-data pipeline.

Your only responsibility is to surface short, factual, user-visible text from cleaned HTML that may be important for structured understanding of the page.

You do not generate structured data.
You do not infer meaning.
You do not decide schema types.

You only surface explicitly visible facts.


INPUT

You will receive:
- cleanedHtml: HTML after deterministic cleaning
  (scripts, styles, ads, trackers removed)

This HTML still contains:
- <div>, <span>, <label>, <button>
- headings
- short text fragments
- accessibility text (aria-label, title)


OBJECTIVE

Extract short, factual strings that:
- are explicitly visible to users
- are verbatim text from the page
- represent factual information, not prose

These facts will be appended to a larger text context and passed to a downstream schema extraction agent.


WHAT COUNTS AS A FACT

You may extract any explicit, visible factual text, including but not limited to:
- names (people, organizations, businesses)
- brand names
- authors or publishers
- prices
- ratings and review counts
- quantities or measurements
- durations or time values
- dates (published, modified, event dates)
- addresses or locations
- phone numbers
- availability or status text
- opening hours
- ingredients
- short how-to steps
- FAQ questions or answers
- SKUs, IDs, codes
- breadcrumb labels or categories


WHAT YOU MUST NOT DO

You must NOT:
- guess or infer missing information
- normalize or convert values
- combine multiple values into one
- decide which value is "correct"
- generate schema or JSON-LD
- read JavaScript logic
- extract removed <script> content
- invent relationships between facts

If a fact is not explicitly visible, do not include it.


EXTRACTION GUIDELINES

- Prefer short strings, even very short ones ($24, 4.6, XS)
- Extract from:
  - text nodes
  - <div>, <span>, <label>, <button>
  - headings if factual
- Include multiple candidates if multiple values exist
- Do not aggressively deduplicate
- If unsure → omit


OUTPUT FORMAT (STRICT)

Return only:

{
  "facts": string[]
}

Rules:
- each entry must be verbatim text from the page
- no explanations
- no categorization
- no nesting
- empty array if nothing is found


FAILURE MODE

If no factual strings are found:

{
  "facts": []
}

Do not fabricate content.


FINAL RULE

If a human cannot point to the page and say
"I see this exact text on the screen",
then it must not appear in your output.`;

/**
 * Extract short, visible facts from flattened text using AI
 */
export async function extractVisibility(
    flattenedText: string
): Promise<VisibilitySuccess | VisibilityError> {
    const log = logger.scoped('VisibilityExtractor');
    const startTime = Date.now();

    try {
        log.info('Starting visibility extraction', {
            textLength: flattenedText.length
        });

        const userPrompt = `Extract short, factual, user-visible text from this page content:\n\n${flattenedText}`;

        log.debug('Sending request to Claude 3.5 Haiku');

        const { object, usage } = await generateObject({
            model: anthropic('claude-3-5-haiku-20241022'),
            schema: VisibilitySchema,
            system: SYSTEM_PROMPT,
            prompt: userPrompt,
            temperature: 0 // Deterministic output
        });

        // Validate output
        if (!Array.isArray(object.facts)) {
            throw new Error('Invalid visibility extractor output: facts is not an array');
        }

        const durationMs = Date.now() - startTime;

        // Cast usage to access properties
        const usageAny = usage as unknown as Record<string, number | undefined>;
        const tokenUsage = {
            promptTokens: usageAny.promptTokens ?? usageAny.inputTokens ?? 0,
            completionTokens: usageAny.completionTokens ?? usageAny.outputTokens ?? 0,
            totalTokens: usageAny.totalTokens ?? 0
        };

        log.info('Visibility extraction complete', {
            factCount: object.facts.length,
            sampleFacts: object.facts.slice(0, 5),
            completionTokens: tokenUsage.completionTokens,
            totalTokens: tokenUsage.totalTokens,
            durationMs
        });

        return {
            success: true,
            facts: object.facts,
            tokenUsage,
            durationMs
        };

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error('Visibility extraction failed', { error: message });

        return {
            success: false,
            stage: 'visibility',
            reason: message
        };
    }
}
