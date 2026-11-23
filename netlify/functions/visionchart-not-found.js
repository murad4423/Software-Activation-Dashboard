// Any other /visionchart/api/ address: JSON 404  (SmartMed Vision Chart TV app; redirect in netlify.toml)
// Shared implementation: _shared/handlers.js (notFoundHandler).
import { notFoundHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default notFoundHandler(PRODUCTS.visionchart);
