// POST /visionchart/api/sync  (SmartMed Vision Chart TV app; redirect in netlify.toml)
// Shared implementation: _shared/handlers.js (syncHandler).
import { syncHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default syncHandler(PRODUCTS.visionchart);
