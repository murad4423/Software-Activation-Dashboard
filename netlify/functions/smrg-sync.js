// POST /smrg/api/sync  (SMRG app: periodic re-check, at most every 12 hours per PC)
// Shared implementation: _shared/handlers.js (syncHandler).
import { syncHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default syncHandler(PRODUCTS.smrg);
