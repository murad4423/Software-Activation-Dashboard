// POST /.netlify/functions/visionchart-admin  (dashboard only)  (SmartMed Vision Chart TV app; redirect in netlify.toml)
// Shared implementation: _shared/handlers.js (adminHandler).
import { adminHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default adminHandler(PRODUCTS.visionchart);
