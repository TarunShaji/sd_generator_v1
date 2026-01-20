/**
 * API Route: POST /api/generate
 * 
 * Accepts a URL and runs the full pipeline.
 * Returns JSON-LD or error with full logs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runPipeline } from '@/lib/pipeline';

export const maxDuration = 60; // Allow up to 60 seconds for scraping

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { url } = body;

        if (!url || typeof url !== 'string') {
            return NextResponse.json(
                {
                    success: false,
                    stage: 'api',
                    reason: 'URL is required',
                    logs: []
                },
                { status: 400 }
            );
        }

        // Validate URL format
        try {
            new URL(url);
        } catch {
            return NextResponse.json(
                {
                    success: false,
                    stage: 'api',
                    reason: 'Invalid URL format',
                    logs: []
                },
                { status: 400 }
            );
        }

        // Run the pipeline
        const result = await runPipeline(url);

        if (result.success) {
            return NextResponse.json(result);
        } else {
            // Return error with logs for debugging
            return NextResponse.json(result, { status: 422 });
        }

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown server error';

        return NextResponse.json(
            {
                success: false,
                stage: 'api',
                reason: message,
                logs: []
            },
            { status: 500 }
        );
    }
}
