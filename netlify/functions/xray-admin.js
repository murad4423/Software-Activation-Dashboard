// POST /.netlify/functions/xray-admin  (the dashboard: everything the admin does to X-ray licences)
// Shared implementation: _shared/handlers.js (adminHandler).
import { adminHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default adminHandler(PRODUCTS.xray);
