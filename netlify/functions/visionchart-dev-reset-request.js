// POST /visionchart/api/dev-reset-request  (SmartMed Vision Chart TV app; redirect in netlify.toml)
// Shared implementation: _shared/handlers.js (devResetRequestHandler).
import { devResetRequestHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default devResetRequestHandler(PRODUCTS.visionchart);
