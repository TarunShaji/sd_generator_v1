/**
 * Example: Using Validation Transparency
 * 
 * This example demonstrates how to use the new validation transparency features
 * to distinguish between extraction failures and validation failures.
 */

import { runPipeline } from '../src/lib/pipeline';

async function exampleUsage() {
    const url = 'https://example.com/product-page';
    const result = await runPipeline(url);

    if (result.success) {
        console.log('Pipeline succeeded!');

        // NEW: Access accepted entities explicitly
        console.log(`Accepted: ${result.acceptedEntities.length} entities`);
        result.acceptedEntities.forEach(entity => {
            console.log('  ✓', entity);
        });

        // NEW: Access rejected entities with reasons
        console.log(`Rejected: ${result.rejectedEntities.length} entities`);
        result.rejectedEntities.forEach(rejected => {
            console.log(`  ✗ ${rejected['@type']}: ${rejected.reason}`);
        });

        // BACKWARD COMPATIBLE: Old code still works
        const entities = result.jsonLd;  // Same as acceptedEntities
        console.log(`Total valid entities: ${entities.length}`);

        // Analyze extraction vs validation quality
        const extractedCount = result.acceptedEntities.length + result.rejectedEntities.length;
        const acceptanceRate = (result.acceptedEntities.length / extractedCount) * 100;
        console.log(`Validation acceptance rate: ${acceptanceRate.toFixed(1)}%`);

        // Debug: Identify common rejection reasons
        const rejectionReasons = result.rejectedEntities.reduce((acc, r) => {
            acc[r.reason] = (acc[r.reason] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        console.log('Rejection reasons:', rejectionReasons);

    } else {
        console.error(`Pipeline failed at ${result.stage}: ${result.reason}`);
    }
}

// Example: Handling partial success
async function handlePartialSuccess() {
    const result = await runPipeline('https://example.com/complex-page');

    if (result.success) {
        // Even if some entities were rejected, we still have valid output
        if (result.rejectedEntities.length > 0) {
            console.warn('⚠️  Some entities were rejected:');
            result.rejectedEntities.forEach(r => {
                console.warn(`  - ${r['@type']}: ${r.reason}`);
            });
        }

        // Use the accepted entities
        return result.acceptedEntities;
    } else {
        // Total failure - no entities accepted
        throw new Error(`Pipeline failed: ${result.reason}`);
    }
}

// Example: Quality metrics
async function calculateQualityMetrics(url: string) {
    const result = await runPipeline(url);

    if (!result.success) {
        return {
            extractorQuality: 0,
            validatorQuality: 0,
            overallQuality: 0
        };
    }

    const totalExtracted = result.acceptedEntities.length + result.rejectedEntities.length;
    const extractorQuality = totalExtracted > 0 ? 100 : 0;  // Did we extract anything?
    const validatorQuality = totalExtracted > 0
        ? (result.acceptedEntities.length / totalExtracted) * 100
        : 0;  // How many passed validation?
    const overallQuality = (extractorQuality * validatorQuality) / 100;

    return {
        extractorQuality,  // Measures extraction capability
        validatorQuality,  // Measures data quality
        overallQuality,    // Combined metric
        details: {
            extracted: totalExtracted,
            accepted: result.acceptedEntities.length,
            rejected: result.rejectedEntities.length,
            rejectionReasons: result.rejectedEntities.map(r => ({
                type: r['@type'],
                reason: r.reason
            }))
        }
    };
}

export { exampleUsage, handlePartialSuccess, calculateQualityMetrics };
