#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Process OpenAPI specs by filtering out write APIs, deprecated APIs, and ignored services
 * Usage: node process-openapi-specs.js [input-folder] [output-folder]
 * 
 * Features:
 * - Filters out write operations (POST, PUT, PATCH, DELETE)
 * - Filters out deprecated APIs
 * - Removes host field from specs
 * - Removes externalDocs field from specs
 * - Removes x-docs field from specs
 * - Removes realm field from x-version
 * - Ignores specified services (buildinfo, challenge, differ, eventlog, matchmaking, sessionbrowser, ugc)
 * - Prettifies JSON output
 */

// Default paths
const DEFAULT_INPUT_FOLDER = '../justice-codegen-sdk-spec/spec/stage_main';
const DEFAULT_OUTPUT_FOLDER = './openapi-specs';

// const FILTERED_METHODS = ['post', 'put', 'patch', 'delete'];
const FILTERED_METHODS = [];

// Services to be ignored during processing (by filename without extension)
const IGNORED_SERVICES = [
    'buildinfo',
    'challenge',
    'differ', 
    'eventlog',
    'matchmaking',
    'sessionbrowser',
    'ugc'
];

function parseArguments() {
    const args = process.argv.slice(2);
    const inputFolder = args[0] || DEFAULT_INPUT_FOLDER;
    const outputFolder = args[1] || DEFAULT_OUTPUT_FOLDER;
    
    return { inputFolder, outputFolder };
}

function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`Created directory: ${dirPath}`);
    }
}

function isJsonFile(filename) {
    return path.extname(filename).toLowerCase() === '.json';
}

function shouldIgnoreFile(filename) {
    const baseName = path.basename(filename, '.json').toLowerCase();
    return IGNORED_SERVICES.includes(baseName);
}

function filterPaths(paths) {
    const filteredPaths = {};
    
    for (const [pathKey, pathValue] of Object.entries(paths)) {
        const filteredMethods = {};
        let hasValidMethods = false;
        
        for (const [method, methodValue] of Object.entries(pathValue)) {
            // Skip write methods
            if (FILTERED_METHODS.includes(method.toLowerCase())) {
                console.log(`  Filtered out ${method.toUpperCase()} ${pathKey}`);
                continue;
            }
            
            // Skip deprecated APIs
            if (methodValue && methodValue.deprecated === true) {
                console.log(`  Filtered out ${method.toUpperCase()} ${pathKey} (deprecated)`);
                continue;
            }
            
            // Keep this method
            filteredMethods[method] = methodValue;
            hasValidMethods = true;
        }
        
        // Only include the path if it has valid methods
        if (hasValidMethods) {
            filteredPaths[pathKey] = filteredMethods;
        }
    }
    
    return filteredPaths;
}

function processOpenApiSpec(inputPath, outputPath) {
    try {
        console.log(`Processing: ${inputPath}`);
        
        // Read and parse JSON
        const rawData = fs.readFileSync(inputPath, 'utf8');
        const spec = JSON.parse(rawData);
        
        // Track original counts
        const originalPathCount = spec.paths ? Object.keys(spec.paths).length : 0;
        let originalMethodCount = 0;
        
        if (spec.paths) {
            for (const pathMethods of Object.values(spec.paths)) {
                originalMethodCount += Object.keys(pathMethods).length;
            }
        }
        
        // Filter paths
        if (spec.paths) {
            spec.paths = filterPaths(spec.paths);
        }
        
        // Remove host field if it exists
        if (spec.host) {
            delete spec.host;
            console.log('  Removed top-level host field');
        }
        
        // Remove externalDocs field if it exists
        if (spec.externalDocs) {
            delete spec.externalDocs;
            console.log('  Removed externalDocs field');
        }
        
        // Remove x-docs field if it exists
        if (spec['x-docs']) {
            delete spec['x-docs'];
            console.log('  Removed x-docs field');
        }
        
        // Remove realm field from x-version if it exists
        if (spec['x-version'] && spec['x-version'].realm) {
            delete spec['x-version'].realm;
            console.log('  Removed realm field from x-version');
        }
        
        // Calculate filtered counts
        const filteredPathCount = spec.paths ? Object.keys(spec.paths).length : 0;
        let filteredMethodCount = 0;
        
        if (spec.paths) {
            for (const pathMethods of Object.values(spec.paths)) {
                filteredMethodCount += Object.keys(pathMethods).length;
            }
        }
        
        // Prettify and write JSON
        const prettyJson = JSON.stringify(spec, null, 2);
        fs.writeFileSync(outputPath, prettyJson, 'utf8');
        
        console.log(`  ✓ Processed: ${path.basename(inputPath)}`);
        console.log(`    Paths: ${originalPathCount} → ${filteredPathCount}`);
        console.log(`    Methods: ${originalMethodCount} → ${filteredMethodCount}`);
        console.log(`    Output: ${outputPath}`);
        console.log('');
        
        return {
            originalPaths: originalPathCount,
            filteredPaths: filteredPathCount,
            originalMethods: originalMethodCount,
            filteredMethods: filteredMethodCount
        };
        
    } catch (error) {
        console.error(`Error processing ${inputPath}:`, error.message);
        return null;
    }
}

