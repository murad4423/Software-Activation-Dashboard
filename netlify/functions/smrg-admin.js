// POST /.netlify/functions/smrg-admin  (dashboard only, requires the admin login): SMRG licences, settings, updates.
// Shared implementation: _shared/handlers.js (adminHandler).
import { adminHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default adminHandler(PRODUCTS.smrg);
