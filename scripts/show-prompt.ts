#!/usr/bin/env npx tsx

/**
 * Show exactly what prompt would be sent to the extraction AI
 * 
 * Usage: npx tsx scripts/show-prompt.ts
 * 
 * Reads from outputs/ and assembles the final prompt.
 */

import fs from 'fs';
import path from 'path';

const OUTPUT_DIR = path.join(process.cwd(), 'outputs');

function readJson(filename: string): unknown {
    const filePath = path.join(OUTPUT_DIR, filename);
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function readText(filename: string): string {
    const filePath = path.join(OUTPUT_DIR, filename);
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf-8');
}

function main() {
    console.log('📋 FINAL PROMPT TO EXTRACTION AI:\n');
    console.log('='.repeat(80));

    const parts: string[] = [];

    // 1. URL (we don't have it saved, use placeholder)
    parts.push('URL: https://addjoi.com/products/organic-almond-base-2-pack');
    parts.push('');

    // 2. META
    const meta = readJson('step2_meta.json') as Array<{ name?: string; property?: string; content: string }>;
    if (meta.length > 0) {
        parts.push('## META');
        meta.forEach(m => {
            if (m.name) {
                parts.push(`name=${m.name}: ${m.content}`);
            } else if (m.property) {
                parts.push(`property=${m.property}: ${m.content}`);
            }
        });
        parts.push('');
    }

    // 3. EXISTING JSON-LD
    const jsonLd = readJson('step2_jsonld.json') as object[];
    if (jsonLd.length > 0) {
        parts.push('## EXISTING JSON-LD');
        parts.push('(Use this as authoritative source, repair if needed)');
        jsonLd.forEach(ld => {
            parts.push(JSON.stringify(ld, null, 2));
        });
        parts.push('');
    }

    // 4. HEADINGS
    const headings = readJson('step2_headings.json') as Array<{ level: number; text: string }>;
    if (headings.length > 0) {
        parts.push('## HEADINGS');
        headings.forEach(h => {
            parts.push(`${'#'.repeat(h.level)} ${h.text}`);
        });
        parts.push('');
    }

    // 5. MAIN CONTENT
    const visibleText = readText('step2_visible_text.txt');
    parts.push('## MAIN CONTENT');
    parts.push(visibleText);
    parts.push('');

    // 6. TABLES
    const tables = readJson('step2_tables.json') as Array<{ headers: string[]; rows: string[][] }>;
    if (tables.length > 0) {
        parts.push('## TABLES');
        tables.forEach((table, i) => {
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
    const images = readJson('step2_images.json') as Array<{ src: string; alt?: string }>;
    if (images.length > 0) {
        parts.push('## IMAGES');
        images.forEach(img => {
            parts.push(`- ${img.src}${img.alt ? ` (alt: ${img.alt})` : ''}`);
        });
        parts.push('');
    }

    // 8. LISTS
    const lists = readJson('step2_lists.json') as Array<{ type: string; items: string[] }>;
    if (lists.length > 0) {
        parts.push('## LISTS');
        lists.forEach((list, i) => {
            parts.push(`List ${i + 1} (${list.type}):`);
            list.items.forEach((item, j) => {
                parts.push(`${list.type === 'ordered' ? `${j + 1}.` : '-'} ${item}`);
            });
            parts.push('');
        });
    }

    // 9. LINKS
    const links = readJson('step2_links.json') as Array<{ text: string; href: string }>;
    if (links.length > 0) {
        parts.push('## LINKS');
        links.slice(0, 30).forEach(link => {
            parts.push(`${link.text} → ${link.href}`);
        });
        parts.push('');
    }

    parts.push('');
    parts.push('Extract the structured data from the above content. Choose the most specific schema type. Return null for any fields where data is not explicitly present. Use EXISTING JSON-LD as the primary source if available.');

    const prompt = parts.join('\n');

    console.log(prompt);
    console.log('\n' + '='.repeat(80));
    console.log(`\n📊 Prompt size: ${prompt.length} characters (~${Math.ceil(prompt.length / 4)} tokens)`);

    // Save to file
    const promptPath = path.join(OUTPUT_DIR, 'final_prompt.txt');
    fs.writeFileSync(promptPath, prompt, 'utf-8');
    console.log(`📄 Saved to: outputs/final_prompt.txt`);
}

main();