function main() {
    const { inputFolder, outputFolder } = parseArguments();
    
    console.log('OpenAPI Spec Processor');
    console.log('=====================');
    console.log(`Input folder: ${path.resolve(inputFolder)}`);
    console.log(`Output folder: ${path.resolve(outputFolder)}`);
    console.log('');
    
    // Check if input folder exists
    if (!fs.existsSync(inputFolder)) {
        console.error(`Error: Input folder does not exist: ${inputFolder}`);
        process.exit(1);
    }
    
    // Ensure output directory exists
    ensureDirectoryExists(outputFolder);
    
    // Get all JSON files in input folder
    const files = fs.readdirSync(inputFolder);
    const allJsonFiles = files.filter(isJsonFile);
    const jsonFiles = allJsonFiles.filter(file => !shouldIgnoreFile(file));
    const ignoredFiles = allJsonFiles.filter(shouldIgnoreFile);
    
    if (allJsonFiles.length === 0) {
        console.log('No JSON files found in input folder.');
        return;
    }
    
    console.log(`Found ${allJsonFiles.length} JSON file(s), processing ${jsonFiles.length}:`);
    jsonFiles.forEach(file => console.log(`  - ${file}`));
    
    if (ignoredFiles.length > 0) {
        console.log(`\nIgnored ${ignoredFiles.length} file(s):`);
        ignoredFiles.forEach(file => console.log(`  - ${file} (ignored service)`));
    }
    console.log('');
    
    // Process each JSON file
    const results = [];
    let totalOriginalPaths = 0;
    let totalFilteredPaths = 0;
    let totalOriginalMethods = 0;
    let totalFilteredMethods = 0;
    
    for (const file of jsonFiles) {
        const inputPath = path.join(inputFolder, file);
        const outputPath = path.join(outputFolder, file);
        
        const result = processOpenApiSpec(inputPath, outputPath);
        if (result) {
            results.push({ file, ...result });
            totalOriginalPaths += result.originalPaths;
            totalFilteredPaths += result.filteredPaths;
            totalOriginalMethods += result.originalMethods;
            totalFilteredMethods += result.filteredMethods;
        }
    }
    
    // Summary
    console.log('Processing Summary');
    console.log('==================');
    console.log(`Files found: ${allJsonFiles.length}`);
    console.log(`Files ignored: ${ignoredFiles.length} (${IGNORED_SERVICES.join(', ')})`);
    console.log(`Files processed: ${results.length}/${jsonFiles.length}`);
    console.log(`Total paths: ${totalOriginalPaths} → ${totalFilteredPaths} (${totalOriginalPaths - totalFilteredPaths} removed)`);
    console.log(`Total methods: ${totalOriginalMethods} → ${totalFilteredMethods} (${totalOriginalMethods - totalFilteredMethods} removed)`);
    console.log('');
    console.log('Filtering criteria:');
    console.log(`  - Ignored services: ${IGNORED_SERVICES.join(', ')}`);
    console.log(`  - Removed filtered methods: ${FILTERED_METHODS.join(', ').toUpperCase()}`);
    console.log('  - Removed deprecated APIs');
    console.log('');
    console.log('✓ Processing complete!');
}

if (require.main === module) {
    main();
}

module.exports = {
    processOpenApiSpec,
    filterPaths,
    shouldIgnoreFile,
    FILTERED_METHODS,
    IGNORED_SERVICES
};
