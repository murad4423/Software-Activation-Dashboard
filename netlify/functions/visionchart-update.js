// POST /visionchart/api/update  (SmartMed Vision Chart TV app; redirect in netlify.toml)
// Shared implementation: _shared/handlers.js (updateHandler).
import { updateHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default updateHandler(PRODUCTS.visionchart);
