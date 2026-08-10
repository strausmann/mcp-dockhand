#!/usr/bin/env node
/**
 * Test fixture for tests/body-shape-collector.test.ts (#173): simulates a body-shape
 * collector that runs to completion (exit 0) but does NOT print valid JSON on stdout —
 * exercises loadToolBodyShapes()'s `JSON.parse(output)` failure path, independent of the
 * "npx tsx <path> itself fails" path (missing-script test case).
 */
console.log('this is not json output');
