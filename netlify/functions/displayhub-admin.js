// POST /.netlify/functions/displayhub-admin  (the dashboard: everything the admin does to Display Hub licences)
// Shared implementation: _shared/handlers.js (adminHandler).
import { adminHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default adminHandler(PRODUCTS.displayhub);
