#!/usr/bin/env npx tsx

/**
 * CLI Test Script for Cleaning Step Only (No AI)
 * 
 * Usage: npx tsx scripts/test-cleaning.ts <url>
 * Example: npx tsx scripts/test-cleaning.ts https://addjoi.com/products/organic-almond-base-2-pack
 * 
 * This runs ONLY ingestion + cleaning to see what would be sent to the extraction AI.
 * No tokens are used!
 * 
 * Outputs saved to outputs/:
 *   - step1_raw_html.html
 *   - step2_cleaned_html.html
 *   - step2_visible_text.txt      ← THE TEXT GOING TO AI
 *   - step2_headings.json
 *   - step2_lists.json
 *   - step2_tables.json
 *   - step2_images.json
 *   - step2_links.json
 *   - step2_buttons.json
 *   - step2_meta.json
 *   - step2_stats.json
 */

import fs from 'fs';
import path from 'path';
import { ingest } from '../src/lib/pipeline/ingestion';
import { clean } from '../src/lib/pipeline/cleaning';

const OUTPUT_DIR = path.join(process.cwd(), 'outputs');

function clearOutputs(): void {
    if (fs.existsSync(OUTPUT_DIR)) {
        const files = fs.readdirSync(OUTPUT_DIR);
        for (const file of files) {
            fs.unlinkSync(path.join(OUTPUT_DIR, file));
        }
    }
}

function saveOutput(filename: string, content: string | object): void {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    const filePath = path.join(OUTPUT_DIR, filename);
    const data = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    fs.writeFileSync(filePath, data, 'utf-8');
    console.log(`  📄 ${filename}`);
}

async function main() {
    const url = process.argv[2];

    if (!url) {
        console.error('Usage: npx tsx scripts/test-cleaning.ts <url>');
        console.error('Example: npx tsx scripts/test-cleaning.ts https://addjoi.com/products/organic-almond-base-2-pack');
        process.exit(1);
    }

    console.log(`\n🚀 Testing cleaning pipeline for: ${url}\n`);
    console.log('⚠️  NO AI will be called - no tokens used!\n');

    // Clear previous outputs
    console.log('🗑️  Clearing previous outputs...');
    clearOutputs();

    // Step 1: Ingestion
    console.log('\n📥 STEP 1: INGESTION');
    console.log('  Fetching page with Playwright...');
    const ingestionStart = Date.now();
    const ingestionResult = await ingest(url);
    const ingestionTimeMs = Date.now() - ingestionStart;

    if ('success' in ingestionResult && ingestionResult.success === false) {
        console.error('❌ Ingestion failed:', ingestionResult.reason);
        process.exit(1);
    }

    const successIngestion = ingestionResult as Exclude<typeof ingestionResult, { success: false }>;
    console.log(`  ✅ Done in ${ingestionTimeMs}ms`);
    console.log(`  📊 HTML size: ${successIngestion.htmlSize} bytes`);
    console.log(`  🔗 Final URL: ${successIngestion.finalUrl}`);
    console.log('\n  Outputs:');
    saveOutput('step1_raw_html.html', successIngestion.rawHtml);

    // Step 2: Cleaning
    console.log('\n🧹 STEP 2: CLEANING');
    console.log('  Parsing DOM and extracting content...');
    const cleaningStart = Date.now();
    const cleaningResult = clean(successIngestion.rawHtml);
    const cleaningTimeMs = Date.now() - cleaningStart;

    if ('success' in cleaningResult && cleaningResult.success === false) {
        console.error('❌ Cleaning failed:', cleaningResult.reason);
        process.exit(1);
    }

    const c = cleaningResult as Exclude<typeof cleaningResult, { success: false }>;
    console.log(`  ✅ Done in ${cleaningTimeMs}ms`);
    console.log(`  📊 Cleaned HTML: ${c.stats.cleanedLength} bytes`);
    console.log(`  📊 Visible Text: ${c.visibleText.length} bytes`);
    console.log(`  📊 Token Estimate: ~${c.stats.tokenEstimate} tokens`);

    console.log('\n  Outputs:');
    saveOutput('step2_cleaned_html.html', c.cleanedHtml);
    saveOutput('step2_visible_text.txt', c.visibleText);
    saveOutput('step2_headings.json', c.headings);
    saveOutput('step2_lists.json', c.lists);
    saveOutput('step2_tables.json', c.tables);
    saveOutput('step2_images.json', c.images);
    saveOutput('step2_links.json', c.links);
    saveOutput('step2_buttons.json', c.buttons);
    saveOutput('step2_meta.json', c.meta);
    // saveOutput('step2_jsonld.json', c.jsonLd);  // DISABLED
    saveOutput('step2_stats.json', c.stats);

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 EXTRACTION COUNTS:');
    console.log('='.repeat(50));
    console.log(`  Headings:   ${c.headings.length}`);
    console.log(`  Lists:      ${c.lists.length}`);
    console.log(`  Tables:     ${c.tables.length}`);
    console.log(`  Images:     ${c.images.length}`);
    console.log(`  Links:      ${c.links.length}`);
    console.log(`  Buttons:    ${c.buttons.length}`);
    console.log(`  Meta Tags:  ${c.meta.length}`);
    // console.log(`  JSON-LD:    ${c.jsonLd.length}`);  // DISABLED

    console.log('\n' + '='.repeat(50));
    console.log('👀 WHAT GOES TO EXTRACTION AI:');
    console.log('='.repeat(50));
    console.log(`\n  Main text content: outputs/step2_visible_text.txt`);
    console.log(`  + Headings:        outputs/step2_headings.json`);
    console.log(`  + Images:          outputs/step2_images.json`);
    console.log(`  + Lists:           outputs/step2_lists.json`);
    console.log(`  + Tables:          outputs/step2_tables.json`);

    console.log('\n✅ Done! No tokens used.');
    console.log('📁 All outputs saved to: outputs/\n');
}

main().catch(console.error);
