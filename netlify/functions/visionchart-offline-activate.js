// POST /visionchart/api/offline-activate  (SmartMed Vision Chart TV app; redirect in netlify.toml)
// Shared implementation: _shared/handlers.js (offlineActivateHandler).
import { offlineActivateHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default offlineActivateHandler(PRODUCTS.visionchart);
