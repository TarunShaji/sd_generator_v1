#!/usr/bin/env npx tsx

/**
 * CLI Test Script for Pipeline
 * 
 * Usage: npx tsx scripts/test-pipeline.ts <url>
 * Example: npx tsx scripts/test-pipeline.ts https://addjoi.com/products/organic-almond-base-2-pack
 */

import { runPipeline } from '../src/lib/pipeline';

async function main() {
    const url = process.argv[2];

    if (!url) {
        console.error('Usage: npx tsx scripts/test-pipeline.ts <url>');
        console.error('Example: npx tsx scripts/test-pipeline.ts https://addjoi.com/products/organic-almond-base-2-pack');
        process.exit(1);
    }

    console.log(`\n🚀 Starting pipeline for: ${url}\n`);

    try {
        const result = await runPipeline(url);

        if (result.success) {
            console.log('\n✅ Pipeline completed successfully!\n');
            console.log('Accepted Entities:', result.acceptedEntities.length);
            console.log('Rejected Entities:', result.rejectedEntities.length);
            console.log('Entity Types:', result.entityTypes.join(', '));

            if (result.rejectedEntities.length > 0) {
                console.log('\n⚠️  Rejected Entities:');
                result.rejectedEntities.forEach((rejected, idx) => {
                    console.log(`  ${idx + 1}. ${rejected['@type']}: ${rejected.reason}`);
                });
            }

            console.log('\nRepairs:', result.repairs.length > 0 ? result.repairs : 'None');
            console.log('\nTiming:');
            console.log(`  - Ingestion: ${result.stats.ingestionTimeMs}ms`);
            console.log(`  - Cleaning: ${result.stats.cleaningTimeMs}ms`);
            console.log(`  - Extraction: ${result.stats.extractionTimeMs}ms`);
            console.log(`  - Validation: ${result.stats.validationTimeMs}ms`);
            console.log(`  - Total: ${result.stats.totalTimeMs}ms`);
            console.log('\nToken Usage:');
            console.log(`  - Prompt: ${result.stats.tokenUsage.promptTokens}`);
            console.log(`  - Completion: ${result.stats.tokenUsage.completionTokens}`);
            console.log(`  - Total: ${result.stats.tokenUsage.totalTokens}`);
            console.log('\n📁 Output files saved to: outputs/');
            console.log('\nJSON-LD Output (Accepted Entities):');
            console.log(JSON.stringify(result.jsonLd, null, 2));
        } else {
            console.error('\n❌ Pipeline failed!');
            console.error('Stage:', result.stage);
            console.error('Reason:', result.reason);
            process.exit(1);
        }
    } catch (error) {
        console.error('\n❌ Unexpected error:', error);
        process.exit(1);
    }
}

main();
